import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from 'node:crypto'
import { z } from 'zod'
import type { ProductRepository } from './product-repository.js'
import { LabError } from './errors.js'

export const ZHIHU_OAUTH_CALLBACK = 'http://119.45.243.102/api/auth/oauth/zhihu/callback'

// Completion plan P4.1: bounded per-run caps. Exceeding a cap keeps the
// per-collection cursor so the next sync cycle resumes instead of losing data.
const FAVORITES_CAP = 5000
const OWN_CAP = 200
const ACTIVITIES_CAP = 200
const ACTIVITIES_WINDOW_DAYS = 30
const MAX_FAVLIST_PAGES_PER_RUN = 20

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
export type ZhihuPublicProfile = { displayName: string | null; avatarUrl: string | null; profileUrl: string | null }
export type ZhihuCallbackResult = { learnerId: string; profile: ZhihuPublicProfile | null }
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
  dataPlatformBaseUrl: string
  dataPlatformAccessSecret: string
  collectionsPath: string
  contentPath: string
  followeesPath: string
  favlistsPath: string
  favlistContentsPath: string
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

function safeString(value: unknown, maximum = 1000): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, maximum) : null
}

function safeHttpUrl(value: unknown): string | null {
  const candidate = safeString(value, 2048)
  if (!candidate) return null
  try {
    const url = new URL(candidate)
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return null
    if (url.username || url.password) return null
    return url.toString()
  } catch { return null }
}

// Canonical URL for the triple-dedupe rule: strip fragments and UTM tracking
// params, sort remaining params, and drop a trailing slash so the same article
// reached through different entry URLs resolves to one source row.
function canonicalUrl(value: string): string {
  const trimmed = value.trim()
  try {
    const url = new URL(trimmed)
    url.hash = ''
    for (const key of [...url.searchParams.keys()]) if (/^utm_/i.test(key)) url.searchParams.delete(key)
    url.searchParams.sort()
    return url.toString().replace(/\/$/, '')
  } catch { return trimmed }
}

// Content fingerprint for the triple-dedupe rule: title + author + excerpt only,
// deliberately excluding the URL so the same content fetched from search and
// from a favorite list still dedupes into one source row.
function contentFingerprint(title: string, author: string | null, excerpt: string): string {
  return createHash('sha256').update(`${title.trim()}\n${(author ?? '').trim()}\n${excerpt.trim()}`).digest('hex')
}

function stableProviderId(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const normalized = String(value).trim()
  return normalized && normalized.length <= 512 ? normalized : null
}

function publicProfile(value: unknown): { providerUserId: string | null; profile: ZhihuPublicProfile | null } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { providerUserId: null, profile: null }
  const record = value as Record<string, unknown>
  const providerUserId = stableProviderId(record.id) ?? stableProviderId(record.uid) ?? stableProviderId(record.url_token)
  const profile: ZhihuPublicProfile = {
    displayName: safeString(record.name, 512) ?? safeString(record.display_name, 512) ?? safeString(record.displayName, 512),
    avatarUrl: safeHttpUrl(record.avatar_url) ?? safeHttpUrl(record.avatarUrl),
    profileUrl: safeHttpUrl(record.profile_url) ?? safeHttpUrl(record.profileUrl) ?? safeHttpUrl(record.url),
  }
  return { providerUserId, profile: profile.displayName || profile.avatarUrl || profile.profileUrl ? profile : null }
}

function storedPublicProfile(value: unknown): ZhihuPublicProfile | null {
  if (typeof value !== 'string') return null
  try {
    const profile = publicProfile(JSON.parse(value)).profile
    return profile
  } catch { return null }
}

export class ZhihuGateway {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (milliseconds: number) => Promise<void>

  constructor(private readonly repository: ProductRepository, private readonly options: ZhihuGatewayOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.sleep = options.sleep ?? ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)))
  }

  start(learnerId: string, sessionId?: string | null): { authorizationUrl: string; expiresInSeconds: number } {
    if (this.options.redirectUri !== ZHIHU_OAUTH_CALLBACK) throw new LabError('oauth_callback_invalid', 'OAuth 回调地址未按部署契约配置', 500)
    if (!this.options.clientId || !this.options.clientSecret) throw new LabError('oauth_not_configured', '知乎 OAuth 尚未配置', 503)
    if (this.options.redirectUri.startsWith('http://') && !this.options.allowInsecureCallback) throw new LabError('oauth_insecure_callback_disabled', 'HTTP OAuth 回调未显式启用', 503)

    const state = randomBytes(32).toString('base64url')
    const createdAt = new Date()
    this.repository.db.prepare(
      'INSERT INTO oauth_authorization_states(id, learner_id, learner_session_id, provider, state_hash, redirect_uri, expires_at, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).run(randomUUID(), learnerId, sessionId ?? null, 'zhihu', this.hash(state), this.options.redirectUri, new Date(createdAt.getTime() + 5 * 60_000).toISOString(), createdAt.toISOString())

    const url = new URL(this.options.authorizePath, this.options.baseUrl)
    // Zhihu's OAuth application contract uses app_id (not the generic OAuth client_id).
    url.searchParams.set('app_id', this.options.clientId)
    url.searchParams.set('redirect_uri', this.options.redirectUri)
    url.searchParams.set('response_type', 'code')
    url.searchParams.set('state', state)
    if (this.options.scopes.trim()) url.searchParams.set('scope', this.options.scopes.trim())
    return { authorizationUrl: url.toString(), expiresInSeconds: 300 }
  }

  async callback(learnerId: string, sessionId: string, state: string, code: string): Promise<ZhihuCallbackResult> {
    // The state is bound to the concrete device session that started the flow.
    // Replaying a captured state on another session, after expiry, or after it
    // was already consumed all resolve to the same safe oauth_state_invalid.
    const stateRow = this.repository.db.prepare(
      "SELECT * FROM oauth_authorization_states WHERE provider = 'zhihu' AND learner_id = ? AND learner_session_id = ? AND state_hash = ? AND consumed_at IS NULL AND expires_at > ?",
    ).get(learnerId, sessionId, this.hash(state), new Date().toISOString()) as ConnectionRow | undefined
    if (!stateRow) throw new LabError('oauth_state_invalid', 'OAuth state 无效、已使用、跨会话或已过期', 400)

    const token = await this.exchangeToken({ grant_type: 'authorization_code', code, redirect_uri: this.options.redirectUri })
    // Zhihu's published OAuth contract does not document a profile endpoint or
    // a provider-id response. A verified uid supplied with the token is the
    // only identity evidence accepted here; never derive identity from a token.
    const endpointIdentity: { providerUserId: string | null; profile: ZhihuPublicProfile | null } = { providerUserId: null, profile: null }
    const providerUserId = stableProviderId(token.uid)
    if (!providerUserId) throw new LabError('oauth_provider_identity_unavailable', '无法确认知乎账号身份，请重新授权', 502)

    const now = new Date().toISOString()
    const sealed = this.encrypt(JSON.stringify(token))
    return this.repository.db.transaction(() => {
      const consumed = this.repository.db.prepare(
        'UPDATE oauth_authorization_states SET consumed_at = ? WHERE id = ? AND learner_id = ? AND learner_session_id = ? AND consumed_at IS NULL',
      ).run(now, stateRow.id, learnerId, sessionId)
      if (consumed.changes !== 1) throw new LabError('oauth_state_invalid', 'OAuth state 已被消费', 400)
      const existing = this.repository.db.prepare(`
        SELECT learner_id learnerId FROM provider_connections
        WHERE provider = 'zhihu' AND provider_user_id = ? LIMIT 1
      `).get(providerUserId) as { learnerId: string } | undefined
      // Never silently merge two learner histories: if this Zhihu account is
      // already bound to another learner, the caller must resolve the conflict
      // explicitly. This also prevents a re-auth callback from silently creating
      // an empty learner or abandoning the device learner's existing history.
      if (existing && existing.learnerId !== learnerId) throw new LabError('identity_merge_required', '该知乎账号已绑定其他学习档案，请先断开该账号或使用对应账号登录', 409)
      const current = this.repository.db.prepare(
        "SELECT provider_user_id providerUserId FROM provider_connections WHERE learner_id = ? AND provider = 'zhihu'",
      ).get(learnerId) as { providerUserId: string | null } | undefined
      if (current?.providerUserId && current.providerUserId !== providerUserId) throw new LabError('identity_merge_required', '当前学习档案已绑定其他知乎账号，请先断开后再连接新账号', 409)
      const canonicalLearnerId = learnerId
      this.repository.db.prepare(`
        INSERT INTO provider_connections(
          id, learner_id, provider, provider_user_id, token_ciphertext, token_iv, token_tag,
          token_expires_at, scopes_json, status, profile_json, created_at, updated_at
        ) VALUES (?, ?, 'zhihu', ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
        ON CONFLICT(learner_id, provider) DO UPDATE SET
          provider_user_id=excluded.provider_user_id, token_ciphertext=excluded.token_ciphertext,
          token_iv=excluded.token_iv, token_tag=excluded.token_tag,
          token_expires_at=excluded.token_expires_at, scopes_json=excluded.scopes_json,
          status='active', profile_json=excluded.profile_json, updated_at=excluded.updated_at
      `).run(
        randomUUID(), canonicalLearnerId, providerUserId, sealed.ciphertext, sealed.iv, sealed.tag,
        token.expires_in ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null,
        JSON.stringify(token.scope?.split(/\s+/).filter(Boolean) ?? this.options.scopes.split(/\s+/).filter(Boolean)), JSON.stringify(endpointIdentity.profile ?? {}), now, now,
      )
      return { learnerId: canonicalLearnerId, profile: endpointIdentity.profile }
    })()
  }

  connections(learnerId: string) {
    const rows = this.repository.db.prepare(
      "SELECT provider, provider_user_id providerUserId, status, scopes_json scopesJson, profile_json profileJson FROM provider_connections WHERE learner_id = ? AND provider = 'zhihu'",
    ).all(learnerId) as Array<Record<string, unknown>>
    if (rows.length === 0) return [{ provider: 'zhihu' as const, status: 'disconnected' as const, scopes: [] as string[] }]
    return rows.map((row) => {
      const providerUserId = typeof row.providerUserId === 'string' && row.providerUserId.trim() ? row.providerUserId.trim() : null
      const connected = row.status === 'active' && providerUserId !== null
      const status = row.status === 'reauthorization_required' ? 'reauthorization_required' as const : connected ? 'connected' as const : 'pending' as const
      return {
        provider: 'zhihu' as const,
        status,
        account: providerUserId ?? undefined,
        scopes: this.json<string[]>(row.scopesJson, []),
        profile: status === 'reauthorization_required' ? null : storedPublicProfile(row.profileJson),
      }
    })
  }

  // The session DTO consumes this to distinguish "never connected" from
  // "connected but the token can no longer be used" so the frontend can route
  // to a reauthorization flow instead of showing a broken business page.
  authentication(learnerId: string, required: boolean) {
    const connection = this.repository.db.prepare(
      "SELECT profile_json profileJson, status, provider_user_id providerUserId FROM provider_connections WHERE learner_id = ? AND provider = 'zhihu'",
    ).get(learnerId) as { profileJson: string; status: string; providerUserId: string | null } | undefined
    if (!connection) return { required, authenticated: false, provider: null, profile: null, status: 'disconnected' as const }
    if (connection.status === 'reauthorization_required') return { required, authenticated: false, provider: 'zhihu' as const, profile: null, status: 'reauthorization_required' as const }
    const providerUserId = connection.providerUserId ?? null
    const connected = Boolean(providerUserId && providerUserId.trim().length > 0)
    return {
      required,
      authenticated: connected,
      provider: connected ? 'zhihu' as const : null,
      profile: connected ? storedPublicProfile(connection.profileJson) : null,
      status: connected ? 'connected' as const : 'pending' as const,
    }
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

  items(learnerId: string, query?: string, collectionId?: string): { items: Array<{ id: string; title: string; excerpt: string; author: string | null; url: string; saved: boolean; publishedAt: string | null; tags: string[]; collectionId: string | null }>; nextCursor: null } {
    const pattern = `%${(query ?? '').trim()}%`
    const collectionJoin = collectionId ? 'JOIN external_source_collection_items ci ON ci.source_item_id = i.id AND ci.collection_id = ?' : ''
    const params = collectionId ? [collectionId, learnerId, pattern, pattern] : [learnerId, pattern, pattern]
    const rows = this.repository.db.prepare(`
      SELECT i.id, i.title, i.excerpt, i.author, i.url, i.saved, i.published_at publishedAt, i.tags_json tagsJson
      FROM learner_source_items i ${collectionJoin}
      WHERE i.learner_id = ? AND i.status = 'active' AND (i.title LIKE ? OR i.excerpt LIKE ?)
      ORDER BY i.updated_at DESC LIMIT 50
    `).all(...params) as Array<Record<string, unknown>>
    return {
      items: rows.map((row) => ({
        id: String(row.id), title: String(row.title), excerpt: String(row.excerpt ?? ''),
        author: row.author == null ? null : String(row.author), url: String(row.url),
        saved: Boolean(row.saved), publishedAt: row.publishedAt == null ? null : String(row.publishedAt),
        tags: this.json<string[]>(row.tagsJson, []), collectionId: collectionId ?? null,
      })),
      nextCursor: null,
    }
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
          ON CONFLICT(id) DO UPDATE SET
            external_id=excluded.external_id,url=excluded.url,title=excluded.title,author=excluded.author,excerpt=excluded.excerpt,
            content_json=excluded.content_json,content_hash=excluded.content_hash,
            visibility=CASE WHEN learner_source_items.visibility='private' THEN 'private' ELSE 'public' END,
            saved=learner_source_items.saved,status='active',removed_at=NULL,updated_at=excluded.updated_at
        `)
        this.repository.db.transaction(() => {
          for (const result of results) {
            if (!result.externalId) continue
            const normalizedResult = JSON.stringify({ retrievedAt: result.retrievedAt, metadata: result.metadata, query: normalized })
            // Triple dedupe: reuse an existing row by (provider, external_id),
            // canonical URL, or content hash so a public search hit never
            // duplicates a private favorite already in this learner's library.
            const url = canonicalUrl(result.url)
            const hash = contentFingerprint(result.title, result.author, result.excerpt)
            const sourceId = this.resolveSourceId(learnerId, result.externalId, url, hash) ?? randomUUID()
            upsert.run(
              sourceId, learnerId, result.externalId, url, result.title, result.author,
              result.excerpt.slice(0, 4000), normalizedResult, hash, timestamp, timestamp,
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
      // Collection membership is dropped first so the collections themselves
      // can be removed without violating their FK from collection_items.
      this.repository.db.prepare(`
        DELETE FROM external_source_collection_items
        WHERE collection_id IN (SELECT id FROM external_source_collections WHERE learner_id = ? AND provider = 'zhihu')
      `).run(learnerId)
      this.repository.db.prepare(`
        DELETE FROM learner_source_items
        WHERE learner_id = ? AND provider = 'zhihu'
          AND NOT EXISTS (SELECT 1 FROM practice_card_sources pcs WHERE pcs.source_item_id = learner_source_items.id)
      `).run(learnerId)
      // Sources still referenced by Practice Cards survive as a de-identified
      // snapshot: content is emptied, the row is marked removed, and the card
      // keeps only its digest reference to a non-private record.
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

      // Favorites-list sync: list the user's favourite collections, fetch the
      // homepage of each one first, then follow the documented cursor. We no
      // longer keep only the latest 20 favourites. Full text is never retained;
      // the metadata is enough for source selection.
      if (!checkpoint || checkpoint.phase === 'favorites') {
        const favorites = await this.syncFavorites(jobId, learnerId, connection, checkpoint, imported, updated)
        imported = favorites.imported; updated = favorites.updated
        if (favorites.capped) {
          // The run hit a cap mid-way and only saw a partial remote view: keep
          // the per-collection cursor so the next cycle resumes, and do NOT
          // mark remote sources deleted on a partial view.
          this.saveJobCursor(jobId, { phase: 'favorites', collectionIndex: favorites.collectionIndex, next: favorites.next, imported, updated })
          this.finishSync(jobId, imported, updated, { phase: 'favorites', collectionIndex: favorites.collectionIndex, next: favorites.next, imported, updated })
          return
        }
      }

      // Own content has documented Offset/Limit pagination. We deliberately do
      // not follow arbitrary remote next URLs, preventing provider-driven SSRF.
      if (!checkpoint || checkpoint.phase === 'favorites' || checkpoint.phase === 'own') {
        const own = await this.syncOwn(jobId, learnerId, connection, checkpoint?.phase === 'own' ? checkpoint : null, imported, updated)
        imported = own.imported; updated = own.updated
      }

      // Moments/activities: recent 30 days or at most 200 items, whichever
      // limit is reached first.
      if (!checkpoint || checkpoint.phase === 'favorites' || checkpoint.phase === 'own' || checkpoint.phase === 'activities') {
        const activities = await this.syncActivities(jobId, learnerId, connection, checkpoint?.phase === 'activities' ? checkpoint : null, imported, updated)
        imported = activities.imported; updated = activities.updated
      }

      // Only a complete, uninterrupted cycle knows the full remote view. A
      // partial run (cap hit or error) must not mark sources deleted that we
      // simply have not re-fetched yet.
      this.markRemoteDeleted(learnerId)
      this.finishSync(jobId, imported, updated, null)
    } catch (error) {
      const safe = publicError(error)
      this.repository.db.prepare(`
        UPDATE source_sync_jobs SET status='failed', error_code=?, error_message=?, completed_at=?, updated_at=? WHERE id=?
      `).run(safe.code, safe.message, new Date().toISOString(), new Date().toISOString(), jobId)
      throw error
    }
  }

  private async syncFavorites(jobId: string, learnerId: string, connection: ConnectionRow, checkpoint: SyncCursor | null, imported: number, updated: number): Promise<{ imported: number; updated: number; capped: boolean; collectionIndex: number; next: string | null }> {
    const favlists = await this.favlistItems(await this.authorizedUserPage(connection, this.options.favlistsPath, { Limit: '50' }))
    const startIndex = checkpoint?.phase === 'favorites' && checkpoint.collectionIndex > 0 ? checkpoint.collectionIndex : 0
    for (let index = startIndex; index < favlists.length; index += 1) {
      const favlist = favlists[index]
      const collectionId = this.upsertCollection(learnerId, connection, favlist, 'favorites')
      // Homepage-first on the first visit; afterwards resume from the saved
      // per-collection cursor so a cap never loses already-synced pages.
      const resumeCursor = index === startIndex && checkpoint?.phase === 'favorites' ? checkpoint.next : null
      let next = resumeCursor ?? this.collectionCursor(collectionId)
      if (!next) this.clearCollectionItems(collectionId)
      let pageCount = 0
      let capped = false
      while (pageCount < MAX_FAVLIST_PAGES_PER_RUN) {
        const page = await this.favlistPage(connection, favlist.id, next)
        const items = this.userItems(page)
        const result = this.persistSourcePage(learnerId, collectionId, items, false)
        imported += result.imported; updated += result.updated
        next = this.nextCursor(page)
        this.writeCollectionCursor(collectionId, next)
        pageCount += 1
        if (!next) break
        if (imported + updated >= FAVORITES_CAP) { capped = true; break }
      }
      if (capped || (pageCount >= MAX_FAVLIST_PAGES_PER_RUN && next)) {
        this.saveJobCursor(jobId, { phase: 'favorites', collectionIndex: index, next, imported, updated })
        return { imported, updated, capped: true, collectionIndex: index, next }
      }
      this.saveJobCursor(jobId, { phase: 'favorites', collectionIndex: index + 1, next, imported, updated })
    }
    return { imported, updated, capped: false, collectionIndex: favlists.length, next: null }
  }

  private async syncOwn(jobId: string, learnerId: string, connection: ConnectionRow, checkpoint: SyncCursor | null, imported: number, updated: number): Promise<{ imported: number; updated: number }> {
    const ownCollection = this.upsertSyntheticCollection(learnerId, connection, 'own')
    const startOffset = checkpoint?.phase === 'own' && checkpoint.next ? Number(checkpoint.next) : 0
    for (let offset = Number.isFinite(startOffset) && startOffset >= 0 ? startOffset : 0; offset < OWN_CAP; offset += 50) {
      const page = await this.authorizedUserPage(connection, this.options.contentPath, { ContentType: 'all', Offset: String(offset), Limit: '50' })
      const items = this.userItems(page)
      const result = this.persistSourcePage(learnerId, ownCollection, items, offset === 0)
      imported += result.imported; updated += result.updated
      this.saveJobCursor(jobId, { phase: 'own', collectionIndex: 0, next: String(offset + 50), imported, updated })
      if (this.userPagingEnded(page) || items.length < 50) break
    }
    return { imported, updated }
  }

  private async syncActivities(jobId: string, learnerId: string, connection: ConnectionRow, checkpoint: SyncCursor | null, imported: number, updated: number): Promise<{ imported: number; updated: number }> {
    const activitiesCollection = this.upsertSyntheticCollection(learnerId, connection, 'activities')
    const cutoff = new Date(Date.now() - ACTIVITIES_WINDOW_DAYS * 24 * 3600 * 1000).toISOString()
    const startOffset = checkpoint?.phase === 'activities' && checkpoint.next ? Number(checkpoint.next) : 0
    for (let offset = Number.isFinite(startOffset) && startOffset >= 0 ? startOffset : 0; offset < ACTIVITIES_CAP; offset += 50) {
      const page = await this.authorizedUserPage(connection, this.options.followeesPath, { Offset: String(offset), Limit: '50' })
      const items = this.userItems(page)
      const recentItems = items.filter((item) => { const published = asIso(item.published_at); return published == null || published >= cutoff })
      const result = this.persistSourcePage(learnerId, activitiesCollection, recentItems, offset === 0)
      imported += result.imported; updated += result.updated
      this.saveJobCursor(jobId, { phase: 'activities', collectionIndex: 0, next: String(offset + 50), imported, updated })
      const oldest = items.length > 0 ? asIso(items[items.length - 1].published_at) : null
      if (this.userPagingEnded(page) || items.length < 50 || (oldest != null && oldest < cutoff)) break
    }
    return { imported, updated }
  }

  private markRemoteDeleted(learnerId: string): void {
    this.repository.db.prepare(`
      UPDATE learner_source_items SET status='removed',removed_at=?,updated_at=?
      WHERE learner_id=? AND provider='zhihu' AND visibility='private' AND status='active'
        AND NOT EXISTS (SELECT 1 FROM external_source_collection_items ci WHERE ci.source_item_id=learner_source_items.id)
        AND NOT EXISTS (SELECT 1 FROM practice_card_sources pcs WHERE pcs.source_item_id=learner_source_items.id)
    `).run(new Date().toISOString(), new Date().toISOString(), learnerId)
  }

  private finishSync(jobId: string, imported: number, updated: number, cursor: SyncCursor | null): void {
    const completedAt = new Date().toISOString()
    this.repository.db.prepare(`
      UPDATE source_sync_jobs SET status='completed', imported_count=?, updated_count=?, cursor=?,
        completed_at=?, updated_at=?, error_code=NULL, error_message=NULL WHERE id=?
    `).run(imported, updated, cursor ? JSON.stringify(cursor) : null, completedAt, completedAt, jobId)
  }

  private saveJobCursor(jobId: string, cursor: SyncCursor): void {
    this.repository.db.prepare('UPDATE source_sync_jobs SET cursor=?,imported_count=?,updated_count=?,updated_at=? WHERE id=?')
      .run(JSON.stringify(cursor), cursor.imported, cursor.updated, new Date().toISOString(), jobId)
  }

  private persistSourcePage(learnerId: string, collectionId: string, items: SourceItem[], clearCollection: boolean): { imported: number; updated: number } {
    let localImported = 0
    let localUpdated = 0
    const timestamp = new Date().toISOString()
    this.repository.db.transaction(() => {
      if (clearCollection) this.repository.db.prepare('DELETE FROM external_source_collection_items WHERE collection_id=?').run(collectionId)
      for (const item of items) {
        const title = item.title ?? item.name ?? '知乎内容'
        const url = canonicalUrl(item.url ?? item.link ?? `https://www.zhihu.com/content/${encodeURIComponent(item.id)}`)
        const author = typeof item.author === 'string' ? item.author : item.author?.name ?? null
        const excerpt = (item.excerpt ?? item.summary ?? '').slice(0, 4000)
        const contentHash = contentFingerprint(title, author, excerpt)
        // Triple dedupe: (provider, external_id), canonical URL, then content
        // hash. A page that carries the same article under a different
        // external id still resolves to one learner_source_items row.
        const existingId = this.resolveSourceId(learnerId, item.id, url, contentHash)
        const sourceId = existingId ?? randomUUID()
        const metadata = JSON.stringify({ externalId: item.id, sourceKind: 'oauth_sync', publishedAt: asIso(item.published_at) })
        this.repository.db.prepare(`
          INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,published_at,removed_at,created_at,updated_at)
          VALUES(?,?,'zhihu',?,?,?,?,?,?,'private',?,'active',1,'[]',?,NULL,?,?)
          ON CONFLICT(id) DO UPDATE SET external_id=excluded.external_id,url=excluded.url,title=excluded.title,author=excluded.author,
            excerpt=excluded.excerpt,content_json=excluded.content_json,content_hash=excluded.content_hash,visibility='private',status='active',
            removed_at=NULL,published_at=excluded.published_at,updated_at=excluded.updated_at
        `).run(sourceId, learnerId, item.id, url, title, author, excerpt, metadata, contentHash, asIso(item.published_at), timestamp, timestamp)
        const position = Number((this.repository.db.prepare('SELECT COUNT(*) count FROM external_source_collection_items WHERE collection_id=?').get(collectionId) as { count: number }).count)
        this.repository.db.prepare('INSERT OR IGNORE INTO external_source_collection_items(collection_id,source_item_id,position,created_at) VALUES(?,?,?,?)').run(collectionId, sourceId, position, timestamp)
        if (existingId) localUpdated += 1
        else localImported += 1
      }
    })()
    return { imported: localImported, updated: localUpdated }
  }

  private resolveSourceId(learnerId: string, externalId: string, url: string, contentHash: string): string | null {
    const byExternal = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND external_id=?").get(learnerId, externalId) as { id: string } | undefined
    if (byExternal) return byExternal.id
    const byUrl = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND url=? ORDER BY created_at LIMIT 1").get(learnerId, url) as { id: string } | undefined
    if (byUrl) return byUrl.id
    const byHash = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND content_hash=? ORDER BY created_at LIMIT 1").get(learnerId, contentHash) as { id: string } | undefined
    return byHash?.id ?? null
  }

  private favlistItems(value: unknown): SourceItem[] {
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    const values = body && Array.isArray(body.Items) ? body.Items : body && Array.isArray(body.items) ? body.items : []
    return values.flatMap((value) => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
      if (!item) return []
      const id = safeString(item.Id ?? item.id ?? item.FavlistId ?? item.favlist_id, 512)
      const title = safeString(item.Title ?? item.title ?? item.Name ?? item.name, 1000)
      if (!id || !title) return []
      const url = safeHttpUrl(item.Url ?? item.url) ?? `https://www.zhihu.com/favlist/${encodeURIComponent(id)}`
      return [{ id, title, name: title, url }]
    })
  }

  private async favlistPage(connection: ConnectionRow, favlistId: string, cursor: string | null): Promise<unknown> {
    const query: Record<string, string> = { FavlistId: favlistId, Limit: '50' }
    if (cursor) query.Cursor = cursor
    return this.authorizedUserPage(connection, this.options.favlistContentsPath, query)
  }

  private nextCursor(value: unknown): string | null {
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    if (!body) return null
    const paging = body.Paging && typeof body.Paging === 'object' ? body.Paging as Record<string, unknown> : body.paging && typeof body.paging === 'object' ? body.paging as Record<string, unknown> : null
    if (paging) for (const key of ['Next', 'next', 'Cursor', 'cursor']) if (typeof paging[key] === 'string' && paging[key]) return String(paging[key])
    for (const key of ['Cursor', 'cursor', 'Next', 'next']) if (typeof body[key] === 'string' && body[key]) return String(body[key])
    return null
  }

  private collectionCursor(collectionId: string): string | null {
    const row = this.repository.db.prepare('SELECT cursor FROM external_source_collections WHERE id=?').get(collectionId) as { cursor: string | null } | undefined
    return row?.cursor ?? null
  }

  private writeCollectionCursor(collectionId: string, next: string | null): void {
    this.repository.db.prepare('UPDATE external_source_collections SET cursor=?, updated_at=? WHERE id=?').run(next, new Date().toISOString(), collectionId)
  }

  private clearCollectionItems(collectionId: string): void {
    this.repository.db.prepare('DELETE FROM external_source_collection_items WHERE collection_id=?').run(collectionId)
  }

  private async authorizedUserPage(connection: ConnectionRow, path: string, query: Record<string, string>): Promise<unknown> {
    if (!this.options.dataPlatformAccessSecret) throw new LabError('zhihu_capability_disabled', '知乎用户数据同步尚未启用', 503)
    const token = this.token(connection)
    const url = new URL(path, this.options.dataPlatformBaseUrl)
    for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value)
    const response = await this.fetchWithRateLimit(url.toString(), {
      headers: {
        Authorization: `Bearer ${this.options.dataPlatformAccessSecret}`,
        'X-OAuth-Token': token.access_token,
        'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)),
        Accept: 'application/json',
      },
    })
    const raw = await response.text()
    if (response.status === 401) {
      this.markReauthorization(String(connection.id))
      throw new LabError('reauthorization_required', '知乎连接需要重新授权', 401)
    }
    if (response.status === 429) throw new LabError('zhihu_rate_limited', '知乎接口请求过于频繁', 503, true)
    if (response.status >= 500) throw new LabError('zhihu_upstream_unavailable', '知乎接口暂时不可用', 503, true)
    let parsed: unknown
    try { parsed = raw ? JSON.parse(raw) : null } catch { throw new LabError(response.ok ? 'zhihu_schema_invalid' : 'zhihu_http_error', response.ok ? '知乎接口响应格式无效' : '知乎接口请求未成功', response.ok ? 502 : 502) }
    const envelope = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : null
    const code = envelope?.Code ?? envelope?.code
    const success = code === 0 || code === '0'
    if (!response.ok || !success) throw new LabError(code === 30001 || code === '30001' ? 'zhihu_rate_limited' : code === 30002 || code === '30002' ? 'zhihu_quota_exhausted' : 'zhihu_business_error', '知乎用户数据请求未成功', code === 30001 || code === '30001' ? 503 : 502, code === 30001 || code === '30001')
    if (!envelope || (!Object.prototype.hasOwnProperty.call(envelope, 'Data') && !Object.prototype.hasOwnProperty.call(envelope, 'data'))) throw new LabError('zhihu_schema_invalid', '知乎用户数据响应格式无效', 502)
    return envelope.Data ?? envelope.data
  }

  private userItems(value: unknown): SourceItem[] {
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    const values = body && Array.isArray(body.Items) ? body.Items : body && Array.isArray(body.items) ? body.items : []
    return values.flatMap((value) => {
      const item = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
      const url = item ? safeHttpUrl(item.Url ?? item.url) : null
      if (!item || !url) return []
      const title = safeString(item.Title ?? item.title, 1000) ?? '知乎内容'
      const author = item.Author && typeof item.Author === 'object' ? safeString((item.Author as Record<string, unknown>).Name, 512) : null
      const published = item.CreatedAt ?? item.created_at
      return [{ id: url, title, url, summary: safeString(item.Summary ?? item.summary, 4000) ?? '', published_at: typeof published === 'string' || typeof published === 'number' ? published : undefined, author: author ?? undefined }]
    })
  }

  private userPagingEnded(value: unknown): boolean {
    const body = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
    const paging = body?.Paging && typeof body.Paging === 'object' ? body.Paging as Record<string, unknown> : body?.paging && typeof body.paging === 'object' ? body.paging as Record<string, unknown> : null
    return paging?.IsEnd === true || paging?.isEnd === true
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
    catch {
      // An undecryptable token is a hard failure: mark the connection so the
      // session DTO exposes reauthorization_required, and fail with the same
      // safe code used for a remote 401.
      this.markReauthorization(String(connection.id))
      throw new LabError('reauthorization_required', '知乎连接凭据无法读取，请重新授权', 401)
    }
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
