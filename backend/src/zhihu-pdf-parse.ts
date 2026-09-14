import { createHash } from 'node:crypto'
import { isIP } from 'node:net'
import { lookup as dnsLookup } from 'node:dns/promises'
import { ZhihuOpenApiError } from './zhihu-openapi.js'
import type { ResumeParseResult } from './resume-parser.js'

type AddressLookup = (hostname: string) => Promise<Array<{ address: string }>>
export interface ZhihuPdfParseOptions { accessSecret: string; baseUrl: string; timeoutMs: number; maxPolls: number; maxDownloadBytes: number; fetchImpl?: typeof fetch; sleep?: (ms: number) => Promise<void>; lookup?: AddressLookup; allowedDownloadHosts?: string[] }

function object(value: unknown): Record<string, unknown> | null { return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null }
function text(value: unknown): string | null { return typeof value === 'string' && value.trim() ? value.trim() : null }

/** Data Platform PDF protocol only. IDs, URLs and source bytes never leave this adapter. */
export class ZhihuPdfParseAdapter {
  private readonly fetchImpl: typeof fetch
  private readonly sleep: (ms: number) => Promise<void>
  private readonly lookup: AddressLookup
  constructor(private readonly options: ZhihuPdfParseOptions) { this.fetchImpl = options.fetchImpl ?? fetch; this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms))); this.lookup = options.lookup ?? ((hostname) => dnsLookup(hostname, { all: true })) }
  get configured(): boolean { return Boolean(this.options.accessSecret) }

  async parse(pdf: Buffer, onTaskCreated?: (taskId: string) => void): Promise<ResumeParseResult> {
    if (!this.configured) throw new ZhihuOpenApiError('zhihu_capability_disabled', '知乎 PDF 解析尚未启用', false)
    const fileId = await this.upload(pdf)
    const created = await this.request('/api/v1/pdf-parse/tasks', { method: 'POST', headers: { 'Idempotency-Key': `resume-${createHash('sha256').update(pdf).digest('hex')}` }, body: JSON.stringify({ file_id: fileId }) })
    const taskId = text(object(created)?.task_id)
    if (!taskId) throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 任务响应格式无效', false)
    onTaskCreated?.(taskId)
    for (let attempt = 0; attempt < this.options.maxPolls; attempt += 1) {
      const task = object(await this.request(`/api/v1/pdf-parse/tasks/${encodeURIComponent(taskId)}`, { method: 'GET' }))
      const status = text(task?.task_status)
      if (status === 'failed') throw new ZhihuOpenApiError('zhihu_pdf_parse_failed', '知乎 PDF 解析失败', false)
      if (status === 'succeeded') {
        const url = text(object(task?.result)?.url)
        if (!url) throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 结果格式无效', false)
        return this.download(url)
      }
      if (status !== 'pending' && status !== 'running') throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 任务状态无效', false)
      await this.sleep(Math.min(2_000, 250 * (attempt + 1)))
    }
    throw new ZhihuOpenApiError('zhihu_timeout', '知乎 PDF 解析超时')
  }

  private async upload(pdf: Buffer): Promise<string> {
    const form = new FormData(); form.set('file', new Blob([new Uint8Array(pdf)], { type: 'application/pdf' }), 'resume.pdf')
    const data = object(await this.request('/resources/v1/files', { method: 'POST', body: form, headers: {} }))
    const id = text(data?.file_id); if (!id) throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 上传响应格式无效', false); return id
  }
  private async request(path: string, init: RequestInit): Promise<unknown> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const headers = new Headers(init.headers); headers.set('Authorization', `Bearer ${this.options.accessSecret}`); headers.set('X-Request-Timestamp', String(Math.floor(Date.now() / 1000))); headers.set('Accept', 'application/json')
      const response = await this.fetchImpl(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, { ...init, headers, signal: controller.signal })
      const raw = await response.text()
      if (response.status === 429) throw new ZhihuOpenApiError('zhihu_rate_limited', '知乎开放 API 请求过于频繁')
      if (response.status >= 500) throw new ZhihuOpenApiError('zhihu_upstream_unavailable', '知乎开放 API 服务暂时不可用')
      let payload: unknown; try { payload = JSON.parse(raw) } catch { throw new ZhihuOpenApiError(response.ok ? 'zhihu_invalid_json' : 'zhihu_http_error', response.ok ? '知乎 PDF 响应格式无效' : '知乎 PDF 请求未成功', false) }
      const envelope = object(payload); const code = envelope?.Code ?? envelope?.code
      if (!response.ok || (code !== 0 && code !== '0')) throw new ZhihuOpenApiError(code === 30002 || code === '30002' ? 'zhihu_quota_exhausted' : 'zhihu_business_error', '知乎 PDF 请求未成功', false)
      return envelope?.Data ?? envelope?.data
    } catch (error) { if (error instanceof ZhihuOpenApiError) throw error; if (error instanceof Error && error.name === 'AbortError') throw new ZhihuOpenApiError('zhihu_timeout', '知乎 PDF 解析超时'); throw new ZhihuOpenApiError('zhihu_request_failed', '知乎 PDF 请求失败') } finally { clearTimeout(timer) }
  }
  private async download(url: string): Promise<ResumeParseResult> {
    let current = url
    let response: Response | undefined
    for (let redirects = 0; redirects <= 3; redirects += 1) {
      await this.assertSafeDownloadUrl(current)
      response = await this.fetchImpl(current, { headers: { Accept: 'application/json' }, redirect: 'manual' })
      if (![301, 302, 303, 307, 308].includes(response.status)) break
      const location = response.headers.get('location'); if (!location) throw new ZhihuOpenApiError('zhihu_pdf_download_blocked', '知乎 PDF 下载地址不安全', false)
      current = new URL(location, current).toString()
    }
    if (!response || [301, 302, 303, 307, 308].includes(response.status) || !response.ok) throw new ZhihuOpenApiError('zhihu_upstream_unavailable', '知乎 PDF 结果不可读取')
    const bytes = Buffer.from(await response.arrayBuffer()); if (bytes.byteLength > this.options.maxDownloadBytes) throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 结果过大', false)
    let parsed: unknown; try { parsed = JSON.parse(bytes.toString('utf8')) } catch { throw new ZhihuOpenApiError('zhihu_invalid_json', '知乎 PDF 结果格式无效', false) }
    const pages = object(parsed)?.pages; if (!Array.isArray(pages)) throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 结果格式无效', false)
    const body = pages.flatMap((page) => { const blocks = object(page)?.blocks; return Array.isArray(blocks) ? blocks : [] }).map((block) => text(object(block)?.content) ?? '').filter(Boolean).join('\n').trim()
    if (!body) throw new ZhihuOpenApiError('zhihu_schema_invalid', '知乎 PDF 未返回文本', false)
    return { pageCount: pages.length, text: body }
  }
  private async assertSafeDownloadUrl(value: string): Promise<void> {
    let url: URL; try { url = new URL(value) } catch { throw new ZhihuOpenApiError('zhihu_pdf_download_blocked', '知乎 PDF 下载地址不安全', false) }
    if (url.protocol !== 'https:' || url.username || url.password || url.hostname === 'localhost' || url.hostname.endsWith('.localhost')) throw new ZhihuOpenApiError('zhihu_pdf_download_blocked', '知乎 PDF 下载地址不安全', false)
    if (this.options.allowedDownloadHosts?.length && !this.options.allowedDownloadHosts.includes(url.hostname)) throw new ZhihuOpenApiError('zhihu_pdf_download_blocked', '知乎 PDF 下载地址不安全', false)
    const addresses = isIP(url.hostname) ? [{ address: url.hostname }] : await this.lookup(url.hostname)
    if (addresses.some(({ address }) => privateAddress(address))) throw new ZhihuOpenApiError('zhihu_pdf_download_blocked', '知乎 PDF 下载地址不安全', false)
  }
}

function privateAddress(address: string): boolean {
  if (address === '::1' || address.startsWith('fe80:') || address.startsWith('fc') || address.startsWith('fd')) return true
  const octets = address.split('.').map(Number); if (octets.length !== 4 || octets.some(Number.isNaN)) return false
  return octets[0] === 10 || octets[0] === 127 || octets[0] === 0 || octets[0] === 169 && octets[1] === 254 || octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31 || octets[0] === 192 && octets[1] === 168
}
