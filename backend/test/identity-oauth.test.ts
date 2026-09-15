import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LabStore } from '../src/mysql-store.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { IdentityService } from '../src/identity-service.js'
import { ZhihuGateway, ZHIHU_OAUTH_CALLBACK } from '../src/zhihu-gateway.js'
import { buildApp } from '../src/app.js'
import { loadConfig } from '../src/config.js'

function database() {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-identity-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  return { directory, repository }
}

function gateway(
  repository: ProductRepository,
  fetchImpl: typeof fetch = fetch,
  sleep: (milliseconds: number) => Promise<void> = async () => undefined,
  publicSearch?: { configured: boolean; search(query: string, count?: number): Promise<Array<{ externalId: string; title: string; author: string | null; url: string; excerpt: string; retrievedAt: string; metadata: Record<string, unknown> }>> },
) {
  return new ZhihuGateway(repository, {
    clientId: 'app-id', clientSecret: 'app-key', baseUrl: 'https://oauth.example.test', encryptionKey: 'x'.repeat(32),
    allowInsecureCallback: true, authorizePath: '/authorize', tokenPath: '/access_token',
    dataPlatformBaseUrl: 'https://developer.zhihu.com', dataPlatformAccessSecret: 'data-access-secret',
    collectionsPath: '/api/v1/user/collections', contentPath: '/api/v1/user/contents', followeesPath: '/api/v1/user/followees',
    favlistsPath: '/api/v1/user/favlists', favlistContentsPath: '/api/v1/user/favlist_contents',
    redirectUri: ZHIHU_OAUTH_CALLBACK, scopes: 'read collections', fetchImpl, sleep, publicSearch,
  })
}

const noopStore: LabStore = {
  async reset() {},
  async createSession() { throw new Error('unused') },
  async execute() { throw new Error('unused') },
  async closeConnection() {},
}

describe('signed device identity and Zhihu OAuth', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

  it('rotates CSRF while preserving the device learner and expires invalid sessions', () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const first = identity.issue()
    expect(identity.resolve(first.id)?.learnerId).toBe(first.learnerId)
    expect(identity.validCsrf(first.id, first.csrfToken)).toBe(true)
    expect(identity.validCsrf(first.id, 'forged')).toBe(false)
    const renewed = identity.issue(first.id)
    expect(renewed.learnerId).toBe(first.learnerId)
    expect(identity.validCsrf(first.id, first.csrfToken)).toBe(false)
    expect(identity.validCsrf(first.id, renewed.csrfToken)).toBe(true)
    state.repository.db.prepare("UPDATE learner_sessions SET expires_at='2000-01-01T00:00:00.000Z' WHERE id=?").run(first.id)
    expect(identity.resolve(first.id)).toBeNull()
  })

  it('ignores a forged learner header and enforces session, CSRF, and Origin on mutations', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const app = buildApp({
      config: { ...loadConfig(), identityMode: 'client', signedDeviceSessionEnabled: true, legacyHeaderLearnerId: false, zhihuOauthEnabled: true, zhihuLoginRequired: false, zhihuSourceSyncEnabled: false, practiceCardV2Enabled: false, mixedGymEnabled: false, publicOrigin: 'http://119.45.243.102', corsOrigin: 'http://119.45.243.102' },
      store: noopStore, identityService: identity, zhihuGateway: gateway(state.repository),
    }).app
    cleanup.push(() => { void app.close() })

    const missing = await app.inject({ method: 'GET', url: '/api/auth/connections', headers: { 'x-learner-id': 'forged' } })
    expect(missing.statusCode).toBe(401)
    const issued = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin: 'http://119.45.243.102' } })
    const setCookie = issued.headers['set-cookie']!
    const cookie = (Array.isArray(setCookie) ? setCookie[0] : setCookie).split(';')[0]
    const body = issued.json<{ learnerId: string; csrfToken: string }>()
    expect(body.learnerId).not.toBe('forged')
    expect((await app.inject({ method: 'GET', url: '/api/product/runtime-status', headers: { cookie } })).statusCode).toBe(200)

    const noCsrf = await app.inject({ method: 'POST', url: '/api/auth/oauth/zhihu/start', headers: { cookie, origin: 'http://119.45.243.102', 'x-learner-id': 'forged' } })
    expect(noCsrf.statusCode).toBe(403)
    const wrongOrigin = await app.inject({ method: 'POST', url: '/api/auth/oauth/zhihu/start', headers: { cookie, origin: 'http://evil.test', 'x-csrf-token': body.csrfToken } })
    expect(wrongOrigin.statusCode).toBe(403)
    const accepted = await app.inject({ method: 'POST', url: '/api/auth/oauth/zhihu/start', headers: { cookie, origin: 'http://119.45.243.102', 'x-csrf-token': body.csrfToken } })
    expect(accepted.statusCode).toBe(200)
    const authorizationUrl = new URL(accepted.json().authorizationUrl)
    expect(authorizationUrl.searchParams.get('app_id')).toBe('app-id')
    expect(authorizationUrl.searchParams.has('client_id')).toBe(false)
    expect(authorizationUrl.searchParams.get('state')).toBeTruthy()
  })

  it('rejects reconnecting an account already bound to another learner instead of silently merging histories', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'token-not-an-identity', uid: 'stable-zhihu-uid', expires_in: 3600 })
      if (url.pathname === '/user') return new Response('<html>not found</html>', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    const first = identity.issue()
    const firstState = new URL(client.start(first.learnerId, first.id).authorizationUrl).searchParams.get('state')!
    const firstResult = await client.callback(first.learnerId, first.id, firstState, 'first-code')
    expect(firstResult).toEqual({ learnerId: first.learnerId, profile: null })

    const second = identity.issue()
    const secondState = new URL(client.start(second.learnerId, second.id).authorizationUrl).searchParams.get('state')!
    await expect(client.callback(second.learnerId, second.id, secondState, 'second-code')).rejects.toMatchObject({ code: 'identity_merge_required' })

    // The second device session keeps its own learner; no empty learner is
    // created and the global (provider, provider_user_id) identity stays unique.
    expect(identity.resolve(second.id)?.learnerId).toBe(second.learnerId)
    expect(state.repository.db.prepare("SELECT COUNT(*) count FROM provider_connections WHERE provider='zhihu' AND provider_user_id='stable-zhihu-uid'").get()).toEqual({ count: 1 })
    const learnerIds = (state.repository.db.prepare('SELECT id FROM learners').all() as Array<{ id: string }>).map((row) => row.id)
    expect(learnerIds).toEqual(expect.arrayContaining([first.learnerId, second.learnerId]))
    // Only the two device learners exist alongside the seeded demo learner: the
    // rejected callback must not have created a silent empty learner.
    expect(learnerIds.filter((id) => id !== 'demo-learner')).toHaveLength(2)
  })

  it('keeps different Zhihu accounts isolated and never treats token material as an identity', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') {
        const code = new URLSearchParams(String(init?.body)).get('code')
        return Response.json({ access_token: `token-${code}`, uid: `uid-${code}`, expires_in: 3600 })
      }
      if (url.pathname === '/user') return new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    const first = 'learner-account-one'; const second = 'learner-account-two'
    state.repository.ensureLearner(first); state.repository.ensureLearner(second)
    const firstResult = await client.callback(first, 'device-a', new URL(client.start(first, 'device-a').authorizationUrl).searchParams.get('state')!, 'one')
    const secondResult = await client.callback(second, 'device-b', new URL(client.start(second, 'device-b').authorizationUrl).searchParams.get('state')!, 'two')

    expect(firstResult.learnerId).toBe(first)
    expect(secondResult.learnerId).toBe(second)
    expect(state.repository.db.prepare("SELECT provider_user_id providerUserId FROM provider_connections WHERE provider='zhihu' ORDER BY provider_user_id").all()).toEqual([{ providerUserId: 'uid-one' }, { providerUserId: 'uid-two' }])
    expect(JSON.stringify(state.repository.db.prepare('SELECT * FROM provider_connections').all())).not.toContain('token-one')
  })

  it('does not consume state or persist a token when no stable provider identity is available', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('identity-missing')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'test-access-token-without-uid', expires_in: 3600 })
      if (url.pathname === '/user') return new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    const stateValue = new URL(client.start('identity-missing', 'device-missing').authorizationUrl).searchParams.get('state')!

    await expect(client.callback('identity-missing', 'device-missing', stateValue, 'identity-missing-code')).rejects.toMatchObject({ code: 'oauth_provider_identity_unavailable' })
    expect(state.repository.db.prepare('SELECT consumed_at consumedAt FROM oauth_authorization_states').get()).toEqual({ consumedAt: null })
    expect(state.repository.db.prepare('SELECT COUNT(*) count FROM provider_connections').get()).toEqual({ count: 0 })
  })

  it('consumes one state exactly once when duplicate callbacks race', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('race-learner')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'race-token', uid: 'race-user' })
      if (url.pathname === '/user') return new Response('', { status: 404 })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    const stateValue = new URL(client.start('race-learner', 'device-race').authorizationUrl).searchParams.get('state')!
    const results = await Promise.allSettled([
      client.callback('race-learner', 'device-race', stateValue, 'race-code'),
      client.callback('race-learner', 'device-race', stateValue, 'race-code'),
    ])

    expect(results.filter((result) => result.status === 'fulfilled')).toHaveLength(1)
    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1)
    expect(state.repository.db.prepare("SELECT COUNT(*) count FROM provider_connections WHERE provider='zhihu' AND provider_user_id='race-user'").get()).toEqual({ count: 1 })
  })

  it('returns a stable public session auth shape and gates product routes only when Zhihu login is required', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'session-secret-token', uid: 'session-user', expires_in: 3600 })
      if (url.pathname === '/user') return Response.json({ id: 'profile-id', name: '知乎用户', avatar_url: 'https://img.zhihu.test/avatar.png', url: 'https://www.zhihu.com/people/profile-id' })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const app = buildApp({
      config: { ...loadConfig(), identityMode: 'client', signedDeviceSessionEnabled: true, legacyHeaderLearnerId: false, zhihuOauthEnabled: true, zhihuLoginRequired: true, zhihuSourceSyncEnabled: false, practiceCardV2Enabled: false, mixedGymEnabled: false, publicOrigin: 'http://119.45.243.102', corsOrigin: 'http://119.45.243.102' },
      store: noopStore, identityService: identity, zhihuGateway: gateway(state.repository, fetchImpl),
    }).app
    cleanup.push(() => { void app.close() })

    const created = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin: 'http://119.45.243.102' } })
    const cookie = (Array.isArray(created.headers['set-cookie']) ? created.headers['set-cookie'][0] : created.headers['set-cookie'])!.split(';')[0]
    const createdBody = created.json<{ learnerId: string; csrfToken: string; auth: { required: boolean; authenticated: boolean } }>()
    expect(createdBody.auth).toEqual({ required: true, authenticated: false, provider: null, profile: null, status: 'disconnected' })
    state.repository.db.prepare(`
      INSERT INTO provider_connections(id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag, scopes_json, status, profile_json, created_at, updated_at)
      VALUES ('malformed-active-connection', ?, 'zhihu', NULL, 'ciphertext', 'iv', 'tag', '[]', 'active', '{}', ?, ?)
    `).run(createdBody.learnerId, new Date().toISOString(), new Date().toISOString())
    expect((await app.inject({ method: 'GET', url: '/api/product/runtime-status', headers: { cookie } })).json()).toMatchObject({ error: { code: 'zhihu_auth_required' } })

    const unauthenticated = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    expect(unauthenticated.statusCode).toBe(200)
    expect(unauthenticated.json()).toMatchObject({ learnerId: createdBody.learnerId, auth: { required: true, authenticated: false, provider: null, profile: null, status: 'pending' } })
    expect(unauthenticated.json()).not.toHaveProperty('csrfToken')

    const start = await app.inject({ method: 'POST', url: '/api/auth/oauth/zhihu/start', headers: { cookie, origin: 'http://119.45.243.102', 'x-csrf-token': createdBody.csrfToken } })
    const oauthState = new URL(start.json<{ authorizationUrl: string }>().authorizationUrl).searchParams.get('state')!
    const callback = await app.inject({ method: 'GET', url: `/api/auth/oauth/zhihu/callback?state=${encodeURIComponent(oauthState)}&authorization_code=session-code`, headers: { cookie } })
    expect(callback.statusCode).toBe(302)
    const authenticated = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    expect(authenticated.json()).toMatchObject({ auth: { required: true, authenticated: true, provider: 'zhihu', profile: null, status: 'connected' } })
    expect(JSON.stringify(authenticated.json())).not.toContain('session-secret-token')
    expect(state.repository.db.prepare("SELECT provider_user_id providerUserId FROM provider_connections WHERE learner_id=? AND provider='zhihu'").get(createdBody.learnerId)).toEqual({ providerUserId: 'session-user' })
    expect((await app.inject({ method: 'GET', url: '/api/product/runtime-status', headers: { cookie } })).statusCode).toBe(200)
  })

  it('does not treat empty active identities as connected and strips unsafe public profile URLs', () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('empty-identity')
    const now = new Date().toISOString()
    state.repository.db.prepare(`
      INSERT INTO provider_connections(id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag, scopes_json, status, profile_json, created_at, updated_at)
      VALUES ('empty-identity-connection', 'empty-identity', 'zhihu', '   ', 'ciphertext', 'iv', 'tag', '[]', 'active', ?, ?, ?)
    `).run(JSON.stringify({ displayName: '普通昵称', avatarUrl: 'javascript:alert(1)', profileUrl: 'data:text/html,unsafe' }), now, now)
    const client = gateway(state.repository)

    expect(client.authentication('empty-identity', true)).toEqual({ required: true, authenticated: false, provider: null, profile: null, status: 'pending' })
    expect(client.connections('empty-identity')).toEqual([{
      provider: 'zhihu', status: 'pending', account: undefined, scopes: [], profile: { displayName: '普通昵称', avatarUrl: null, profileUrl: null },
    }])
  })

  it('keeps token uid as the canonical identity while accepting only safe profile URLs', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('profile-priority')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'profile-priority-token', uid: 'token-uid-wins' })
      if (url.pathname === '/user') return Response.json({ id: 'profile-id-loses', name: '公开昵称', avatar_url: 'file:///private/avatar.png', url: 'javascript:alert(1)' })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    const stateValue = new URL(client.start('profile-priority', 'device-profile').authorizationUrl).searchParams.get('state')!

    await expect(client.callback('profile-priority', 'device-profile', stateValue, 'profile-code')).resolves.toEqual({ learnerId: 'profile-priority', profile: null })
    expect(state.repository.db.prepare("SELECT provider_user_id providerUserId FROM provider_connections WHERE learner_id='profile-priority'").get()).toEqual({ providerUserId: 'token-uid-wins' })
  })

  it('binds one-time state to the device, encrypts tokens, and syncs through the documented double-token Data Platform headers', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('learner-a'); state.repository.ensureLearner('learner-b')
    let collectionAttempts = 0
    const sleeps: number[] = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') {
        expect(new Headers(init?.headers).get('content-type')).toBe('application/x-www-form-urlencoded')
        const payload = new URLSearchParams(String(init?.body ?? ''))
        expect(payload.get('app_id')).toBe('app-id')
        expect(payload.get('app_key')).toBe('app-key')
        return Response.json({ access_token: 'initial-token', uid: 'zhihu-user-1', expires_in: 3600 })
      }
      if (url.pathname === '/api/v1/user/collections') {
        collectionAttempts += 1
        const authorization = new Headers(init?.headers).get('authorization')
        expect(authorization).toBe('Bearer data-access-secret')
        expect(new Headers(init?.headers).get('x-oauth-token')).toBe('initial-token')
        expect(new Headers(init?.headers).get('x-request-timestamp')).toMatch(/^\d+$/)
        if (collectionAttempts === 1) return new Response('', { status: 429, headers: { 'retry-after': '0' } })
        return Response.json({ Code: 0, Data: { Items: [{ Title: 'MySQL EXPLAIN 实战', Url: 'https://www.zhihu.com/question/1/answer/1', Summary: '使用执行计划验证索引是否命中。' }] } })
      }
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl, async (milliseconds) => { sleeps.push(milliseconds) })
    const started = client.start('learner-a', 'device-a')
    const authUrl = new URL(started.authorizationUrl)
    const rawState = authUrl.searchParams.get('state')!
    expect(JSON.stringify(state.repository.db.prepare('SELECT * FROM oauth_authorization_states').all())).not.toContain(rawState)
    await expect(client.callback('learner-b', 'device-b', rawState, 'code')).rejects.toMatchObject({ code: 'oauth_state_invalid' })
    await client.callback('learner-a', 'device-a', rawState, 'code')
    await expect(client.callback('learner-a', 'device-a', rawState, 'code')).rejects.toMatchObject({ code: 'oauth_state_invalid' })
    const stored = state.repository.db.prepare('SELECT token_ciphertext, token_iv, token_tag FROM provider_connections').get() as Record<string, string>
    expect(JSON.stringify(stored)).not.toContain('initial-token')

    const job = client.syncAll('learner-a', 'sync-1')
    expect(job.status).toBe('queued')
    await vi.waitFor(() => expect(client.syncJobs('learner-a')[0]?.status).toBe('completed'))
    expect(client.syncJobs('learner-a')[0]).toMatchObject({ importedCount: 1, errorMessage: null })
    expect(client.items('learner-a').items[0]).toMatchObject({ title: 'MySQL EXPLAIN 实战', saved: true })
    expect(collectionAttempts).toBe(2)
    expect(sleeps).toHaveLength(1)
  })

  it('keeps official user-data paths isolated from OAuth token exchange', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('learner-a')
    const requests: Array<{ path: string; authorization: string | null; oauth: string | null }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'token', uid: 'zhihu-user-1', expires_in: 3600 })
      requests.push({ path: url.pathname, authorization: new Headers(init?.headers).get('authorization'), oauth: new Headers(init?.headers).get('x-oauth-token') })
      if (url.pathname === '/api/v1/user/collections') return Response.json({ Code: '0', Data: { Items: [] } })
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: '0', Data: { Items: [{ Title: '我的文章', Url: 'https://www.zhihu.com/p/1', Summary: '摘要' }], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    const authorization = client.start('learner-a', 'device-a')
    await client.callback('learner-a', 'device-a', new URL(authorization.authorizationUrl).searchParams.get('state')!, 'code')

    client.syncAll('learner-a', 'resume-sync')
    await vi.waitFor(() => expect(client.syncJobs('learner-a')[0]?.status).toBe('completed'))
    expect(client.syncJobs('learner-a')[0]).toMatchObject({ importedCount: 1, updatedCount: 0 })
    expect(requests).toEqual(expect.arrayContaining([
      expect.objectContaining({ path: '/api/v1/user/collections', authorization: 'Bearer data-access-secret', oauth: 'token' }),
      expect.objectContaining({ path: '/api/v1/user/contents', authorization: 'Bearer data-access-secret', oauth: 'token' }),
    ]))
    expect(requests.some((request) => request.path === '/user' || request.path.startsWith('/api/v4/'))).toBe(false)
  })

  it('imports public search results into only the requesting learner library', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('learner-a'); state.repository.ensureLearner('learner-b')
    const client = gateway(state.repository, fetch, async () => undefined, {
      configured: true,
      async search(query) {
        return [{ externalId: 'public-1', title: `${query} 实战`, author: '作者', url: 'https://www.zhihu.com/p/1', excerpt: '公开摘要', retrievedAt: new Date().toISOString(), metadata: { provenance: 'test' } }]
      },
    })

    const result = await client.search('learner-a', 'MySQL')
    expect(result.items).toHaveLength(1)
    expect(result.items[0]).toMatchObject({ title: 'MySQL 实战', saved: false })
    expect(client.items('learner-b', 'MySQL').items).toHaveLength(0)
  })
})
