import { describe, expect, it, vi } from 'vitest'
import { ZhihuPdfParseAdapter } from '../src/zhihu-pdf-parse.js'

function adapter(fetchImpl: typeof fetch, maxPolls = 3) {
  return new ZhihuPdfParseAdapter({ accessSecret: 'secret', baseUrl: 'https://developer.zhihu.com', timeoutMs: 1_000, maxPolls, maxDownloadBytes: 1024, fetchImpl, sleep: async () => undefined })
}

describe('ZhihuPdfParseAdapter', () => {
  it('uses the documented three-stage protocol without exposing provider identifiers', async () => {
    const calls: Array<{ url: string; headers: Headers }> = []
    const fetchImpl = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      calls.push({ url: String(input), headers: new Headers(init?.headers) })
      if (String(input).endsWith('/resources/v1/files')) return Response.json({ Code: 0, Data: { file_id: 'private-file' } })
      if (String(input).endsWith('/api/v1/pdf-parse/tasks')) return Response.json({ Code: 0, Data: { task_id: 'private-task', task_status: 'pending' } })
      if (String(input).includes('/api/v1/pdf-parse/tasks/')) return Response.json({ Code: 0, Data: { task_status: 'succeeded', result: { url: 'https://download.test/private.json', summary: '', expires_at_ms: 1 } } })
      return Response.json({ schema_version: 'v1', pages: [{ blocks: [{ content: '简历正文' }] }] })
    }) as typeof fetch
    await expect(adapter(fetchImpl).parse(Buffer.from('%PDF-1.4'))).resolves.toEqual({ pageCount: 1, text: '简历正文' })
    expect(calls[0]?.headers.get('authorization')).toBe('Bearer secret')
    expect(calls[0]?.headers.get('x-request-timestamp')).toMatch(/^\d+$/)
    expect(calls.map((call) => call.url)).toContain('https://developer.zhihu.com/api/v1/pdf-parse/tasks')
  })

  it.each([
    [{ Code: 0, Data: { task_status: 'failed' } }, 'zhihu_pdf_parse_failed'],
    [{ Code: 30002, Message: 'raw secret' }, 'zhihu_quota_exhausted'],
  ])('returns safe provider errors', async (payload, code) => {
    const fetchImpl = vi.fn(async (input: string | URL) => String(input).endsWith('/resources/v1/files') ? Response.json({ Code: 0, Data: { file_id: 'private' } }) : String(input).endsWith('/api/v1/pdf-parse/tasks') ? Response.json({ Code: 0, Data: { task_id: 'private' } }) : Response.json(payload)) as typeof fetch
    await expect(adapter(fetchImpl).parse(Buffer.from('%PDF-1.4'))).rejects.toMatchObject({ code })
  })

  it('times out after bounded polling', async () => {
    const fetchImpl = vi.fn(async (input: string | URL) => String(input).endsWith('/resources/v1/files') ? Response.json({ Code: 0, Data: { file_id: 'private' } }) : String(input).endsWith('/api/v1/pdf-parse/tasks') ? Response.json({ Code: 0, Data: { task_id: 'private' } }) : Response.json({ Code: 0, Data: { task_status: 'running' } })) as typeof fetch
    await expect(adapter(fetchImpl, 1).parse(Buffer.from('%PDF-1.4'))).rejects.toMatchObject({ code: 'zhihu_timeout' })
  })
})
