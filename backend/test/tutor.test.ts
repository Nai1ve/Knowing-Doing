import { describe, expect, it, vi } from 'vitest'
import type { LabConfig } from '../src/config.js'
import type { TutorContext } from '../src/context.js'
import type { PracticeRun, SourceItem } from '../src/product-types.js'
import { TutorEngine, TutorProviderError } from '../src/tutor.js'

const run: PracticeRun = { id: 'run-1', learnerId: 'learner-1', planUnitId: null, caseId: 'mysql-order-list-index-001', labRunId: null, stage: 'inspect', hintLevel: 0, noProgressCount: 0, status: 'active', createdAt: '', updatedAt: '' }
const context: TutorContext = { hot: { goal: '学习 MySQL 慢查询', caseId: run.caseId, stage: run.stage, latestError: null, currentGap: '请解释执行计划' }, recentEvents: [], rawEvidence: [{ id: 'evidence-1', kind: 'explain', verificationStatus: 'verified_lab', content: 'type=ALL', metadata: {} }], path: [], stageMemory: [], availableSourceIds: [] }
const source: SourceItem = { id: 'source-1', provider: 'zhihu', externalId: 'answer-1', title: 'EXPLAIN 经验', author: '作者', url: 'https://www.zhihu.com/question/1', excerpt: '执行计划的实践解释。', query: 'MySQL EXPLAIN', retrievedAt: new Date().toISOString(), metadata: {} }

function engine(): TutorEngine {
  return new TutorEngine({ modelBaseUrl: 'https://model.test', modelApiKey: 'secret', modelName: 'test-model', modelTimeoutMs: 1000 } as LabConfig)
}

describe('TutorEngine', () => {
  it('filters reasoning and unknown source markers while streaming natural language', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      'data: {"choices":[{"delta":{"reasoning_content":"do not show"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"<think>隐藏思路</think>先看执行计划 [[source:source-1]] 和 [[source:unknown]]。"}}]}',
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { headers: { 'Content-Type': 'text/event-stream' } })))
    const deltas: string[] = []
    const result = await engine().generate(run, context, '我该看什么？', [source], (delta) => deltas.push(delta))
    expect(result.response).toBe('先看执行计划 和 。')
    expect(result.sourceRefs).toEqual([{ sourceId: source.id, reason: expect.stringContaining(source.title) }])
    expect(deltas.join('')).not.toContain('隐藏思路')
    expect(deltas.join('')).not.toContain('source:unknown')
    vi.unstubAllGlobals()
  })

  it('preserves code block line breaks and indentation while streaming', async () => {
    const answer = '先执行这条 SQL：\n\n```sql\nSELECT id\n  FROM orders\n  WHERE status = \'PAID\'\n```\n\n再比较执行计划。'
    vi.stubGlobal('fetch', vi.fn(async () => new Response([
      `data: ${JSON.stringify({ choices: [{ delta: { content: answer } }] })}`,
      '',
      'data: [DONE]',
      '',
    ].join('\n'), { headers: { 'Content-Type': 'text/event-stream' } })))
    const deltas: string[] = []
    const result = await engine().generate(run, context, '给我 SQL 示例', [], (delta) => deltas.push(delta))
    expect(result.response).toBe(answer)
    expect(deltas.join('')).toBe(answer)
    vi.unstubAllGlobals()
  })

  it('raises a structured error instead of returning a scripted answer', async () => {
    const missing = new TutorEngine({} as LabConfig)
    await expect(missing.generate(run, context, '继续', [])).rejects.toMatchObject({ code: 'model_not_configured' })
    vi.stubGlobal('fetch', vi.fn(async () => new Response('upstream unavailable', { status: 503 })))
    await expect(engine().respond(run, context, '继续')).rejects.toBeInstanceOf(TutorProviderError)
    vi.unstubAllGlobals()
  })
})
