import { createHash, randomUUID } from 'node:crypto'
import type { ProductRepository } from './product-repository.js'
import type { ResearchCandidate, ResearchProvider, SourceDigestContract, SourceItem } from './product-types.js'
import { ZhihuOpenApiClient, ZhihuOpenApiError } from './zhihu-openapi.js'

// Completion plan P4.2: research orchestration. The server (via the Practice
// Card route) builds a bounded candidate set per CardIntent, normalizes every
// candidate to the frozen ResearchCandidate shape, ranks with deterministic
// dedupe, and hands at most two SourceDigestContract values to the Practice
// Card Generator. Direct answer is recorded as an unverified assist candidate
// that can never reach a card. Every persisted row is learner-scoped so one
// learner's favorites, public searches, and web searches never leak to another.

export interface ResearchIntent {
  planUnitId: string
  objective: string
  capabilityIds: string[]
  learnerLevel: string
  learnerGaps: string[]
  roadmapNodeId: string | null
  sourceQuery: { concepts: string[]; scenarios: string[]; exclusions: string[] }
}

export interface AdoptedResearchSource {
  candidate: ResearchCandidate
  sourceItemId: string | null
  digest: SourceDigestContract
}

export interface ResearchOutcome {
  /** Ranked candidates that cleared the relevance/credibility threshold. */
  candidates: ResearchCandidate[]
  /** At most two adopted sources handed to the Practice Card Generator. */
  adopted: AdoptedResearchSource[]
}

export interface ResearchServiceOptions {
  cacheTtlMs?: number
  directAnswerCacheTtlMs?: number
  maxExternalCandidatesPerQuery?: number
  maxCandidateQueries?: number
  relevanceThreshold?: number
  credibilityThreshold?: number
  now?: () => Date
}

type Row = Record<string, unknown>

const DEFAULT_CACHE_TTL_MS = 24 * 60 * 60 * 1000
const DIRECT_ANSWER_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000
const MAX_EXTERNAL_CANDIDATES_PER_QUERY = 5
const MAX_CANDIDATE_QUERIES = 3
const USER_SOURCE_LIMIT = 20

const PROVIDER_WEIGHT: Record<ResearchProvider, number> = {
  user_source: 0.18,
  zhihu_search: 0.08,
  global_search: 0.06,
  question_recommendation: 0.04,
  direct_answer: 0.01,
}

function nowIso(): string { return new Date().toISOString() }

function json<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try { return JSON.parse(value) as T } catch { return fallback }
}

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

function contentFingerprint(title: string, author: string | null, excerpt: string): string {
  return createHash('sha256').update(`${title.trim()}\n${(author ?? '').trim()}\n${excerpt.trim()}`).digest('hex')
}

function terms(value: string): string[] {
  return [...new Set(value.toLowerCase().split(/[\s,，。；;：:、/|()（）]+/).map((item) => item.trim()).filter((item) => item.length >= 2))]
}

export class ResearchService {
  private readonly cacheTtlMs: number
  private readonly directAnswerCacheTtlMs: number
  private readonly maxExternalCandidatesPerQuery: number
  private readonly maxCandidateQueries: number
  private readonly relevanceThreshold: number
  private readonly credibilityThreshold: number
  private readonly now: () => Date

  constructor(
    private readonly repository: ProductRepository,
    private readonly zhihu: ZhihuOpenApiClient,
    options: ResearchServiceOptions = {},
  ) {
    this.cacheTtlMs = options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS
    this.directAnswerCacheTtlMs = options.directAnswerCacheTtlMs ?? DIRECT_ANSWER_CACHE_TTL_MS
    this.maxExternalCandidatesPerQuery = options.maxExternalCandidatesPerQuery ?? MAX_EXTERNAL_CANDIDATES_PER_QUERY
    this.maxCandidateQueries = options.maxCandidateQueries ?? MAX_CANDIDATE_QUERIES
    this.relevanceThreshold = options.relevanceThreshold ?? 0.6
    this.credibilityThreshold = options.credibilityThreshold ?? 0.25
    this.now = options.now ?? (() => new Date())
  }

  get enabled(): boolean { return this.zhihu.configured }

  async researchForCard(learnerId: string, intent: ResearchIntent): Promise<ResearchOutcome> {
    // Each provider class is independent and bounded; a failure in one class
    // (429, quota, timeout, upstream) must not block the others.
    const groups = await Promise.allSettled([
      Promise.resolve(this.userSourceCandidates(learnerId, intent)),
      this.searchCandidates(learnerId, intent, 'zhihu_search'),
      this.searchCandidates(learnerId, intent, 'global_search'),
      this.recommendationCandidates(learnerId, intent),
      this.directAnswerCandidates(learnerId, intent),
    ])
    const candidates = groups.flatMap((group) => group.status === 'fulfilled' ? group.value : [])
    const ranked = this.rankAndDedupe(candidates)
    const aboveThreshold = ranked.filter((candidate) => candidate.relevance >= this.relevanceThreshold && candidate.credibility >= this.credibilityThreshold)
    const adopted = aboveThreshold.slice(0, 2).map((candidate) => this.adopt(learnerId, candidate))
    return { candidates: aboveThreshold, adopted }
  }

  private userSourceCandidates(learnerId: string, intent: ResearchIntent): ResearchCandidate[] {
    const queryId = this.startQuery(learnerId, intent, 'user_source', intent.objective)
    const rows = this.repository.db.prepare(`
      SELECT i.*, GROUP_CONCAT(DISTINCT c.kind) AS collection_kinds
      FROM learner_source_items i
      LEFT JOIN external_source_collection_items ci ON ci.source_item_id = i.id
      LEFT JOIN external_source_collections c ON c.id = ci.collection_id
      WHERE i.learner_id = ? AND i.status = 'active' AND i.provider = 'zhihu'
      GROUP BY i.id ORDER BY i.updated_at DESC LIMIT ?
    `).all(learnerId, USER_SOURCE_LIMIT) as Row[]
    const candidates = rows.map((row) => {
      const kinds = String(row.collection_kinds ?? '')
      const sourceWeight = this.collectionKindWeight(kinds)
      const title = String(row.title ?? '')
      const excerpt = String(row.excerpt ?? '')
      return {
        id: randomUUID(), queryId, provider: 'user_source' as const,
        externalId: row.external_id == null ? null : String(row.external_id),
        canonicalUrl: String(row.url), contentHash: String(row.content_hash),
        title, author: row.author == null ? null : String(row.author),
        excerpt: excerpt.slice(0, 4000), summary: excerpt.slice(0, 600),
        fetchedAt: String(row.updated_at ?? nowIso()),
        credibility: Math.min(0.95, 0.55 + sourceWeight + Math.min(0.2, excerpt.length / 4000)),
        relevance: this.relevanceScore(intent, title, excerpt, sourceWeight),
        visibility: row.visibility === 'public' ? 'public' as const : 'private' as const,
        retrievalEvidence: ['user_source', `collection_kinds=${kinds || 'none'}`],
        metadata: { sourceItemId: String(row.id), sourceWeight },
      }
    })
    this.completeQuery(queryId, 'succeeded', candidates.length)
    this.persistCandidates(learnerId, queryId, candidates)
    return candidates
  }

  private async searchCandidates(learnerId: string, intent: ResearchIntent, provider: 'zhihu_search' | 'global_search'): Promise<ResearchCandidate[]> {
    const queries = this.searchQueries(intent)
    const output: ResearchCandidate[] = []
    for (const query of queries) {
      const fingerprint = this.fingerprint(query)
      const queryId = this.startQuery(learnerId, intent, provider, query)
      const cachedIds = this.cachedCandidateIds(learnerId, provider, fingerprint, this.cacheTtlMs)
      if (cachedIds) {
        const candidates = this.candidatesByIds(learnerId, cachedIds).map((candidate) => ({ ...candidate, relevance: this.recomputeRelevance(intent, candidate) }))
        this.completeQuery(queryId, 'succeeded', candidates.length, `cached:${candidates.length}`)
        this.persistCandidates(learnerId, queryId, candidates)
        output.push(...candidates)
        continue
      }
      try {
        const items = provider === 'zhihu_search'
          ? await this.zhihu.search(query, this.maxExternalCandidatesPerQuery)
          : await this.zhihu.globalSearch(query, this.maxExternalCandidatesPerQuery)
        const candidates = items.map((item, index) => this.mapExternalCandidate(queryId, provider, item, intent, index))
        this.completeQuery(queryId, 'succeeded', candidates.length)
        this.persistCandidates(learnerId, queryId, candidates)
        this.writeCache(learnerId, provider, query, fingerprint, candidates.map((candidate) => candidate.id), this.cacheTtlMs)
        output.push(...candidates)
      } catch (error) {
        this.failQuery(queryId, error)
      }
    }
    return output
  }

  private async recommendationCandidates(learnerId: string, intent: ResearchIntent): Promise<ResearchCandidate[]> {
    const queryId = this.startQuery(learnerId, intent, 'question_recommendation', intent.objective)
    const fingerprint = this.fingerprint(intent.objective)
    const cachedIds = this.cachedCandidateIds(learnerId, 'question_recommendation', fingerprint, this.cacheTtlMs)
    if (cachedIds) {
      const candidates = this.candidatesByIds(learnerId, cachedIds).map((candidate) => ({ ...candidate, relevance: this.recomputeRelevance(intent, candidate) }))
      this.completeQuery(queryId, 'succeeded', candidates.length, `cached:${candidates.length}`)
      this.persistCandidates(learnerId, queryId, candidates)
      return candidates
    }
    try {
      const questions = await this.zhihu.recommendQuestions(intent.objective, 5)
      const candidates = questions.map((question, index) => ({
        id: randomUUID(), queryId, provider: 'question_recommendation' as const,
        externalId: null, canonicalUrl: canonicalUrl(question.url), contentHash: this.fingerprint(question.url),
        title: question.title, author: null, excerpt: '', summary: question.title.slice(0, 300),
        fetchedAt: nowIso(), credibility: 0.4,
        relevance: this.relevanceScore(intent, question.title, '', PROVIDER_WEIGHT.question_recommendation),
        visibility: 'public' as const, retrievalEvidence: ['question_recommendation'],
        metadata: { position: index + 1 },
      }))
      this.completeQuery(queryId, 'succeeded', candidates.length)
      this.persistCandidates(learnerId, queryId, candidates)
      this.writeCache(learnerId, 'question_recommendation', intent.objective, fingerprint, candidates.map((candidate) => candidate.id), this.cacheTtlMs)
      return candidates
    } catch (error) {
      this.failQuery(queryId, error)
      return []
    }
  }

  private async directAnswerCandidates(learnerId: string, intent: ResearchIntent): Promise<ResearchCandidate[]> {
    const queryId = this.startQuery(learnerId, intent, 'direct_answer', intent.objective)
    const fingerprint = this.fingerprint(`${intent.objective}|${intent.learnerGaps.join(',')}`)
    const cachedIds = this.cachedCandidateIds(learnerId, 'direct_answer', fingerprint, this.directAnswerCacheTtlMs)
    if (cachedIds) {
      const candidates = this.candidatesByIds(learnerId, cachedIds)
      this.completeQuery(queryId, 'succeeded', candidates.length, `cached:${candidates.length}`)
      return candidates
    }
    try {
      const researchText = await this.zhihu.research({
        goal: intent.objective,
        profileSummary: JSON.stringify({ level: intent.learnerLevel, gaps: intent.learnerGaps }),
        nodeTitle: intent.objective,
      })
      // Direct answer is research assistance ONLY: it is persisted with the
      // unverified marker and credibility far below the card threshold, so it
      // can never become a fact or scoring basis.
      const assist: ResearchCandidate = {
        id: randomUUID(), queryId, provider: 'direct_answer',
        externalId: null, canonicalUrl: `https://developer.zhihu.com/zhida/${fingerprint}`,
        contentHash: this.fingerprint(researchText), title: '直答研究辅助', author: null,
        excerpt: researchText.slice(0, 1200), summary: researchText.slice(0, 600),
        fetchedAt: nowIso(), credibility: 0.1, relevance: 0,
        visibility: 'public', retrievalEvidence: ['direct_answer_unverified', 'research_assistance_only'],
        metadata: { directAnswer: true },
      }
      this.completeQuery(queryId, 'succeeded', 1)
      this.persistCandidates(learnerId, queryId, [assist])
      this.writeCache(learnerId, 'direct_answer', intent.objective, fingerprint, [assist.id], this.directAnswerCacheTtlMs)
      return [assist]
    } catch (error) {
      this.failQuery(queryId, error)
      return []
    }
  }

  private mapExternalCandidate(queryId: string, provider: 'zhihu_search' | 'global_search', item: SourceItem, intent: ResearchIntent, position: number): ResearchCandidate {
    const excerpt = item.excerpt ?? ''
    const credibility = provider === 'zhihu_search' ? 0.7 : 0.6
    return {
      id: randomUUID(), queryId, provider,
      externalId: item.externalId, canonicalUrl: canonicalUrl(item.url), contentHash: contentFingerprint(item.title, item.author, excerpt),
      title: item.title, author: item.author, excerpt: excerpt.slice(0, 4000), summary: excerpt.slice(0, 600),
      fetchedAt: item.retrievedAt, credibility,
      relevance: this.relevanceScore(intent, item.title, excerpt, PROVIDER_WEIGHT[provider]),
      visibility: 'public', retrievalEvidence: [provider, `query_position=${position + 1}`, 'unverified_content'],
      metadata: { ...(item.metadata ?? {}) },
    }
  }

  private searchQueries(intent: ResearchIntent): string[] {
    // Deterministic from the CardIntent so re-generating the same plan unit
    // always hits the same cache fingerprints and never re-hits the platforms.
    const candidates = [intent.objective, ...terms(intent.objective)].filter(Boolean)
    return [...new Set(candidates)].slice(0, this.maxCandidateQueries)
  }

  private relevanceScore(intent: ResearchIntent, title: string, excerpt: string, sourceWeight: number): number {
    const haystack = `${title} ${excerpt}`.toLowerCase()
    const concepts = intent.sourceQuery.concepts
    const overlap = concepts.length === 0 ? 0 : concepts.filter((term) => haystack.includes(term)).length / concepts.length
    return Math.min(1, overlap * 0.8 + sourceWeight + Math.min(0.14, excerpt.length / 4000))
  }

  private recomputeRelevance(intent: ResearchIntent, candidate: ResearchCandidate): number {
    const weight = candidate.provider === 'user_source'
      ? (typeof candidate.metadata.sourceWeight === 'number' ? candidate.metadata.sourceWeight : PROVIDER_WEIGHT.user_source)
      : PROVIDER_WEIGHT[candidate.provider] ?? 0
    return this.relevanceScore(intent, candidate.title, candidate.excerpt, weight)
  }

  private collectionKindWeight(kinds: string): number {
    if (kinds.includes('favorites')) return 0.18
    if (kinds.includes('own')) return 0.12
    if (kinds.includes('activities')) return 0.08
    return 0.04
  }

  private rankAndDedupe(candidates: ResearchCandidate[]): ResearchCandidate[] {
    // Deterministic dedupe: content hash is primary, canonical URL secondary.
    // The best candidate (highest credibility, then relevance, then recency)
    // wins so the same article from two providers reaches the card once.
    const seen = new Map<string, ResearchCandidate>()
    for (const candidate of candidates) {
      const existing = seen.get(candidate.contentHash) ?? [...seen.values()].find((other) => other.canonicalUrl === candidate.canonicalUrl)
      if (existing) {
        if (this.betterCandidate(candidate, existing)) {
          seen.delete(existing.contentHash)
          seen.set(candidate.contentHash, candidate)
        }
      } else {
        seen.set(candidate.contentHash, candidate)
      }
    }
    return [...seen.values()]
      .map((candidate) => ({ candidate, score: this.rankScore(candidate) }))
      .sort((a, b) => b.score - a.score || (a.candidate.contentHash < b.candidate.contentHash ? -1 : 1))
      .map((entry) => entry.candidate)
  }

  private betterCandidate(a: ResearchCandidate, b: ResearchCandidate): boolean {
    if (a.credibility !== b.credibility) return a.credibility > b.credibility
    if (a.relevance !== b.relevance) return a.relevance > b.relevance
    if (a.fetchedAt !== b.fetchedAt) return a.fetchedAt > b.fetchedAt
    return a.contentHash < b.contentHash
  }

  private rankScore(candidate: ResearchCandidate): number {
    const recency = Math.max(0, 1 - (this.now().getTime() - new Date(candidate.fetchedAt).getTime()) / (90 * 24 * 3600 * 1000))
    const providerWeight = PROVIDER_WEIGHT[candidate.provider] ?? 0
    return candidate.relevance * 0.55 + candidate.credibility * 0.2 + recency * 0.15 + providerWeight * 0.1
  }

  private adopt(learnerId: string, candidate: ResearchCandidate): AdoptedResearchSource {
    const sourceItemId = this.ensureSourceItem(learnerId, candidate)
    return {
      candidate,
      sourceItemId,
      digest: {
        provider: candidate.provider,
        title: candidate.title,
        author: candidate.author,
        url: candidate.canonicalUrl,
        excerpt: candidate.excerpt.slice(0, 1200),
        summary: candidate.summary,
        fetchedAt: candidate.fetchedAt,
        visibility: candidate.visibility,
      },
    }
  }

  private ensureSourceItem(learnerId: string, candidate: ResearchCandidate): string | null {
    const linked = candidate.metadata.sourceItemId
    if (typeof linked === 'string' && linked) return linked
    const url = canonicalUrl(candidate.canonicalUrl)
    const hash = contentFingerprint(candidate.title, candidate.author, candidate.excerpt)
    const existing = this.resolveSourceId(learnerId, candidate.externalId, url, hash)
    if (existing) return existing
    const id = randomUUID()
    const timestamp = this.now().toISOString()
    const externalId = candidate.externalId ?? url
    this.repository.db.prepare(`
      INSERT INTO learner_source_items(id,learner_id,provider,external_id,url,title,author,excerpt,content_json,visibility,content_hash,status,saved,tags_json,published_at,removed_at,created_at,updated_at)
      VALUES(?,?,'zhihu',?,?,?,?,?,'{}','public',?,'active',0,'[]',NULL,NULL,?,?)
    `).run(id, learnerId, externalId, url, candidate.title, candidate.author, candidate.excerpt.slice(0, 4000), hash, timestamp, timestamp)
    return id
  }

  private resolveSourceId(learnerId: string, externalId: string | null, url: string, contentHash: string): string | null {
    if (externalId) {
      const byExternal = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND external_id=?").get(learnerId, externalId) as { id: string } | undefined
      if (byExternal) return byExternal.id
    }
    const byUrl = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND url=? ORDER BY created_at LIMIT 1").get(learnerId, url) as { id: string } | undefined
    if (byUrl) return byUrl.id
    const byHash = this.repository.db.prepare("SELECT id FROM learner_source_items WHERE learner_id=? AND provider='zhihu' AND content_hash=? ORDER BY created_at LIMIT 1").get(learnerId, contentHash) as { id: string } | undefined
    return byHash?.id ?? null
  }

  private persistCandidates(learnerId: string, queryId: string, candidates: ResearchCandidate[]): void {
    if (candidates.length === 0) return
    const timestamp = this.now().toISOString()
    const upsert = this.repository.db.prepare(`
      INSERT INTO research_candidates(id,learner_id,query_id,provider,external_id,canonical_url,content_hash,title,author,excerpt,summary,fetched_at,credibility,relevance,visibility,retrieval_evidence_json,metadata_json,created_at,updated_at)
      VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
      ON CONFLICT(id) DO UPDATE SET query_id=excluded.query_id,provider=excluded.provider,external_id=excluded.external_id,
        canonical_url=excluded.canonical_url,content_hash=excluded.content_hash,title=excluded.title,author=excluded.author,
        excerpt=excluded.excerpt,summary=excluded.summary,fetched_at=excluded.fetched_at,credibility=excluded.credibility,
        relevance=excluded.relevance,visibility=excluded.visibility,retrieval_evidence_json=excluded.retrieval_evidence_json,
        metadata_json=excluded.metadata_json,updated_at=excluded.updated_at
    `)
    this.repository.db.transaction(() => {
      for (const candidate of candidates) {
        upsert.run(candidate.id, learnerId, queryId, candidate.provider, candidate.externalId, candidate.canonicalUrl, candidate.contentHash,
          candidate.title, candidate.author, candidate.excerpt, candidate.summary, candidate.fetchedAt,
          candidate.credibility, candidate.relevance, candidate.visibility,
          JSON.stringify(candidate.retrievalEvidence), JSON.stringify(candidate.metadata), timestamp, timestamp)
      }
    })()
  }

  private candidatesByIds(learnerId: string, ids: string[]): ResearchCandidate[] {
    if (ids.length === 0) return []
    const placeholders = ids.map(() => '?').join(',')
    const rows = this.repository.db.prepare(`SELECT * FROM research_candidates WHERE learner_id=? AND id IN (${placeholders})`).all(learnerId, ...ids) as Row[]
    return rows.map((row) => this.rowToCandidate(row))
  }

  private cachedCandidateIds(learnerId: string, provider: ResearchProvider, fingerprint: string, ttlMs: number): string[] | null {
    const row = this.repository.db.prepare(
      'SELECT candidate_ids_json FROM research_query_cache WHERE learner_id=? AND provider=? AND fingerprint=? AND expires_at > ?',
    ).get(learnerId, provider, fingerprint, this.now().toISOString()) as { candidate_ids_json: string } | undefined
    if (!row) return null
    const ids = json<string[]>(row.candidate_ids_json, [])
    return ids.length > 0 ? ids : null
  }

  private writeCache(learnerId: string, provider: ResearchProvider, query: string, fingerprint: string, candidateIds: string[], ttlMs: number): void {
    const timestamp = this.now().toISOString()
    const expiresAt = new Date(this.now().getTime() + ttlMs).toISOString()
    this.repository.db.prepare(`
      INSERT INTO research_query_cache(id,learner_id,provider,query,fingerprint,fetched_at,expires_at,candidate_ids_json,created_at)
      VALUES(?,?,?,?,?,?,?,?,?)
      ON CONFLICT(learner_id,provider,fingerprint) DO UPDATE SET query=excluded.query,fetched_at=excluded.fetched_at,
        expires_at=excluded.expires_at,candidate_ids_json=excluded.candidate_ids_json
    `).run(randomUUID(), learnerId, provider, query, fingerprint, timestamp, expiresAt, JSON.stringify(candidateIds), timestamp)
  }

  private rowToCandidate(row: Row): ResearchCandidate {
    return {
      id: String(row.id), queryId: row.query_id == null ? null : String(row.query_id),
      provider: row.provider as ResearchProvider,
      externalId: row.external_id == null ? null : String(row.external_id),
      canonicalUrl: String(row.canonical_url), contentHash: String(row.content_hash),
      title: String(row.title), author: row.author == null ? null : String(row.author),
      excerpt: String(row.excerpt ?? ''), summary: row.summary == null ? null : String(row.summary),
      fetchedAt: String(row.fetched_at), credibility: Number(row.credibility ?? 0),
      relevance: Number(row.relevance ?? 0),
      visibility: row.visibility === 'private' ? 'private' as const : 'public' as const,
      retrievalEvidence: json<string[]>(row.retrieval_evidence_json, []),
      metadata: json<Record<string, unknown>>(row.metadata_json, {}),
    }
  }

  private startQuery(learnerId: string, intent: ResearchIntent, provider: ResearchProvider, query: string): string {
    const id = randomUUID()
    const timestamp = this.now().toISOString()
    this.repository.db.prepare(`
      INSERT INTO research_queries(id,learner_id,planning_session_id,roadmap_node_id,provider,query,status,requested_at,created_at,updated_at)
      VALUES(?,?,NULL,?,?,?,'queued',?,?,?)
    `).run(id, learnerId, intent.roadmapNodeId, provider, query, timestamp, timestamp, timestamp)
    return id
  }

  private completeQuery(queryId: string, status: 'succeeded' | 'failed' | 'rate_limited', count: number, note: string | null = null): void {
    void count
    this.repository.db.prepare("UPDATE research_queries SET status=?, completed_at=?, updated_at=?, error=? WHERE id=?").run(status, this.now().toISOString(), this.now().toISOString(), note, queryId)
  }

  private failQuery(queryId: string, error: unknown): void {
    const code = error instanceof ZhihuOpenApiError ? error.code : 'research_failed'
    const status = code === 'zhihu_rate_limited' ? 'rate_limited' as const : 'failed' as const
    this.repository.db.prepare("UPDATE research_queries SET status=?, completed_at=?, updated_at=?, error=? WHERE id=?").run(status, this.now().toISOString(), this.now().toISOString(), code, queryId)
  }

  private fingerprint(value: string): string {
    return createHash('sha256').update(value.trim()).digest('hex')
  }
}
