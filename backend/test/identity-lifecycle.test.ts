import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
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
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-lifecycle-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  return { directory, repository }
}

function gateway(repository: ProductRepository, fetchImpl: typeof fetch = fetch) {
  return new ZhihuGateway(repository, {
    clientId: 'app-id', clientSecret: 'app-key', baseUrl: 'https://oauth.example.test', encryptionKey: 'x'.repeat(32),
    allowInsecureCallback: true, authorizePath: '/authorize', tokenPath: '/access_token',
    dataPlatformBaseUrl: 'https://developer.zhihu.com', dataPlatformAccessSecret: 'data-access-secret',
    collectionsPath: '/api/v1/user/collections', contentPath: '/api/v1/user/contents', followeesPath: '/api/v1/user/followees',
    favlistsPath: '/api/v1/user/favlists', favlistContentsPath: '/api/v1/user/favlist_contents',
    redirectUri: ZHIHU_OAUTH_CALLBACK, scopes: 'read collections', fetchImpl,
  })
}

const noopStore: LabStore = {
  async reset() {},
  async createSession() { throw new Error('unused') },
  async execute() { throw new Error('unused') },
  async closeConnection() {},
}

function tokenFetch(uid: string) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input))
    if (url.pathname === '/access_token') return Response.json({ access_token: `token-${uid}`, uid, expires_in: 3600 })
    if (url.pathname === '/api/v1/user/collections') return Response.json({ Code: 0, Data: { Items: [{ Title: 'MySQL EXPLAIN 实战', Url: 'https://www.zhihu.com/question/1/answer/1', Summary: '使用执行计划验证索引是否命中。' }] } })
    if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
    return new Response('', { status: 404 })
  }) as typeof fetch
}

describe('identity and OAuth lifecycle', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

  it('logout revokes the device session, clears the cookie, and makes the old cookie unusable', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const app = buildApp({
      config: { ...loadConfig(), identityMode: 'client', signedDeviceSessionEnabled: true, legacyHeaderLearnerId: false, zhihuOauthEnabled: false, zhihuLoginRequired: false, zhihuSourceSyncEnabled: false, practiceCardV2Enabled: false, mixedGymEnabled: false, publicOrigin: 'http://119.45.243.102', corsOrigin: 'http://119.45.243.102' },
      store: noopStore, identityService: identity,
    }).app
    cleanup.push(() => { void app.close() })

    const issued = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin: 'http://119.45.243.102' } })
    const cookie = (Array.isArray(issued.headers['set-cookie']) ? issued.headers['set-cookie'][0] : issued.headers['set-cookie'])!.split(';')[0]
    const csrf = issued.json<{ csrfToken: string }>().csrfToken
    expect((await app.inject({ method: 'GET', url: '/api/product/runtime-status', headers: { cookie } })).statusCode).toBe(200)

    const logout = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { cookie, origin: 'http://119.45.243.102', 'x-csrf-token': csrf } })
    expect(logout.statusCode).toBe(200)
    expect(logout.json()).toEqual({ ok: true })
    expect(JSON.stringify(logout.json())).not.toContain(csrf)
    const clearedCookie = (Array.isArray(logout.headers['set-cookie']) ? logout.headers['set-cookie'][0] : logout.headers['set-cookie'])!
    expect(clearedCookie).toContain('Max-Age=0')

    // The old cookie no longer resolves to a session.
    expect((await app.inject({ method: 'GET', url: '/api/product/runtime-status', headers: { cookie } })).json()).toMatchObject({ error: { code: 'session_required' } })
    // Logout stays idempotent when the session is already absent.
    const again = await app.inject({ method: 'POST', url: '/api/auth/logout', headers: { origin: 'http://119.45.243.102' } })
    expect(again.statusCode).toBe(200)
    expect(again.json()).toEqual({ ok: true })
    // The learner_sessions row is really gone.
    expect(state.repository.db.prepare('SELECT COUNT(*) AS count FROM learner_sessions').get()).toMatchObject({ count: 0 })
  })

  it('exposes reauthorization_required as a safe session status and marks undecryptable tokens', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const app = buildApp({
      config: { ...loadConfig(), identityMode: 'client', signedDeviceSessionEnabled: true, legacyHeaderLearnerId: false, zhihuOauthEnabled: true, zhihuLoginRequired: false, zhihuSourceSyncEnabled: true, practiceCardV2Enabled: false, mixedGymEnabled: false, publicOrigin: 'http://119.45.243.102', corsOrigin: 'http://119.45.243.102' },
      store: noopStore, identityService: identity, zhihuGateway: gateway(state.repository, tokenFetch('reauth-user')),
    }).app
    cleanup.push(() => { void app.close() })
    const issued = await app.inject({ method: 'POST', url: '/api/auth/session', headers: { origin: 'http://119.45.243.102' } })
    const cookie = (Array.isArray(issued.headers['set-cookie']) ? issued.headers['set-cookie'][0] : issued.headers['set-cookie'])!.split(';')[0]
    const csrf = issued.json<{ csrfToken: string; learnerId: string }>()
    const now = new Date().toISOString()
    // An active connection whose ciphertext can no longer be decrypted.
    state.repository.db.prepare(`
      INSERT INTO provider_connections(id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag, token_expires_at, scopes_json, status, profile_json, created_at, updated_at)
      VALUES (?, ?, 'zhihu', 'reauth-user', 'not-valid-base64-ciphertext', 'not-valid-iv', 'not-valid-tag', ?, '[]', 'active', '{}', ?, ?)
    `).run('reauth-connection', csrf.learnerId, now, now, now)

    // Before the failure the session reports the connection normally.
    const before = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    expect(before.json().auth).toEqual({ required: false, authenticated: true, provider: 'zhihu', profile: null, status: 'connected' })
    expect(JSON.stringify(before.json())).not.toContain('not-valid-base64-ciphertext')

    // A sync that hits the undecryptable token marks the connection and fails safely.
    const sync = await app.inject({ method: 'POST', url: '/api/product/source-syncs', headers: { cookie, origin: 'http://119.45.243.102', 'x-csrf-token': csrf.csrfToken } })
    expect(sync.statusCode).toBe(202)
    const jobId = sync.json<{ id: string }>().id
    await vi.waitFor(() => expect(state.repository.db.prepare('SELECT status FROM source_sync_jobs WHERE id=?').get(jobId)).toMatchObject({ status: 'failed' }))
    expect(state.repository.db.prepare("SELECT status FROM provider_connections WHERE id='reauth-connection'").get()).toMatchObject({ status: 'reauthorization_required' })

    const after = await app.inject({ method: 'GET', url: '/api/auth/session', headers: { cookie } })
    expect(after.json().auth).toEqual({ required: false, authenticated: false, provider: 'zhihu', profile: null, status: 'reauthorization_required' })
  })

  it('binds OAuth state to the concrete device session so it cannot be replayed on another session', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const identity = new IdentityService(state.repository)
    const client = gateway(state.repository, tokenFetch('session-bound-user'))
    const first = identity.issue()
    const second = identity.issue()
    const rawState = new URL(client.start(first.learnerId, first.id).authorizationUrl).searchParams.get('state')!
    // Same learner, different device session: the state must not validate.
    await expect(client.callback(first.learnerId, second.id, rawState, 'code')).rejects.toMatchObject({ code: 'oauth_state_invalid' })
    // The owning session still completes the flow.
    await expect(client.callback(first.learnerId, first.id, rawState, 'code')).resolves.toMatchObject({ learnerId: first.learnerId })
    // And the state is consumed one-time.
    await expect(client.callback(first.learnerId, first.id, rawState, 'code')).rejects.toMatchObject({ code: 'oauth_state_invalid' })
  })

  it('disconnect deletes the encrypted token but keeps the de-identified snapshot referenced by Practice Cards', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const learnerId = 'disconnect-learner'
    state.repository.ensureLearner(learnerId)
    const client = gateway(state.repository, tokenFetch('disconnect-user'))
    const sessionId = randomUUID()
    const rawState = new URL(client.start(learnerId, sessionId).authorizationUrl).searchParams.get('state')!
    await client.callback(learnerId, sessionId, rawState, 'code')
    client.syncAll(learnerId, 'sync-1')
    await vi.waitFor(() => expect(client.syncJobs(learnerId)[0]?.status).toBe('completed'))
    const sourceItems = state.repository.db.prepare('SELECT id, content_json FROM learner_source_items WHERE learner_id=? AND provider=?').all(learnerId, 'zhihu') as Array<{ id: string; content_json: string }>
    expect(sourceItems.length).toBe(1)
    const referencedId = sourceItems[0]!.id
    const now = new Date().toISOString()
    state.repository.db.prepare("INSERT INTO intakes(id, learner_id, goal, technology, status, created_at, updated_at) VALUES (?, ?, '目标', '技术', 'draft', ?, ?)").run(randomUUID(), learnerId, now, now)
    const intakeId = state.repository.db.prepare("SELECT id FROM intakes WHERE learner_id=?").get(learnerId) as { id: string }
    state.repository.db.prepare("INSERT INTO learning_plans(id, learner_id, intake_id, title, goal, source_status, status, created_at, updated_at) VALUES (?, ?, ?, '路线', '目标', 'local_catalog', 'active', ?, ?)").run(randomUUID(), learnerId, intakeId.id, now, now)
    const planId = state.repository.db.prepare("SELECT id FROM learning_plans WHERE learner_id=?").get(learnerId) as { id: string }
    state.repository.db.prepare("INSERT INTO plan_units(id, plan_id, position, title, objective, status, source_refs_json) VALUES (?, ?, 1, '单元', '目标', 'current', '[]')").run(randomUUID(), planId.id)
    const unitId = state.repository.db.prepare("SELECT id FROM plan_units WHERE plan_id=?").get(planId.id) as { id: string }
    const cardId = randomUUID()
    state.repository.db.prepare("INSERT INTO practice_cards(id, learner_id, plan_unit_id, intent_json, public_json, private_json, source_quality, status, version, created_at, updated_at) VALUES (?, ?, ?, '{}', '{}', '{}', 0.5, 'ready', 1, ?, ?)").run(cardId, learnerId, unitId.id, now, now)
    state.repository.db.prepare('INSERT INTO practice_card_sources(practice_card_id, source_item_id, relevance, position, created_at) VALUES (?, ?, 0.5, 1, ?)').run(cardId, referencedId, now)

    client.disconnect(learnerId)

    // The encrypted token is gone.
    expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM provider_connections WHERE learner_id=? AND provider='zhihu'").get(learnerId)).toMatchObject({ count: 0 })
    // The card-referenced snapshot survives but is de-identified and marked removed.
    const kept = state.repository.db.prepare('SELECT content_json, status FROM learner_source_items WHERE id=?').get(referencedId) as { content_json: string; status: string }
    expect(kept.status).toBe('removed')
    expect(JSON.parse(kept.content_json)).toEqual({})
    expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM learner_source_items WHERE learner_id=? AND provider='zhihu'").get(learnerId)).toMatchObject({ count: 1 })
  })
})
