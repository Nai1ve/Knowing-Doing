import { describe, expect, it, vi } from 'vitest'
import { DeepSeekWritingAgent } from '../src/writing-agent.js'
import type { WritingEvidencePack } from '../src/product-types.js'

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
})
