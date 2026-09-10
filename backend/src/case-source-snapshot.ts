import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CaseSourceProvenance, CaseSourceSnapshot, SourceItem } from './product-types.js'
import { ZhihuOpenApiClient, ZhihuOpenApiError } from './zhihu-openapi.js'

export const MAX_SOURCE_CONTENT_CHARS = 120_000
export const MAX_SOURCE_INJECT_CHARS = 60_000
const SNAPSHOT_TTL_MS = 7 * 24 * 60 * 60 * 1000

type Row = Record<string, unknown>

function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function number(row: Row, key: string): number { return Number(row[key]) }
function checksum(content: string): string { return createHash('sha256').update(content).digest('hex') }

function decodeEntities(value: string): string {
  return value.replace(/&nbsp;/gi, ' ').replace(/&amp;/gi, '&').replace(/&lt;/gi, '<').replace(/&gt;/gi, '>').replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'")
}

export function normalizeSourceMarkdown(value: string): string {
  const normalized = value
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p\s*>/gi, '\n\n')
    .replace(/<\/h[1-6]\s*>/gi, '\n\n')
    .replace(/<li\s*>/gi, '- ')
    .replace(/<\/li\s*>/gi, '\n')
    .replace(/<[^>]+>/g, '')
  return decodeEntities(normalized).replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
}

export interface SourceContentProvider {
  readonly providerName: string
  fetch(source: SourceItem): Promise<{ content: string; retrievedAt?: string; expiresAt?: string | null }>
}

export class ZhihuSourceContentProvider implements SourceContentProvider {
  readonly providerName = 'zhihu_open_api'

  constructor(private readonly client: ZhihuOpenApiClient) {}

  async fetch(source: SourceItem): Promise<{ content: string; retrievedAt: string; expiresAt: string }> {
    if (source.provider !== 'zhihu') throw new ZhihuOpenApiError('source_provider_unsupported', '当前来源不是知乎材料', false)
    const content = await this.client.fetchArticle(source)
    return { content, retrievedAt: new Date().toISOString(), expiresAt: new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString() }
  }
}

function snapshotFrom(row: Row): CaseSourceSnapshot {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), sourceItemId: text(row, 'source_item_id'), provider: text(row, 'provider'), externalId: nullable(row, 'external_id'), sourceUrl: text(row, 'source_url'), title: text(row, 'title'), author: nullable(row, 'author'), contentMarkdown: text(row, 'content_markdown'), contentChecksum: text(row, 'content_checksum'), contentLength: number(row, 'content_length'), extractionStatus: text(row, 'extraction_status') as CaseSourceSnapshot['extractionStatus'], extractionError: nullable(row, 'extraction_error'), retrievedAt: text(row, 'retrieved_at'), expiresAt: nullable(row, 'expires_at'), createdAt: text(row, 'created_at'),
  }
}

export class SourceSnapshotService {
  constructor(private readonly db: Database.Database, private readonly provider: SourceContentProvider) {}

  private row(id: string, learnerId: string): Row | undefined {
    return this.db.prepare('SELECT * FROM case_source_snapshots WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
  }

  get(learnerId: string, id: string): CaseSourceSnapshot {
    const row = this.row(id, learnerId)
    if (!row) throw new Error('source_snapshot_not_found')
    return snapshotFrom(row)
  }

  async freeze(learnerId: string, source: SourceItem): Promise<CaseSourceSnapshot> {
    if (source.provider !== 'zhihu') throw new Error('source_provider_unsupported')
    const now = new Date().toISOString()
    const pendingId = randomUUID()
    this.db.prepare(`INSERT INTO case_source_snapshots(id, learner_id, source_item_id, provider, external_id, source_url, title, author, content_checksum, extraction_status, retrieved_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`).run(pendingId, learnerId, source.id, source.provider, source.externalId, source.url, source.title, source.author, pendingId, source.retrievedAt, now)
    try {
      const result = await this.provider.fetch(source)
      const content = normalizeSourceMarkdown(result.content)
      if (!content) throw new Error('source_content_empty')
      if (content.length > MAX_SOURCE_CONTENT_CHARS) throw new Error('source_content_too_large')
      const savedAt = new Date().toISOString()
      const digest = checksum(content)
      const duplicate = this.db.prepare("SELECT * FROM case_source_snapshots WHERE learner_id = ? AND source_item_id = ? AND content_checksum = ? AND extraction_status = 'ready' LIMIT 1").get(learnerId, source.id, digest) as Row | undefined
      if (duplicate) {
        this.db.prepare("UPDATE case_source_snapshots SET extraction_status = 'failed', extraction_error = 'duplicate_content_checksum' WHERE id = ?").run(pendingId)
        return snapshotFrom(duplicate)
      }
      this.db.prepare(`UPDATE case_source_snapshots SET content_markdown = ?, content_checksum = ?, content_length = ?, extraction_status = 'ready', extraction_error = NULL, retrieved_at = ?, expires_at = ?, created_at = created_at WHERE id = ? AND learner_id = ?`).run(content, digest, content.length, result.retrievedAt ?? savedAt, result.expiresAt ?? new Date(Date.now() + SNAPSHOT_TTL_MS).toISOString(), pendingId, learnerId)
      return this.get(learnerId, pendingId)
    } catch (error) {
      const code = error instanceof ZhihuOpenApiError ? error.code : error instanceof Error ? error.message : 'source_snapshot_failed'
      this.db.prepare("UPDATE case_source_snapshots SET extraction_status = 'failed', extraction_error = ? WHERE id = ? AND learner_id = ?").run(code.slice(0, 240), pendingId, learnerId)
      throw new Error(`source_snapshot_unavailable:${code}`)
    }
  }
}
