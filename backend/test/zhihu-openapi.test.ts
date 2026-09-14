import { afterEach, describe, expect, it, vi } from 'vitest'
import { ZhihuOpenApiClient, ZhihuOpenApiError } from '../src/zhihu-openapi.js'

const originalFetch = globalThis.fetch

afterEach(() => {
  globalThis.fetch = originalFetch
  vi.restoreAllMocks()
})

function client(): ZhihuOpenApiClient {
  return new ZhihuOpenApiClient({ accessSecret: 'test-access-secret', baseUrl: 'https://developer.test', timeoutMs: 1000, articlePath: '/article-content' })
}

function response(payload: unknown, status = 200): Response {
  return new Response(JSON.stringify(payload), { status, headers: { 'content-type': 'application/json' } })
}

function reply(payload: unknown, status = 200): void {
  globalThis.fetch = vi.fn(async () => response(payload, status)) as typeof fetch
}

describe('ZhihuOpenApiClient Data Platform protocol', () => {
  it('unwraps the official envelope and maps formal search fields', async () => {
    const requests: Request[] = []
    globalThis.fetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      requests.push(new Request(input, init))
      return response({ Code: '0', Message: 'success', Data: { Items: [{
        Title: 'MySQL 执行计划分析', ContentID: 'content-42', ContentText: '使用 EXPLAIN 观察索引命中与扫描范围。',
        Url: 'https://www.zhihu.com/question/42/answer/7', AuthorName: '数据库作者', EditTime: '2026-09-14T00:00:00Z', AuthorityLevel: 4, RankingScore: 0.98,
      }] } })
    }) as typeof fetch

    const items = await client().search('  MySQL   EXPLAIN  ', 20)

    expect(items).toHaveLength(1)
    expect(items[0]).toMatchObject({ externalId: 'content-42', title: 'MySQL 执行计划分析', author: '数据库作者', url: 'https://www.zhihu.com/question/42/answer/7', excerpt: '使用 EXPLAIN 观察索引命中与扫描范围。', query: 'MySQL EXPLAIN', metadata: { authority: 4, score: 0.98, editTime: '2026-09-14T00:00:00Z' } })
    expect(requests[0]?.url).toBe('https://developer.test/api/v1/content/zhihu_search?Query=MySQL%20EXPLAIN&Count=10')
    expect(requests[0]?.headers.get('authorization')).toBe('Bearer test-access-secret')
    expect(requests[0]?.headers.get('x-request-timestamp')).toMatch(/^\d+$/)
  })

  it('keeps lowercase legacy search fixtures compatible', async () => {
    reply({ data: { items: [{ id: 'legacy-1', title: '旧格式标题', author: { name: '旧作者' }, url: 'https://www.zhihu.com/p/1', excerpt: '旧格式摘要', authority_level: 2, score: 1.5 }] } })

    await expect(client().search('旧格式')).resolves.toMatchObject([{ externalId: 'legacy-1', title: '旧格式标题', author: '旧作者', metadata: { authority: 2, score: 1.5 } }])
  })

  it('returns an empty list for an official successful envelope with no items', async () => {
    reply({ Code: 0, Message: 'success', Data: { Items: [] } })

    await expect(client().search('空结果')).resolves.toEqual([])
  })

  it.each([
    [{ Code: 30001, Message: 'raw quota message' }, 'zhihu_rate_limited', true],
    [{ Code: '30002', Message: 'raw quota message' }, 'zhihu_quota_exhausted', false],
    [{ Code: 99999, Message: 'test-access-secret raw provider message' }, 'zhihu_business_error', false],
  ])('maps Data Platform business codes without exposing provider messages', async (payload, code, retryable) => {
    reply(payload)

    try {
      await client().search('错误')
      throw new Error('expected a ZhihuOpenApiError')
    } catch (error) {
      expect(error).toBeInstanceOf(ZhihuOpenApiError)
      expect(error).toMatchObject({ code, retryable })
      expect((error as Error).message).not.toContain('raw')
      expect((error as Error).message).not.toContain('test-access-secret')
    }
  })

  it.each([
    [429, 'zhihu_rate_limited', true],
    [503, 'zhihu_upstream_unavailable', true],
  ])('maps retryable HTTP status %i safely', async (status, code, retryable) => {
    reply({ error: 'raw upstream failure' }, status)

    await expect(client().search('HTTP 错误')).rejects.toMatchObject({ code, retryable })
  })

  it.each([
    [429, { Code: 30002, Message: 'raw quota payload' }, 'zhihu_rate_limited', true],
    [503, { Code: 30001, Message: 'raw rate-limit payload' }, 'zhihu_upstream_unavailable', true],
  ])('prioritizes HTTP status %i over a conflicting Data Platform business code', async (status, payload, code, retryable) => {
    reply(payload, status)

    await expect(client().search('HTTP 优先级')).rejects.toMatchObject({ code, retryable })
  })

  it.each([
    [400, { Code: '30002', Message: 'raw quota payload' }, 'zhihu_quota_exhausted', false],
    [401, { Code: 99999, Message: 'raw unknown payload' }, 'zhihu_business_error', false],
    [404, { error: 'raw body without envelope' }, 'zhihu_http_error', false],
  ])('classifies 4xx status %i with safe Data Platform fallback', async (status, payload, code, retryable) => {
    reply(payload, status)

    await expect(client().search('4xx 分类')).rejects.toMatchObject({ code, retryable })
  })

  it('rejects invalid JSON without including the raw response', async () => {
    globalThis.fetch = vi.fn(async () => new Response('test-access-secret <invalid>', { status: 200, headers: { 'content-type': 'application/json' } })) as typeof fetch

    try {
      await client().search('无效 JSON')
      throw new Error('expected a ZhihuOpenApiError')
    } catch (error) {
      expect(error).toMatchObject({ code: 'zhihu_invalid_json' })
      expect((error as Error).message).not.toContain('test-access-secret')
    }
  })

  it('reads formal article content only from a successful Data envelope', async () => {
    reply({ Code: 0, Message: 'success', Data: { ContentText: '# 正文\n\n这是知乎返回的正式正文。' } })

    await expect(client().fetchArticle({ externalId: 'article-1', url: 'https://www.zhihu.com/p/1' })).resolves.toBe('# 正文\n\n这是知乎返回的正式正文。')
  })

  it('does not treat a failed article envelope as content', async () => {
    reply({ Code: 30001, Message: 'test-access-secret raw failure', Data: { ContentText: '不能作为正文返回。' } })

    try {
      await client().fetchArticle({ externalId: 'article-1', url: 'https://www.zhihu.com/p/1' })
      throw new Error('expected a ZhihuOpenApiError')
    } catch (error) {
      expect(error).toMatchObject({ code: 'zhihu_rate_limited' })
      expect((error as Error).message).not.toContain('test-access-secret')
    }
  })

  it('keeps Zhida responses on the OpenAI-style choices contract', async () => {
    reply({ choices: [{ message: { content: '知识地形与两个检索意图。' } }] })

    await expect(client().research({ goal: '学习 MySQL', profileSummary: '有基础', nodeTitle: '索引设计' })).resolves.toBe('知识地形与两个检索意图。')
  })
})
