import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ProductRepository } from './product-repository.js'
import { LabError } from './errors.js'

export const ZHIHU_OAUTH_CALLBACK = 'http://119.45.243.102/api/auth/oauth/zhihu/callback'

const tokenSchema = z.object({
  access_token: z.string().min(1),
  refresh_token: z.string().min(1).optional(),
  expires_in: z.number().positive().optional(),
  scope: z.string().optional(),
  uid: z.union([z.string(), z.number()]).optional(),
})

const itemSchema = z.object({
  id: z.union([z.string(), z.number()]).transform(String),
  title: z.string().optional(),
  name: z.string().optional(),
  url: z.string().url().optional(),
  link: z.string().url().optional(),
  content: z.string().optional(),
  excerpt: z.string().optional(),
  summary: z.string().optional(),
  published_at: z.union([z.string(), z.number()]).optional(),
  author: z.union([z.string(), z.object({ name: z.string().optional() })]).optional(),
}).passthrough()

const pageSchema = z.object({
  data: z.array(itemSchema).optional(),
  items: z.array(itemSchema).optional(),
  results: z.array(itemSchema).optional(),
  paging: z.object({ next: z.string().nullable().optional() }).optional(),
  cursor: z.string().nullable().optional(),
}).passthrough()

type Token = z.infer<typeof tokenSchema>
type SourceItem = z.infer<typeof itemSchema>
type ConnectionRow = Record<string, unknown>
type SyncCursor = { phase: 'favorites' | 'own' | 'activities'; collectionIndex: number; next: string | null; imported: number; updated: number }
type PublicSearchItem = {
  externalId: string | null
  title: string
  author: string | null
  url: string
  excerpt: string
  retrievedAt: string
  metadata: Record<string, unknown>
}

export interface ZhihuGatewayOptions {
  clientId: string
  clientSecret: string
  baseUrl: string
  encryptionKey: string
  allowInsecureCallback: boolean
  authorizePath: string
  tokenPath: string
  userPath: string
  collectionsPath: string
  collectionItemsPath: string
  contentPath: string
  momentsPath: string
  redirectUri: string
  scopes: string
  publicSearch?: { configured: boolean; search(query: string, count?: number): Promise<PublicSearchItem[]> }
  fetchImpl?: typeof fetch
  sleep?: (milliseconds: number) => Promise<void>
}

function asIso(value: unknown): string | null {
  if (typeof value === 'number') return new Date(value > 10_000_000_000 ? value : value * 1000).toISOString()
  if (typeof value === 'string' && value.trim()) {
    const parsed = new Date(value)
    return Number.isNaN(parsed.valueOf()) ? null : parsed.toISOString()
  }
  return null
}

function publicError(error: unknown): { code: string; message: string } {
  if (error instanceof LabError) return { code: error.code, message: error.message }
  return { code: 'source_sync_failed', message: '知乎内容同步失败' }
}

export class ZhihuGateway {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(private readonly repository: ProductRepository, private readonly options: ZhihuGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  start(learnerId: string): { authorizationUrl: string; expiresInSeconds: number } {
    if (this.options.redirectUri !== ZHIHU_OAUTH_CALLBACK) throw new LabError('oauth_callback_invalid', 'OAuth 回调地址未按部署契约配置', 500)
    if (!this.options.clientId || !this.options.clientSecret) throw new LabError('oauth_not_configured', '知乎 OAuth 尚未配置', 503)
    if (this.options.redirectUri.startsWith('http://') && !this.options.allowInsecureCallback) throw new LabError('oauth_insecure_callback_disabled', 'HTTP OAuth 回调未显式启用', 503)

    const state = randomBytes(32).toString('base64url')
    const createdAt = new Date()
    this.repository.db.prepare(
      'INSERT INTO oauth_authorization_states(id, learner_id, provider, state_hash, redirect_uri, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), learnerId, 'zhihu', this.hash(state), this.options.redirectUri, new Date(createdAt.getTime() + 5 * 60_000).toISOString(), createdAt.toISOString())

    const url = new URL(this.options.authorizePath, this.options.baseUrl)
    // Zhihu's OAuth application contract uses app_id (not the generic OAuth client_id).
    url.searchParams.set('app_id', this.options.clientId)
    url.searchParams.set('redirect_uri', this.options.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    if (this.options.scopes.trim()) url.searchParams.set('scope', this.options.scopes.trim())
    return { authorizationUrl: url.toString(), expiresInSeconds: 300 }
  }

  async callback(learnerId: string, state: string, code: string): Promise<void> {
    const stateRow = this.repository.db.prepare(
      "SELECT * FROM oauth_authorization_states WHERE provider = 'zhihu' AND learner_id = ? AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).get(learnerId, this.hash(state), new Date().toISOString()) as ConnectionRow | undefined
    if (!stateRow) throw new LabError('oauth_state_invalid', 'OAuth state 无效、已使用、跨会话或已过期', 400)

    const token = await this.exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: this.options.redirectUri })
    let providerUserId: string | number | undefined = token.uid
    // A successfully exchanged authorization code already proves the user consented.
    // Profile retrieval is best effort because Zhihu OAuth applications can be granted
    // no public-profile scope; do not turn that optional capability into a failed login.
    const profileResponse = await this.fetchImpl(this.url(this.options.userPath), { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } })
    if (profileResponse.ok) {
      const profile = z.object({ id: z.union([z.string(), z.number()]).optional(), uid: z.union([z.string(), z.number()]).optional() }).passthrough().parse(await profileResponse.json())
      providerUserId = profile.id ?? profile.uid ?? providerUserId
    }
    if (!providerUserId) providerUserId = `oauth-${this.hash(token.access_token).slice(0, 24)}`

    const now = new Date().toISOString()
    const sealed = this.encrypt(JSON.stringify(token))
    this.repository.db.transaction(() => {
      const consumed = this.repository.db.prepare(
        'UPDATE oauth_authorization_states SET consumed_at = ? WHERE id = ? AND learner_id = ? AND consumed_at IS NULL',
      ).run(now, stateRow.id, learnerId)
      if (consumed.changes !== 1) throw new LabError('oauth_state_invalid', 'OAuth state 已被消费', 400)
      this.repository.db.prepare(`
        INSERT INTO provider_connections(
          id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag,
          token_expires_at, scopes_json, status, created_at, updated_at
        ) VALUES (?, ?, 'zhihu', ?, ?, ?, ?, ?, ?, 'active', ?, ?)
        ON CONFLICT(learner_id, provider) DO UPDATE SET
          provider_user_id=excluded.provider_user_id, token_ciphertext=excluded.token_ciphertext,
          token_iv=excluded.token_iv, token_tag=excluded.token_tag,
          token_expires_at=excluded.token_expires_at, scopes_json=excluded.scopes_json,
          status='active', updated_at=excluded.updated_at
      `).run(
        randomUUID(), learnerId, String(providerUserId), sealed.ciphertext, sealed.iv, sealed.tag,
        token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
        JSON.stringify(token.scope?.split(/\s+/).filter(Boolean) ?? this.options.scopes.split(/\s+/).filter(Boolean)), now, now,
      )
    })()
  }

  connections(learnerId: string) {
    const rows = this.repository.db.prepare(
      "SELECT provider, provider_user_id providerUserId, status, scopes_json scopesJson FROM provider_connections WHERE learner_id = ? AND provider = 'zhihu'",
    ).all(learnerId) as Array<Record<string, unknown>>
    if (rows.length === 0) return [{ provider: 'zhihu' as const, status: 'disconnected' as const, scopes: [] as string[] }]
    return rows.map((row) => ({
      provider: 'zhihu' as const,
      status: row.status === 'active' ? 'connected' as const : 'pending' as const,
      account: row.providerUserId == null ? undefined : String(row.providerUserId),
      scopes: this.json<string[]>(row.scopesJson, []),
    }))
  }

  syncAll(learnerId: string, clientRequestId: string) {
    const existing = this.repository.db.prepare(
      'SELECT * FROM source_sync_jobs WHERE learner_id = ? AND provider = ? AND client_request_id = ?',
    ).get(learnerId, 'zhihu', clientRequestId) as ConnectionRow | undefined
    if (existing) {
      if (existing.status === 'failed') {
        const timestamp = new Date().toISOString()
        this.repository.db.prepare(`
          UPDATE source_sync_jobs SET status='queued',completed_at=NULL,error_code=NULL,error_message=NULL,updated_at=?
          WHERE id=? AND learner_id=? AND status='failed'
        `).run(timestamp, existing.id, learnerId)
        queueMicrotask(() => { void this.runSync(String(existing.id)).catch(() => undefined) })
        return this.publicJob(this.job(String(existing.id)))
      }
      return this.publicJob(existing)
    }
    this.connection(learnerId)
    const id = randomUUID()
    const now = new Date().toISOString()
    this.repository.db.prepare(`
      INSERT INTO source_sync_jobs(id, learner_id, provider, sync_kind, status, client_request_id, created_at, updated_at)
      VALUES (?, ?, 'zhihu', 'all', 'queued', ?, ?, ?)
    `).run(id, learnerId, clientRequestId, now, now)
    queueMicrotask(() => { void this.runSync(id).catch(() => undefined) })
    return this.publicJob(this.job(id))
  }

  resume(): void {
    const rows = this.repository.db.prepare(
      "SELECT id FROM source_sync_jobs WHERE provider = 'zhihu' AND status IN ('queued','running') ORDER BY created_at LIMIT 10",
    ).all() as Array<{ id: string }>
    for (const row of rows) queueMicrotask(() => { void this.runSync(row.id).catch(() => undefined) })
  }

  syncJobs(learnerId: string) {
    return (this.repository.db.prepare(
      'SELECT * FROM source_sync_jobs WHERE learner_id = ? ORDER BY created_at DESC LIMIT 20',
    ).all(learnerId) as ConnectionRow[]).map((row) => this.publicJob(row))
  }

  syncJob(learnerId: string, id: string) {
    const row = this.repository.db.prepare(
      'SELECT * FROM source_sync_jobs WHERE id=? AND learner_id=?',
    ).get(id, learnerId) as ConnectionRow | undefined
    if (!row) throw new LabError('source_sync_not_found', '同步任务不存在', 404)
    return this.publicJob(row)
  }

  collections(learnerId: string) {
    return this.repository.db.prepare(`
      SELECT c.id, c.title name, COUNT(ci.source_item_id) itemCount, c.updated_at updatedAt
      FROM external_source_collections c
      LEFT JOIN external_source_collection_items ci ON ci.collection_id = c.id
      WHERE c.learner_id = ? AND c.status = 'active'
      GROUP BY c.id ORDER BY c.updated_at DESC
    `).all(learnerId)
  }

  items(learnerId: string, query?: string, collectionId?: string) {
    const pattern = `%${(query ?? '').trim()}%`
    const collectionJoin = collectionId ? 'JOIN external_source_collection_items ci ON ci.source_item_id = i.id AND ci.collection_id = ?' : ''
    const params = collectionId ? [collectionId, learnerId, pattern, pattern] : [learnerId, pattern, pattern]
    const rows = this.repository.db.prepare(`
      SELECT i.id, i.title, i.excerpt, i.author, i.url, i.saved, i.published_at publishedAt, i.tags_json tagsJson
      FROM learner_source_items i ${collectionJoin}
      WHERE i.learner_id = ? AND i.status = 'active' AND (i.title LIKE ? OR i.excerpt LIKE ?)
      ORDER BY i.updated_at DESC LIMIT 50
    `).all(...params) as Array<Record<string, unknown>>
    return { items: rows.map((row) => ({ ...row, saved: Boolean(row.saved), collectionId: collectionId ?? null, tags: this.json<string[]>(row.tagsJson, []) })), nextCursor: null }
  }

  async search(learnerId: string, query: string) {
    const normalized = query.trim().replace(/\s+/g, ' ').slice(0, 200)
    if (!normalized) return this.items(learnerId, '')
    if (this.options.publicSearch?.configured) {
      try {
        const results = await this.options.publicSearch.search(normalized, 10)
        const timestamp = new Date().toISOString()
        const upsert = this.repository.db.prepare(`
          INSERT INTO learner_source_items(
            id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,
            content_hash,status,saved,tags_json,published_at,removed_at,created_at,updated_at
          ) VALUES(?,?,'zhihu',?,?,?,?,?,?,'public',?,'active',0,'[]',NULL,NULL,?,?)
          ON CONFLICT(learner_id,provider,external_id) DO UPDATE SET
            url=excluded.url,title=excluded.title,author=excluded.author,excerpt=excluded.excerpt,
            content_json=excluded.content_json,content_hash=excluded.content_hash,
            visibility='public',status='active',removed_at=NULL,updated_at=excluded.updated_at
        `)
        this.repository.db.transaction(() => {
          for (const result of results) {
            if (!result.externalId) continue
            const normalizedResult = JSON.stringify({ retrievedAt: result.retrievedAt, metadata: result.metadata, query: normalized })
            upsert.run(
              randomUUID(), learnerId, result.externalId, result.url, result.title, result.author,
              result.excerpt.slice(0, 4000), normalizedResult, this.hash(`${result.url}\n${result.title}\n${result.excerpt}`), timestamp, timestamp,
            )
          }
        })()
      } catch {
        const local = this.items(learnerId, normalized)
        if (local.items.length > 0) return local
        throw new LabError('zhihu_search_failed', '知乎公共搜索暂时不可用', 503, true)
      }
    }
    return this.items(learnerId, normalized)
  }

  save(learnerId: string, sourceItemId: string) {
    const changed = this.repository.db.prepare(
      "UPDATE learner_source_items SET saved = 1, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'active'",
    ).run(new Date().toISOString(), sourceItemId, learnerId)
    if (changed.changes !== 1) throw new LabError('source_item_not_found', '来源内容不存在', 404)
    return { id: sourceItemId, saved: true }
  }

  disconnect(learnerId: string) {
    this.repository.db.transaction(() => {
      this.repository.db.prepare(`
        DELETE FROM external_source_collection_items
        WHERE source_item_id IN (
          SELECT i.id FROM learner_source_items i
          WHERE i.learner_id = ? AND i.provider = 'zhihu'
            AND NOT EXISTS (SELECT 1 FROM practice_card_sources pcs WHERE pcs.source_item_id = i.id)
        )
      `).run(learnerId)
      this.repository.db.prepare(`
        DELETE FROM learner_source_items
        WHERE learner_id = ? AND provider = 'zhihu'
          AND NOT EXISTS (SELECT 1 FROM practice_card_sources pcs WHERE pcs.source_item_id = learner_source_items.id)
      `).run(learnerId)
      this.repository.db.prepare(`
        UPDATE learner_source_items SET content_json = '{}', status = 'removed', removed_at = ?, updated_at = ?
        WHERE learner_id = ? AND provider = 'zhihu'
      `).run(new Date().toISOString(), new Date().toISOString(), learnerId)
      this.repository.db.prepare("DELETE FROM external_source_collections WHERE learner_id = ? AND provider = 'zhihu'").run(learnerId)
      this.repository.db.prepare("DELETE FROM provider_connections WHERE learner_id = ? AND provider = 'zhihu'").run(learnerId)
    })()
    return { disconnected: true }
  }

  private async runSync(jobId: string): Promise<void> {
    const job = this.job(jobId)
    if (job.status === 'completed') return
    const learnerId = String(job.learner_id)
    const connection = this.connection(learnerId)
    const startedAt = new Date().toISOString()
    this.repository.db.prepare(
      "UPDATE source_sync_jobs SET status = 'running', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?",
    ).run(startedAt, startedAt, jobId)
    try {
      const checkpoint = this.json<SyncCursor | null>(job.cursor, null)
      let imported = checkpoint?.imported ?? Number(job.imported_count ?? 0)
      let updated = checkpoint?.updated ?? Number(job.updated_count ?? 0)
      const collections = await this.fetchAll(connection, this.options.collectionsPath, 5000)
      for (let index = 0; index < collections.length; index += 1) {
        if (checkpoint && checkpoint.phase !== 'favorites') break
        if (checkpoint?.phase === 'favorites' && index < checkpoint.collectionIndex) continue
        const collection = collections[index]
        const collectionId = this.upsertCollection(learnerId, connection, collection, 'favorites')
        const path = this.options.collectionItemsPath.replace('{collection_id}', encodeURIComponent(collection.id))
        const resumePath = checkpoint?.phase === 'favorites' && checkpoint.collectionIndex === index ? checkpoint.next : path
        const result = await this.syncItems(jobId, learnerId, connection, collectionId, resumePath, Math.max(0, 5000 - imported - updated), {
          phase: 'favorites', collectionIndex: index, imported, updated,
        }, resumePath === path)
        imported += result.imported
        updated += result.updated
        if (imported + updated >= 5000) break
      }
      for (const [phase, kind, path, limit] of [
        ['own', 'own', this.options.contentPath, 200],
        ['activities', 'activities', this.options.momentsPath, 200],
      ] as const) {
        if (checkpoint?.phase === 'activities' && phase === 'own') continue
        const collectionId = this.upsertSyntheticCollection(learnerId, connection, kind)
        const resumePath = checkpoint?.phase === phase ? checkpoint.next : path
        const result = await this.syncItems(jobId, learnerId, connection, collectionId, resumePath, limit, {
          phase, collectionIndex: 0, imported, updated,
        }, resumePath === path)
        imported += result.imported
        updated += result.updated
      }
      this.repository.db.prepare(`
        UPDATE learner_source_items SET status='removed',removed_at=?,updated_at=?
        WHERE learner_id=? AND provider='zhihu' AND visibility='private' AND status='active'
          AND NOT EXISTS (SELECT 1 FROM external_source_collection_items ci WHERE ci.source_item_id=learner_source_items.id)
          AND NOT EXISTS (SELECT 1 FROM practice_card_sources pcs WHERE pcs.source_item_id=learner_source_items.id)
      `).run(new Date().toISOString(), new Date().toISOString(), learnerId)
      const completedAt = new Date().toISOString()
      this.repository.db.prepare(`
        UPDATE source_sync_jobs SET status='completed', imported_count=?, updated_count=?, cursor=NULL,
          completed_at=?, updated_at=?, error_code=NULL, error_message=NULL WHERE id=?
      `).run(imported, updated, completedAt, completedAt, jobId)
    } catch (error) {
      const safe = publicError(error)
      this.repository.db.prepare(`
        UPDATE source_sync_jobs SET status='failed', error_code=?, error_message=?, completed_at=?, updated_at=? WHERE id=?
      `).run(safe.code, safe.message, new Date().toISOString(), new Date().toISOString(), jobId)
      throw error
    }
  }

  private async syncItems(jobId: string, learnerId: string, connection: ConnectionRow, collectionId: string, initialPath: string | null, limit: number, base: Omit<SyncCursor, 'next'>, fresh: boolean) {
    let imported = 0
    let updated = 0
    let next = initialPath
    let firstPage = true
    while (next && imported + updated < limit) {
      const parsed = pageSchema.parse(await this.authorizedPage(connection, next))
      const items = (parsed.data ?? parsed.items ?? parsed.results ?? []).slice(0, limit - imported - updated)
      const nextCursor = parsed.cursor ?? parsed.paging?.next ?? null
      const pageResult = this.persistSourcePage(jobId, learnerId, collectionId, items, imported, updated, base, nextCursor, fresh && firstPage)
      imported += pageResult.imported
      updated += pageResult.updated
      next = nextCursor
      firstPage = false
    }
    return { imported, updated }
  }

  private persistSourcePage(jobId: string, learnerId: string, collectionId: string, items: SourceItem[], priorImported: number, priorUpdated: number, base: Omit<SyncCursor, 'next'>, next: string | null, clearCollection: boolean) {
    let imported = 0
    let updated = 0
    const timestamp = new Date().toISOString()
    this.repository.db.transaction(() => {
      if (clearCollection) this.repository.db.prepare('DELETE FROM external_source_collection_items WHERE collection_id=?').run(collectionId)
      for (const item of items) {
        const exists = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND external_id=?").get(learnerId, item.id) as { id: string } | undefined
        const sourceId = exists?.id ?? randomUUID()
        const title = item.title ?? item.name ?? '知乎内容'
        const url = item.url ?? item.link ?? `https://www.zhihu.com/content/${encodeURIComponent(item.id)}`
        const author = typeof item.author === 'string' ? item.author : item.author?.name ?? null
        const excerpt = (item.excerpt ?? item.summary ?? '').slice(0, 4000)
        const metadata = JSON.stringify({ externalId: item.id, sourceKind: 'oauth_sync', publishedAt: asIso(item.published_at) })
        this.repository.db.prepare(`
          INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,published_at,removed_at,created_at,updated_at)
          VALUES(?,?,'zhihu',?,?,?,?,?,?,'private',?,'active',1,'[]',?,NULL,?,?)
          ON CONFLICT(learner_id,provider,external_id) DO UPDATE SET url=excluded.url,title=excluded.title,author=excluded.author,
            excerpt=excluded.excerpt,content_json=excluded.content_json,content_hash=excluded.content_hash,visibility='private',status='active',
            removed_at=NULL,published_at=excluded.published_at,updated_at=excluded.updated_at
        `).run(sourceId, learnerId, item.id, url, title, author, excerpt, metadata, this.hash(`${url}\n${title}\n${excerpt}`), asIso(item.published_at), timestamp, timestamp)
        this.repository.db.prepare('INSERT OR IGNORE INTO external_source_collection_items(collection_id,source_item_id,position,created_at) VALUES(?,?,?,?)').run(collectionId, sourceId, priorImported + priorUpdated + imported + updated, timestamp)
        if (exists) updated += 1
        else imported += 1
      }
      const cursor: SyncCursor = { ...base, next, imported: base.imported + priorImported + imported, updated: base.updated + priorUpdated + updated }
      this.repository.db.prepare('UPDATE source_sync_jobs SET cursor=?,imported_count=?,updated_count=?,updated_at=? WHERE id=?').run(
        JSON.stringify(cursor), cursor.imported, cursor.updated, timestamp, jobId,
      )
    })()
    return { imported, updated }
  }

  private async fetchAll(connection: ConnectionRow, initialPath: string, limit: number): Promise<SourceItem[]> {
    const output: SourceItem[] = []
    let next: string | null = initialPath
    while (next && output.length < limit) {
      const page = await this.authorizedPage(connection, next)
      const parsed = pageSchema.parse(page)
      output.push(...(parsed.data ?? parsed.items ?? parsed.results ?? []).slice(0, limit - output.length))
      next = parsed.cursor ?? parsed.paging?.next ?? null
    }
    return output
  }

  private async authorizedPage(connection: ConnectionRow, path: string): Promise<unknown> {
    let token = this.token(connection)
    let refreshed = false
    while (true) {
      const response = await this.fetchWithRateLimit(this.url(path), { headers: { Authorization: `Bearer ${token.access_token}`, Accept: 'application/json' } })
      if (response.status === 401 && !refreshed) {
        refreshed = true
        if (!token.refresh_token) {
          this.markReauthorization(String(connection.id))
          throw new LabError('reauthorization_required', '知乎连接需要重新授权', 401)
        }
        token = await this.exchangeToken({ grant_type: 'refresh_token', refresh_token: token.refresh_token })
        this.updateToken(connection, token)
        continue
      }
      if (!response.ok) throw new LabError(response.status >= 500 ? 'zhihu_unavailable' : 'zhihu_request_failed', '知乎接口暂时不可用', response.status >= 500 ? 503 : 502)
      return response.json()
    }
  }

  private async fetchWithRateLimit(url: string, init: RequestInit): Promise<Response> {
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const response = await this.fetchImpl(url, init)
      if (response.status !== 429 || attempt === 3) return response
      const retryAfter = Math.max(0, Number(response.headers.get('retry-after') ?? 0)) * 1000
      const delay = retryAfter || Math.min(4_000, 250 * 2 ** attempt) + Math.floor(Math.random() * 100)
      await this.sleep(delay)
    }
    throw new LabError('zhihu_rate_limited', '知乎接口请求过于频繁', 503)
  }

  private async exchangeToken(payload: Record<string, string>): Promise<Token> {
    const form = new URLSearchParams({ ...payload, app_id: this.options.clientId, app_key: this.options.clientSecret })
    const response = await this.fetchImpl(this.url(this.options.tokenPath), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: form.toString(),
    })
    if (!response.ok) throw new LabError('oauth_token_exchange_failed', '知乎 OAuth token 交换失败', 502)
    return tokenSchema.parse(await response.json())
  }

  private upsertCollection(learnerId: string, connection: ConnectionRow, item: SourceItem, kind: string): string {
    const existing = this.repository.db.prepare(
      "SELECT id FROM external_source_collections WHERE learner_id=? AND provider='zhihu' AND external_id=? AND kind=?",
    ).get(learnerId, item.id, kind) as { id: string } | undefined
    const id = existing?.id ?? randomUUID()
    const now = new Date().toISOString()
    this.repository.db.prepare(`
      INSERT INTO external_source_collections(id,learner_id,connection_id,provider,external_id,kind,title,status,metadata_json,created_at,updated_at)
      VALUES(?,?,?,'zhihu',?,?,?,'active','{}',?,?)
      ON CONFLICT(learner_id,provider,external_id,kind) DO UPDATE SET title=excluded.title,status='active',updated_at=excluded.updated_at
    `).run(id, learnerId, connection.id, item.id, kind, item.title ?? item.name ?? '知乎收藏夹', now, now)
    return id
  }

  private upsertSyntheticCollection(learnerId: string, connection: ConnectionRow, kind: string): string {
    return this.upsertCollection(learnerId, connection, { id: kind, title: kind === 'own' ? '我的内容' : '关注动态' }, kind)
  }

  private connection(learnerId: string): ConnectionRow {
    const row = this.repository.db.prepare(
      "SELECT * FROM provider_connections WHERE learner_id=? AND provider='zhihu' AND status='active'",
    ).get(learnerId) as ConnectionRow | undefined
    if (!row) throw new LabError('zhihu_not_connected', '知乎尚未连接', 409)
    return row
  }

  private token(connection: ConnectionRow): Token {
    try { return tokenSchema.parse(JSON.parse(this.decrypt(connection))) }
    catch { throw new LabError('oauth_token_unreadable', '知乎连接凭据无法读取，请重新授权', 409) }
  }

  private updateToken(connection: ConnectionRow, token: Token): void {
    const sealed = this.encrypt(JSON.stringify(token))
    this.repository.db.prepare(`
      UPDATE provider_connections SET token_ciphertext=?,token_iv=?,token_tag=?,token_expires_at=?,status='active',updated_at=? WHERE id=?
    `).run(sealed.ciphertext, sealed.iv, sealed.tag, token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null, new Date().toISOString(), connection.id)
    connection.token_ciphertext = sealed.ciphertext
    connection.token_iv = sealed.iv
    connection.token_tag = sealed.tag
  }

  private markReauthorization(connectionId: string): void {
    this.repository.db.prepare("UPDATE provider_connections SET status='reauthorization_required',updated_at=? WHERE id=?").run(new Date().toISOString(), connectionId)
  }

  private job(id: string): ConnectionRow {
    const row = this.repository.db.prepare('SELECT * FROM source_sync_jobs WHERE id=?').get(id) as ConnectionRow | undefined
    if (!row) throw new LabError('source_sync_not_found', '同步任务不存在', 404)
    return row
  }

  private publicJob(row: ConnectionRow) {
    return {
      id: String(row.id), provider: 'zhihu' as const, status: row.status,
      importedCount: Number(row.imported_count ?? 0), updatedCount: Number(row.updated_count ?? 0),
      errorMessage: row.error_message == null ? null : String(row.error_message),
      startedAt: row.started_at == null ? null : String(row.started_at),
      completedAt: row.completed_at == null ? null : String(row.completed_at),
    }
  }

  private hash(value: string): string { return createHash('sha256').update(value).digest('hex') }
  private key(): Buffer { return createHash('sha256').update(this.options.encryptionKey).digest() }
  private json<T>(value: unknown, fallback: T): T { try { return typeof value === 'string' ? JSON.parse(value) as T : fallback } catch { return fallback } }
  private url(path: string): string { return /^https?:\/\//.test(path) ? path : `${this.options.baseUrl.replace(/\/$/, '')}/${path.replace(/^\//, '')}` }
  private encrypt(value: string) { const iv=randomBytes(12); const cipher=createCipheriv('aes-256-gcm',this.key(),iv); const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]); return {ciphertext:ciphertext.toString('base64'),iv:iv.toString('base64'),tag:cipher.getAuthTag().toString('base64')} }
  private decrypt(row: ConnectionRow) { const decipher=createDecipheriv('aes-256-gcm',this.key(),Buffer.from(String(row.token_iv),'base64')); decipher.setAuthTag(Buffer.from(String(row.token_tag),'base64')); return Buffer.concat([decipher.update(Buffer.from(String(row.token_ciphertext),'base64')),decipher.final()]).toString('utf8') }
}
