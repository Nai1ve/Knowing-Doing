import { afterEach, describe, expect, it, vi } from 'vitest'
import { DeepSeekPracticeCardGenerator } from '../src/practice-card-generator.js'

const input = {
  intent: {
    objective: '能用执行计划解释索引选择', learnerLevel: 'applied', learnerGaps: ['边界条件'],
    completionStandard: '给出预测和验证证据', preferredRuntime: 'none' as const, estimatedMinutes: 45,
  },
  sources: [],
}

const repaired = {
  title: '执行计划判断卡', summary: '从证据、边界和反思形成判断。',
  activities: [
    { id: 'concept', type: 'concept', title: '概念', prompt: '阅读目标。', required: true },
    { id: 'k1', type: 'knowledge_check', title: '证据', prompt: '先做什么？', options: [{ value: 'observe', label: '观察' }, { value: 'guess', label: '猜测' }], required: true, core: true },
    { id: 'k2', type: 'knowledge_check', title: '边界', prompt: '什么更可靠？', options: [{ value: 'boundary', label: '说明边界' }, { value: 'memory', label: '背结论' }], required: true, core: true },
    { id: 'scenario', type: 'scenario_reasoning', title: '预测', prompt: '写下可推翻判断的证据。', required: true },
    { id: 'reflection', type: 'reflection', title: '反思', prompt: '记录下一步。', required: true },
  ],
  answerKey: { k1: 'observe', k2: 'boundary' }, hints: { k1: '先看证据。', k2: '检查成立条件。' },
  explanations: { k1: '观察优先于猜测。', k2: '边界让结论可迁移。' }, references: { k1: 'observe', k2: 'boundary' },
}

describe('DeepSeekPracticeCardGenerator', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('uses exactly one diagnostic repair when the first model output violates the contract', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: '{"title":"invalid"}' } }] }))
      .mockResolvedValueOnce(Response.json({ choices: [{ message: { content: JSON.stringify(repaired) } }] }))
    vi.stubGlobal('fetch', fetchMock)
    const generator = new DeepSeekPracticeCardGenerator({ modelBaseUrl: 'https://model.test', modelApiKey: 'secret', modelName: 'deepseek-flash', modelTimeoutMs: 1000 })

    const card = await generator.generate(input)

    expect(card.activities).toHaveLength(5)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const repairRequest = JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body)) as { messages: Array<{ content: string }> }
    expect(repairRequest.messages[1]?.content).toContain('diagnostic')
  })
})
