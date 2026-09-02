import { describe, expect, it, vi } from 'vitest'
import { DeepSeekWritingAgent } from '../src/writing-agent.js'
import type { WritingEvidencePack } from '../src/product-types.js'
import type { WritingEvidenceItem } from '../src/product-types.js'

const config = { modelBaseUrl: 'https://api.example.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 20 }
const pack = { snapshot: { nodes: [] } } as unknown as WritingEvidencePack

describe('DeepSeekWritingAgent', () => {
  it('removes thinking blocks and accepts fenced JSON content', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { reasoning_content: 'hidden reasoning', content: '<think>hidden</think>```json\n{"title":"复盘"}\n```' } }] }), { status: 200 })))
    try {
      const result = await new DeepSeekWritingAgent(config).generate({ kind: 'outline', evidencePack: pack })
      expect(result).toEqual({ title: '复盘' })
    } finally { vi.unstubAllGlobals() }
  })

  it('maps request timeout to a retryable structured error', async () => {
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init?: RequestInit) => new Promise((_, reject) => {
      init?.signal?.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })))
    })))
    try {
      await expect(new DeepSeekWritingAgent(config).generate({ kind: 'article', evidencePack: pack })).rejects.toMatchObject({ code: 'model_timeout', retryable: true })
    } finally { vi.unstubAllGlobals() }
  })

  it('lets the narrative agent search the current pack before writing Markdown', async () => {
    const item: WritingEvidenceItem = { id: 'item-1', projectId: 'project-1', evidencePackId: 'pack-1', refType: 'artifact', refId: 'artifact-1', kind: 'user_message', title: '用户输入', body: '需要理解一次实践中的问题', createdAt: new Date().toISOString(), metadata: {} }
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: null, tool_calls: [{ id: 'call-1', function: { name: 'search_evidence', arguments: JSON.stringify({ query: '实践中的问题', limit: 3 }) } }] } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '# 我的实践\n\n我找到了问题。[[ref:artifact:artifact-1]]' } }] }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ choices: [{ message: { content: '# 我的实践\n\n我终于找到了问题。[[ref:artifact:artifact-1]]' } }] }), { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)
    try {
      const agent = new DeepSeekWritingAgent(config)
      const markdown = await agent.generateNarrative({ evidencePack: pack, items: [item], searchEvidence: () => [item] })
      const humanized = await agent.humanize(markdown)
      expect(markdown).toContain('[[ref:artifact:artifact-1]]')
      expect(humanized).toContain('终于')
      expect(fetchMock).toHaveBeenCalledTimes(3)
    } finally { vi.unstubAllGlobals() }
  })
})
