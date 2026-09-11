import { describe, expect, it, vi } from 'vitest'
import { CaseDesignAgent } from '../src/case-design-agent.js'

const candidate = { key: 'mysql-explain', capabilityKey: 'mysql.explain-plan', environmentKey: 'mysql-performance-v1', environmentVersion: '1', runtimeKind: 'mysql_lab', exerciseProfileKey: 'mysql.explain-plan-v1', displayName: 'MySQL EXPLAIN', summary: '受控执行计划练习' }
const materialization = { capabilityKey: 'mysql.explain-plan' as const, environmentKey: 'mysql-performance-v1' as const, environmentVersion: '1' as const, schemaTemplateKey: 'orders-explain-v1' as const, seedProfileKey: 'orders-100k-v1' as const, faultKey: 'missing_index' as const, queryTemplateKey: 'orders-explain-filter-sort-v1' as const, parameters: { rowCount: 100_000, distribution: 'uniform' as const } }
const valid = { candidateKey: 'mysql-explain', title: '执行计划解读', scenario: '观察多条件筛选的执行计划。', learningGoal: '解释 type、key、rows、Extra。', tasks: [{ key: 'observe', instruction: '观察基线 EXPLAIN。', expectedObservation: '记录关键字段。' }, { key: 'compare', instruction: '比较修复后的 EXPLAIN。', expectedObservation: '说明字段变化。' }], verification: { signals: ['能解释前后差异。'] }, tutorContext: { concepts: ['EXPLAIN'], likelyMisconceptions: ['只看 key'], evidenceToNotice: ['rows'] } }

describe('CaseDesignAgent', () => {
  it('repairs invalid structured output and only accepts a catalog candidate', async () => {
    const responses = [{ candidateKey: 'outside-catalog' }, valid]
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(responses.shift()) } }] }), { status: 200 })))
    const attempts: Array<{ phase: string; status: string }> = []
    try {
      const agent = new CaseDesignAgent({ modelBaseUrl: 'https://model.test', modelApiKey: 'test', modelName: 'test-model', modelTimeoutMs: 1_000 })
      const result = await agent.design({ card: { nodeId: 'node', title: 'EXPLAIN', summary: '执行计划', completionStandard: '解释字段', knowledgeCard: {}, evidence: [], learnerProfile: [] }, candidates: [candidate], materializationByCandidate: { 'mysql-explain': materialization } }, (event) => attempts.push(event))
      expect(result.candidate.key).toBe('mysql-explain')
      expect(result.spec.exerciseProfileKey).toBe('mysql.explain-plan-v1')
      expect(attempts).toContainEqual(expect.objectContaining({ phase: 'design', status: 'failed' }))
      expect(attempts).toContainEqual(expect.objectContaining({ phase: 'repair', status: 'succeeded' }))
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects a model-selected candidate outside the catalog', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ ...valid, candidateKey: 'outside-catalog' }) } }] }), { status: 200 })))
    try {
      const agent = new CaseDesignAgent({ modelBaseUrl: 'https://model.test', modelApiKey: 'test', modelName: 'test-model', modelTimeoutMs: 1_000 })
      await expect(agent.design({ card: { nodeId: 'node', title: 'EXPLAIN', summary: '执行计划', completionStandard: '解释字段', knowledgeCard: {}, evidence: [], learnerProfile: [] }, candidates: [candidate], materializationByCandidate: { 'mysql-explain': materialization } })).rejects.toMatchObject({ code: 'environment_selection_invalid' })
    } finally { vi.unstubAllGlobals() }
  })
})
