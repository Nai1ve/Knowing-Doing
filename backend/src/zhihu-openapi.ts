import { randomUUID } from 'node:crypto'
import type { SourceItem } from './product-types.js'

export class ZhihuOpenApiError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true) {
    super(message)
    this.name = 'ZhihuOpenApiError'
  }
}

export interface ZhihuOpenApiConfig {
  accessSecret: string
  baseUrl: string
  timeoutMs: number
  articlePath?: string
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
}

function has(object: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(object, key)
}

function scalar(value: unknown): string | number | boolean | null {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean' ? value : null
}

function isSuccessCode(value: unknown): boolean {
  return value === 0 || (typeof value === 'string' && value.trim() === '0')
}

function businessError(code: unknown): ZhihuOpenApiError {
  const normalized = typeof code === 'number' || typeof code === 'string' ? String(code).trim() : ''
  if (normalized === '30001') return new ZhihuOpenApiError('zhihu_rate_limited', '知乎开放 API 请求过于频繁')
  if (normalized === '30002') return new ZhihuOpenApiError('zhihu_quota_exhausted', '知乎开放 API 配额不足', false)
  return new ZhihuOpenApiError('zhihu_business_error', '知乎开放 API 请求未成功', false)
}

function unwrapDataEnvelope(value: unknown): unknown {
  const envelope = record(value)
  if (!envelope || (!has(envelope, 'Code') && !has(envelope, 'code'))) return value
  const code = has(envelope, 'Code') ? envelope.Code : envelope.code
  if (!isSuccessCode(code)) throw businessError(code)
  if (has(envelope, 'Data')) return envelope.Data
  if (has(envelope, 'data')) return envelope.data
  return null
}

function arrayFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  const object = record(value)
  if (!object) return []
  for (const key of ['Items', 'items', 'results', 'data', 'Data']) if (Array.isArray(object[key])) return object[key] as unknown[]
  const nested = record(object.data) ?? record(object.Data)
  if (nested) for (const key of ['Items', 'items', 'results']) if (Array.isArray(nested[key])) return nested[key] as unknown[]
  return []
}

function mapSearchItem(value: unknown, query: string, position: number): SourceItem | null {
  const item = record(value)
  if (!item) return null
  const title = text(item.Title) ?? text(item.title) ?? text(item.name)
  const url = text(item.Url) ?? text(item.url) ?? text(item.link)
  if (!title || !url) return null
  const legacyAuthor = record(item.author)
  const author = text(item.AuthorName) ?? (legacyAuthor ? text(legacyAuthor.name) : text(item.author))
  const externalId = text(item.ContentID) ?? text(item.contentId) ?? text(item.id) ?? text(item.content_id) ?? url
  const excerpt = text(item.ContentText) ?? text(item.contentText) ?? text(item.excerpt) ?? text(item.summary) ?? text(item.snippet) ?? text(item.content) ?? ''
  return {
    id: randomUUID(), provider: 'zhihu', externalId, title, author, url, excerpt: excerpt.slice(0, 4000), query,
    retrievedAt: new Date().toISOString(), metadata: {
      provenance: 'zhihu_open_api', rank: position + 1,
      authority: scalar(item.AuthorityLevel ?? item.authorityLevel ?? item.authority_level),
      score: scalar(item.RankingScore ?? item.rankingScore ?? item.score),
      editTime: scalar(item.EditTime ?? item.editTime ?? item.edit_time),
    },
  }
}

export class ZhihuOpenApiClient {
  constructor(private readonly config: ZhihuOpenApiConfig) {}

  get configured(): boolean { return Boolean(this.config.accessSecret) }

  private async request(path: string, init: RequestInit, protocol: 'data' | 'zhida'): Promise<unknown> {
    if (!this.config.accessSecret) throw new ZhihuOpenApiError('zhihu_not_configured', '知乎开放 API 尚未配置', false)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const headers = new Headers(init.headers)
      headers.set('Accept', 'application/json')
      headers.set('Content-Type', 'application/json')
      headers.set('Authorization', `Bearer ${this.config.accessSecret}`)
      headers.set('X-Request-Timestamp', String(Math.floor(Date.now() / 1000)))
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init, signal: controller.signal,
        headers,
      })
      const raw = await response.text()
      if (response.status === 429) throw new ZhihuOpenApiError('zhihu_rate_limited', '知乎开放 API 请求过于频繁')
      if (response.status >= 500) throw new ZhihuOpenApiError('zhihu_upstream_unavailable', '知乎开放 API 服务暂时不可用')
      let payload: unknown = {}
      try { payload = raw ? JSON.parse(raw) : {} } catch {
        if (!response.ok) throw new ZhihuOpenApiError('zhihu_http_error', `知乎开放 API 返回 HTTP ${response.status}`, false)
        throw new ZhihuOpenApiError('zhihu_invalid_json', '知乎开放 API 返回了无效 JSON')
      }
      if (!response.ok) {
        if (protocol === 'data') payload = unwrapDataEnvelope(payload)
        throw new ZhihuOpenApiError('zhihu_http_error', `知乎开放 API 返回 HTTP ${response.status}`, false)
      }
      if (protocol === 'data') payload = unwrapDataEnvelope(payload)
      return payload
    } catch (error) {
      if (error instanceof ZhihuOpenApiError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new ZhihuOpenApiError('zhihu_timeout', '知乎开放 API 请求超时')
      throw new ZhihuOpenApiError('zhihu_request_failed', '知乎开放 API 请求失败')
    } finally { clearTimeout(timer) }
  }

  async search(query: string, count = 5): Promise<SourceItem[]> {
    const normalized = query.trim().replace(/\s+/g, ' ')
    if (!normalized) return []
    const payload = await this.request(`/api/v1/content/zhihu_search?Query=${encodeURIComponent(normalized)}&Count=${Math.min(10, Math.max(1, Math.trunc(count)))}`, { method: 'GET' }, 'data')
    return arrayFrom(payload).map((item, index) => mapSearchItem(item, normalized, index)).filter((item): item is SourceItem => item !== null)
  }

  async fetchArticle(source: Pick<SourceItem, 'externalId' | 'url'>): Promise<string> {
    const externalId = source.externalId?.trim()
    if (!externalId) throw new ZhihuOpenApiError('zhihu_external_id_missing', '知乎材料缺少可读取的 externalId', false)
    const path = this.config.articlePath ?? '/api/v1/content/zhihu_article'
    const payload = await this.request(`${path}?Id=${encodeURIComponent(externalId)}`, { method: 'GET' }, 'data')
    const content = findContent(payload)
    if (!content) throw new ZhihuOpenApiError('zhihu_content_unavailable', '知乎开放 API 没有返回文章正文')
    return content
  }

  async research(input: { goal: string; profileSummary: string; nodeTitle: string }): Promise<string> {
    const payload = await this.request('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'zhida-agent', stream: false, messages: [
      { role: 'system', content: '你是知乎知识路径研究者。只输出简洁的知识地形、典型问题和 2 至 3 个公开搜索意图，不输出思维过程。' },
      { role: 'user', content: JSON.stringify(input) },
    ] }) }, 'zhida')
    const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
    const content = choice?.message?.content
    const result = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('') : ''
    if (!result.trim()) throw new ZhihuOpenApiError('zhihu_empty_research', '知乎直答没有返回研究结果')
    return result.replace(/<think(?:ing)?>([\s\S]*?)<\/(?:think|thinking)>/gi, '').trim()
  }
}

function findContent(value: unknown): string | null {
  if (typeof value === 'string' && value.trim().length > 0) return value.trim()
  if (!value || typeof value !== 'object') return null
  if (Array.isArray(value)) {
    for (const item of value) { const result = findContent(item); if (result) return result }
    return null
  }
  const object = value as Record<string, unknown>
  if ((has(object, 'Code') || has(object, 'code')) && !isSuccessCode(has(object, 'Code') ? object.Code : object.code)) return null
  if (has(object, 'Code') || has(object, 'code')) return findContent(has(object, 'Data') ? object.Data : object.data)
  for (const key of ['ContentText', 'ContentMarkdown', 'Content', 'Body', 'Html', 'content_markdown', 'contentMarkdown', 'body', 'content', 'text', 'html']) {
    const candidate = object[key]
    if (typeof candidate === 'string' && candidate.trim().length > 0) return candidate.trim()
  }
  for (const key of ['data', 'result', 'article']) {
    const result = findContent(object[key])
    if (result) return result
  }
  return null
}
