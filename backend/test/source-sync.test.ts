import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { ZhihuGateway, ZHIHU_OAUTH_CALLBACK } from '../src/zhihu-gateway.js'

function database() {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-source-sync-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  return { directory, repository }
}

function gateway(repository: ProductRepository, fetchImpl: typeof fetch, sleep: (milliseconds: number) => Promise<void> = async () => undefined) {
  return new ZhihuGateway(repository, {
    clientId: 'app-id', clientSecret: 'app-key', baseUrl: 'https://oauth.example.test', encryptionKey: 'x'.repeat(32),
    allowInsecureCallback: true, authorizePath: '/authorize', tokenPath: '/access_token',
    dataPlatformBaseUrl: 'https://developer.zhihu.com', dataPlatformAccessSecret: 'data-access-secret',
    collectionsPath: '/api/v1/user/collections', contentPath: '/api/v1/user/contents', followeesPath: '/api/v1/user/followees',
    favlistsPath: '/api/v1/user/favlists', favlistContentsPath: '/api/v1/user/favlist_contents',
    redirectUri: ZHIHU_OAUTH_CALLBACK, scopes: 'read collections', fetchImpl, sleep,
  })
}

function connect(client: ZhihuGateway, learnerId: string, code = 'code') {
  const state = new URL(client.start(learnerId, 'device').authorizationUrl).searchParams.get('state')!
  return client.callback(learnerId, 'device', state, code)
}

function item(title: string, url: string, summary: string, publishedAt?: string) {
  return { Title: title, Url: url, Summary: summary, ...(publishedAt ? { CreatedAt: publishedAt } : {}) }
}

function countSources(repository: ProductRepository, learnerId: string): number {
  return Number((repository.db.prepare("SELECT COUNT(*) AS count FROM learner_source_items WHERE learner_id=? AND provider='zhihu'").get(learnerId) as { count: number }).count)
}

describe('source sync favorites list, dedupe, and recovery', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

  it('resumes a favor-list pagination from the saved cursor after an upstream 429', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('paging-learner')
    let pageTwoCalls = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'token', uid: 'paging-user', expires_in: 3600 })
      if (url.pathname === '/api/v1/user/favlists') return Response.json({ Code: 0, Data: { Items: [{ Id: 'fav-1', Title: '收藏夹' }] } })
      if (url.pathname === '/api/v1/user/favlist_contents') {
        const cursor = url.searchParams.get('Cursor')
        if (!cursor) return Response.json({ Code: 0, Data: { Items: [item('A', 'https://www.zhihu.com/p/a', 'A 内容'), item('B', 'https://www.zhihu.com/p/b', 'B 内容')], Paging: { Next: 'page-2' } } })
        pageTwoCalls += 1
        if (pageTwoCalls <= 4) return new Response('', { status: 429, headers: { 'retry-after': '0' } })
        return Response.json({ Code: 0, Data: { Items: [item('C', 'https://www.zhihu.com/p/c', 'C 内容'), item('D', 'https://www.zhihu.com/p/d', 'D 内容')], Paging: { IsEnd: true } } })
      }
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      if (url.pathname === '/api/v1/user/followees') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    await connect(client, 'paging-learner')

    // First run: page one persists, page two is rate limited, so the job fails
    // but the per-collection cursor survives. Nothing is marked deleted.
    client.syncAll('paging-learner', 'sync-1')
    await vi.waitFor(() => expect(client.syncJobs('paging-learner')[0]?.status).toBe('failed'))
    expect(countSources(state.repository, 'paging-learner')).toBe(2)
    const savedCursor = state.repository.db.prepare("SELECT cursor FROM external_source_collections WHERE learner_id=? AND kind='favorites'").get('paging-learner') as { cursor: string | null }
    expect(savedCursor.cursor).toBe('page-2')

    // Second run resumes from the saved cursor instead of the homepage.
    client.syncAll('paging-learner', 'sync-2')
    await vi.waitFor(() => expect(client.syncJobs('paging-learner')[0]?.status).toBe('completed'))
    expect(countSources(state.repository, 'paging-learner')).toBe(4)
    expect(client.items('paging-learner').items.map((s) => s.title).sort()).toEqual(['A', 'B', 'C', 'D'])
    const done = state.repository.db.prepare("SELECT cursor FROM external_source_collections WHERE learner_id=? AND kind='favorites'").get('paging-learner') as { cursor: string | null }
    expect(done.cursor).toBeNull()
  })

  it('dedupes favorites by canonical URL and content hash into one source row', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('dedupe-learner')
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'token', uid: 'dedupe-user', expires_in: 3600 })
      if (url.pathname === '/api/v1/user/favlists') return Response.json({ Code: 0, Data: { Items: [{ Id: 'fav-1', Title: '收藏夹一' }, { Id: 'fav-2', Title: '收藏夹二' }] } })
      if (url.pathname === '/api/v1/user/favlist_contents') {
        const favlistId = url.searchParams.get('FavlistId')
        if (favlistId === 'fav-1') return Response.json({ Code: 0, Data: { Items: [
          item('标题', 'https://www.zhihu.com/p/1?utm_source=app#top', '内容'),
          item('问题一', 'https://www.zhihu.com/q/1', '同一个答案'),
        ], Paging: { IsEnd: true } } })
        return Response.json({ Code: 0, Data: { Items: [
          item('标题', 'https://www.zhihu.com/p/1', '内容'),
          item('问题一', 'https://www.zhihu.com/q/2', '同一个答案'),
        ], Paging: { IsEnd: true } } })
      }
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      if (url.pathname === '/api/v1/user/followees') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    await connect(client, 'dedupe-learner')
    client.syncAll('dedupe-learner', 'dedupe-sync')
    await vi.waitFor(() => expect(client.syncJobs('dedupe-learner')[0]?.status).toBe('completed'))
    // The utm-tagged URL and the plain URL are the same canonical source, and
    // the two questions share the same title + excerpt content fingerprint.
    expect(countSources(state.repository, 'dedupe-learner')).toBe(2)
    const urls = (state.repository.db.prepare("SELECT url FROM learner_source_items WHERE learner_id=? AND provider='zhihu' ORDER BY url").all('dedupe-learner') as Array<{ url: string }>).map((row) => row.url)
    expect(urls).not.toContain('https://www.zhihu.com/p/1?utm_source=app#top')
    expect(urls).toContain('https://www.zhihu.com/p/1')
  })

  it('marks remote sources deleted only after a complete cycle, and never touches public search items', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const learnerId = 'delete-gating-learner'
    state.repository.ensureLearner(learnerId)
    let pageTwoCalls = 0
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'token', uid: 'delete-gating-user', expires_in: 3600 })
      if (url.pathname === '/api/v1/user/favlists') return Response.json({ Code: 0, Data: { Items: [{ Id: 'fav-1', Title: '收藏夹' }] } })
      if (url.pathname === '/api/v1/user/favlist_contents') {
        const cursor = url.searchParams.get('Cursor')
        if (!cursor) return Response.json({ Code: 0, Data: { Items: [item('A', 'https://www.zhihu.com/p/a', 'A 内容'), item('B', 'https://www.zhihu.com/p/b', 'B 内容')], Paging: { Next: 'page-2' } } })
        pageTwoCalls += 1
        if (pageTwoCalls <= 4) return new Response('', { status: 429, headers: { 'retry-after': '0' } })
        return Response.json({ Code: 0, Data: { Items: [item('A', 'https://www.zhihu.com/p/a', 'A 内容'), item('B', 'https://www.zhihu.com/p/b', 'B 内容')], Paging: { IsEnd: true } } })
      }
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      if (url.pathname === '/api/v1/user/followees') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    await connect(client, learnerId)

    const now = new Date().toISOString()
    // A private item that was synced in an earlier full cycle but is no longer
    // returned remotely, plus a public search item that must survive deletion.
    state.repository.db.prepare(`
      INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,created_at,updated_at)
      VALUES ('stale-1',?,'zhihu','stale-old','https://www.zhihu.com/p/stale','旧收藏','作者','旧内容','{}','private','hash-stale','active',1,'[]',?,?)
    `).run(learnerId, now, now)
    state.repository.db.prepare(`
      INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,created_at,updated_at)
      VALUES ('public-1',?,'zhihu','search-hit','https://www.zhihu.com/p/public','公开搜索','作者','公开内容','{}','public','hash-public','active',0,'[]',?,?)
    `).run(learnerId, now, now)

    // Partial run: the 429 on page two means we only saw a partial remote view,
    // so the stale private item must stay active.
    client.syncAll(learnerId, 'gating-1')
    await vi.waitFor(() => expect(client.syncJobs(learnerId)[0]?.status).toBe('failed'))
    const afterPartial = state.repository.db.prepare("SELECT status FROM learner_source_items WHERE id='stale-1'").get() as { status: string }
    expect(afterPartial.status).toBe('active')

    // Complete cycle: the same job is re-queued, page two now succeeds, and the
    // full view marks the stale private source removed while the public item and
    // the still-favorited A/B survive.
    client.syncAll(learnerId, 'gating-1')
    await vi.waitFor(() => expect(client.syncJobs(learnerId)[0]?.status).toBe('completed'))
    expect(state.repository.db.prepare("SELECT status FROM learner_source_items WHERE id='stale-1'").get()).toMatchObject({ status: 'removed' })
    expect(state.repository.db.prepare("SELECT status FROM learner_source_items WHERE id='public-1'").get()).toMatchObject({ status: 'active' })
    expect(state.repository.db.prepare("SELECT status FROM learner_source_items WHERE url='https://www.zhihu.com/p/a'").get()).toMatchObject({ status: 'active' })
  })

  it('keeps moments to the recent 30 days or 200 items', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    const learnerId = 'activities-learner'
    state.repository.ensureLearner(learnerId)
    const nowIso = new Date().toISOString()
    const oldIso = new Date(Date.now() - 31 * 24 * 3600 * 1000).toISOString()
    const fetchImpl = vi.fn(async (input: string | URL | Request) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') return Response.json({ access_token: 'token', uid: 'activities-user', expires_in: 3600 })
      if (url.pathname === '/api/v1/user/favlists') return Response.json({ Code: 0, Data: { Items: [] } })
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      if (url.pathname === '/api/v1/user/followees') return Response.json({ Code: 0, Data: { Items: [
        item('近期一', 'https://www.zhihu.com/p/recent-1', '近期', nowIso),
        item('近期二', 'https://www.zhihu.com/p/recent-2', '近期', nowIso),
        item('三十一天前', 'https://www.zhihu.com/p/old', '过期', oldIso),
      ], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    await connect(client, learnerId)
    client.syncAll(learnerId, 'activities-sync')
    await vi.waitFor(() => expect(client.syncJobs(learnerId)[0]?.status).toBe('completed'))
    expect(countSources(state.repository, learnerId)).toBe(2)
    const titles = (state.repository.db.prepare('SELECT title FROM learner_source_items WHERE learner_id=?').all(learnerId) as Array<{ title: string }>).map((row) => row.title).sort()
    expect(titles).toEqual(['近期一', '近期二'])
  })

  it('keeps one learner favorites from leaking into another learner library', async () => {
    const state = database(); cleanup.push(() => { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) })
    state.repository.ensureLearner('isolation-a'); state.repository.ensureLearner('isolation-b')
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(String(input))
      if (url.pathname === '/access_token') {
        const code = new URLSearchParams(String(init?.body ?? '')).get('code')
        return Response.json({ access_token: `token-${code}`, uid: `isolation-${code}`, expires_in: 3600 })
      }
      if (url.pathname === '/api/v1/user/favlists') return Response.json({ Code: 0, Data: { Items: [{ Id: 'fav-1', Title: '收藏夹' }] } })
      if (url.pathname === '/api/v1/user/favlist_contents') {
        const oauthToken = new Headers(init?.headers).get('x-oauth-token')
        const items = oauthToken === 'token-a'
          ? [item('甲的收藏', 'https://www.zhihu.com/p/owner-a', '甲的内容')]
          : [item('乙的收藏', 'https://www.zhihu.com/p/owner-b', '乙的内容')]
        return Response.json({ Code: 0, Data: { Items: items, Paging: { IsEnd: true } } })
      }
      if (url.pathname === '/api/v1/user/contents') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      if (url.pathname === '/api/v1/user/followees') return Response.json({ Code: 0, Data: { Items: [], Paging: { IsEnd: true } } })
      return new Response('', { status: 404 })
    }) as typeof fetch
    const client = gateway(state.repository, fetchImpl)
    await connect(client, 'isolation-a', 'a')
    await connect(client, 'isolation-b', 'b')
    client.syncAll('isolation-a', 'isolation-sync-a')
    client.syncAll('isolation-b', 'isolation-sync-b')
    await vi.waitFor(() => expect(client.syncJobs('isolation-a')[0]?.status).toBe('completed'))
    await vi.waitFor(() => expect(client.syncJobs('isolation-b')[0]?.status).toBe('completed'))
    const aTitles = client.items('isolation-a').items.map((s) => s.title)
    const bTitles = client.items('isolation-b').items.map((s) => s.title)
    expect(aTitles).toContain('甲的收藏')
    expect(aTitles).not.toContain('乙的收藏')
    expect(bTitles).toContain('乙的收藏')
    expect(bTitles).not.toContain('甲的收藏')
  })
})
