import { execFile } from 'node:child_process'
import { constants } from 'node:fs'
import fs from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { promisify } from 'node:util'
import type { LabConfig } from './config.js'
import type { ProductRepository } from './product-repository.js'
import type { SourceItem } from './product-types.js'

const execFileAsync = promisify(execFile)

export interface SourceProvider {
  search(query: string, limit: number): Promise<SourceItem[]>
}

export interface RetrievalResult {
  status: 'retrieved' | 'empty' | 'unavailable'
  items: SourceItem[]
  fromCache: boolean
  errorCode?: string
}

function normalizeQuery(query: string): string { return query.trim().replace(/\s+/g, ' ') }
function stringValue(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }

function findResultArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const record = value as Record<string, unknown>
  for (const key of ['results', 'items', 'data', 'documents', 'Items']) if (Array.isArray(record[key])) return record[key] as unknown[]
  if (record.Data && typeof record.Data === 'object') return findResultArray(record.Data)
  return []
}

function mapCliItem(value: unknown, query: string, index: number): Omit<SourceItem, 'id'> | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const title = stringValue(item.title) ?? stringValue(item.Title) ?? stringValue(item.name)
  const url = stringValue(item.url) ?? stringValue(item.Url) ?? stringValue(item.link)
  if (!title || !url) return null
  const authorValue = item.author ?? item.AuthorName
  const author = typeof authorValue === 'string' ? authorValue : authorValue && typeof authorValue === 'object' ? stringValue((authorValue as Record<string, unknown>).name) : null
  const excerpt = stringValue(item.excerpt) ?? stringValue(item.summary) ?? stringValue(item.snippet) ?? stringValue(item.ContentText) ?? ''
  const externalId = stringValue(item.id) ?? stringValue(item.ContentID) ?? stringValue(item.answer_id) ?? stringValue(item.article_id) ?? url
  return { provider: 'zhihu', externalId, title, author, url, excerpt: excerpt.slice(0, 4000), query, retrievedAt: new Date().toISOString(), metadata: { provenance: 'zhihu_cli', rank: index + 1 } }
}

export class ZhihuCliProvider implements SourceProvider {
  constructor(private readonly config: Pick<LabConfig, 'zhihuCliPath' | 'retrievalTimeoutMs'>) {}

  async isAvailable(): Promise<boolean> {
    if (!this.config.zhihuCliPath) return false
    try { await fs.access(this.config.zhihuCliPath, constants.X_OK) } catch { return false }
    return true
  }

  async search(query: string, limit: number): Promise<SourceItem[]> {
    if (!(await this.isAvailable())) throw new Error('zhihu_cli_unavailable')
    const normalized = normalizeQuery(query)
    const timeoutSeconds = Math.max(1, Math.ceil(this.config.retrievalTimeoutMs / 1000))
    try {
      const result = await execFileAsync(this.config.zhihuCliPath, ['search', 'zhihu', '--query', normalized, '--count', String(Math.min(5, Math.max(1, limit))), '--timeout', `${timeoutSeconds}s`], { timeout: this.config.retrievalTimeoutMs, maxBuffer: 2 * 1024 * 1024, windowsHide: true })
      const payload = JSON.parse(result.stdout) as unknown
      return findResultArray(payload).map((item, index) => mapCliItem(item, normalized, index)).filter((item): item is Omit<SourceItem, 'id'> => item !== null).map((item) => ({ ...item, id: randomUUID() }))
    } catch (error) {
      const code = error && typeof error === 'object' && 'killed' in error && (error as { killed?: boolean }).killed ? 'zhihu_cli_timeout' : 'zhihu_cli_failed'
      throw new Error(code)
    }
  }
}

export class RetrievalService {
  constructor(private readonly repository: ProductRepository, private readonly provider: SourceProvider | undefined, private readonly cacheTtlMs = 24 * 60 * 60 * 1000) {}

  async search(query: string, limit = 5): Promise<RetrievalResult> {
    const normalized = normalizeQuery(query)
    if (!normalized) return { status: 'empty', items: [], fromCache: false }
    const safeLimit = Math.min(5, Math.max(1, Math.trunc(limit)))
    const since = new Date(Date.now() - this.cacheTtlMs).toISOString()
    const cached = this.repository.listSourcesForQuery('zhihu', normalized, since, safeLimit)
    if (cached.length > 0) return { status: 'retrieved', items: cached, fromCache: true }
    if (!this.provider) return { status: 'unavailable', items: [], fromCache: false, errorCode: 'zhihu_cli_not_configured' }
    try {
      const items = await this.provider.search(normalized, safeLimit)
      const saved = items.map((item) => this.repository.saveSource(item))
      return { status: saved.length > 0 ? 'retrieved' : 'empty', items: saved, fromCache: false }
    } catch (error) {
      return { status: 'unavailable', items: [], fromCache: false, errorCode: error instanceof Error ? error.message : 'zhihu_cli_failed' }
    }
  }
}
