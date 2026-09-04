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
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null
}

function arrayFrom(value: unknown): unknown[] {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  const object = value as Record<string, unknown>
  for (const key of ['data', 'items', 'results']) if (Array.isArray(object[key])) return object[key] as unknown[]
  return []
}

function mapSearchItem(value: unknown, query: string, position: number): SourceItem | null {
  if (!value || typeof value !== 'object') return null
  const item = value as Record<string, unknown>
  const title = text(item.title) ?? text(item.name)
  const url = text(item.url) ?? text(item.link)
  if (!title || !url) return null
  const author = typeof item.author === 'object' && item.author ? text((item.author as Record<string, unknown>).name) : text(item.author)
  const externalId = text(item.id) ?? text(item.content_id) ?? url
  const excerpt = text(item.excerpt) ?? text(item.summary) ?? text(item.snippet) ?? text(item.content) ?? ''
  return {
    id: randomUUID(), provider: 'zhihu', externalId, title, author, url, excerpt: excerpt.slice(0, 4000), query,
    retrievedAt: new Date().toISOString(), metadata: { provenance: 'zhihu_open_api', rank: position + 1, authority: item.authority_level ?? null, score: item.score ?? null },
  }
}

export class ZhihuOpenApiClient {
  constructor(private readonly config: ZhihuOpenApiConfig) {}

  get configured(): boolean { return Boolean(this.config.accessSecret) }

  private async request(path: string, init: RequestInit): Promise<unknown> {
    if (!this.config.accessSecret) throw new ZhihuOpenApiError('zhihu_not_configured', '知乎开放 API 尚未配置', false)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs)
    try {
      const response = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init, signal: controller.signal,
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.accessSecret}`, 'X-Request-Timestamp': String(Math.floor(Date.now() / 1000)), ...(init.headers ?? {}) },
      })
      const raw = await response.text()
      let payload: unknown = {}
      try { payload = raw ? JSON.parse(raw) : {} } catch { throw new ZhihuOpenApiError('zhihu_invalid_json', '知乎开放 API 返回了无效 JSON') }
      if (!response.ok) throw new ZhihuOpenApiError(`zhihu_http_${response.status}`, `知乎开放 API 返回 HTTP ${response.status}`, response.status === 429 || response.status >= 500)
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
    const payload = await this.request(`/api/v1/content/zhihu_search?Query=${encodeURIComponent(normalized)}&Count=${Math.min(10, Math.max(1, Math.trunc(count)))}`, { method: 'GET' })
    return arrayFrom(payload).map((item, index) => mapSearchItem(item, normalized, index)).filter((item): item is SourceItem => item !== null)
  }

  async research(input: { goal: string; profileSummary: string; nodeTitle: string }): Promise<string> {
    const payload = await this.request('/v1/chat/completions', { method: 'POST', body: JSON.stringify({ model: 'zhida-agent', stream: false, messages: [
      { role: 'system', content: '你是知乎知识路径研究者。只输出简洁的知识地形、典型问题和 2 至 3 个公开搜索意图，不输出思维过程。' },
      { role: 'user', content: JSON.stringify(input) },
    ] }) })
    const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
    const content = choice?.message?.content
    const result = typeof content === 'string' ? content : Array.isArray(content) ? content.map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('') : ''
    if (!result.trim()) throw new ZhihuOpenApiError('zhihu_empty_research', '知乎直答没有返回研究结果')
    return result.replace(/<think(?:ing)?>([\s\S]*?)<\/(?:think|thinking)>/gi, '').trim()
  }
}
