import { describe, expect, it, vi } from 'vitest'
import { CaseBuilderError, StagedModelCaseBuilder } from '../src/case-builder.js'

const intent = { targetCapability: 'python.testing', learnerRole: '负责维护订单服务的工程师', scenario: '修复订单汇总中的边界条件。', desiredObservation: '测试从失败变为通过。', difficulty: 'applied', scope: ['阅读实现', '运行测试', '最小修改'], constraints: [] }
const blueprint = { title: '订单汇总边界修复', learningGoal: '通过测试定位并修复边界条件。', taskSequence: [{ key: 'observe', instruction: '运行测试并记录失败。', expectedObservation: '看到边界测试失败。' }], assetPlan: [{ kind: 'file', key: 'order_summary', purpose: '提供待修复实现和测试。' }], verificationPlan: { commandKeys: ['pytest_quiet'], successSignals: ['passed'] }, tutorFocus: { concepts: ['边界条件'], likelyMisconceptions: [], evidenceToNotice: ['失败测试输出'] } }
const spec = { title: '订单汇总边界修复', scenario: '一个订单汇总器存在边界条件问题。', learningGoal: '通过测试定位并修复边界条件。', difficulty: 'applied', environment: { key: 'python-pytest-v1', version: '1', templateKey: 'python-pytest-v1', services: [] }, starterFiles: [{ path: 'test_order.py', content: 'def test_order():\n    assert True\n' }], tasks: [{ key: 'observe', instruction: '运行测试。', recommendedCommands: ['pytest_quiet'], expectedObservation: '测试完成。' }], verification: { commands: ['pytest_quiet'], successSignals: ['1 passed'] }, tutorContext: { concepts: ['边界条件'], likelyMisconceptions: [], evidenceToNotice: ['测试输出'] } }

function response(value: unknown): Response { return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } }) }

describe('StagedModelCaseBuilder', () => {
  it('runs intent, blueprint and implementation against one frozen context', async () => {
    const fetchMock = vi.fn(async () => response([intent, blueprint, spec][fetchMock.mock.calls.length - 1]))
    vi.stubGlobal('fetch', fetchMock)
    const attempts: string[] = []
    try {
      const builder = new StagedModelCaseBuilder({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      const result = await builder.build({ request: { roadmapNodeId: 'node-1', input: { kind: 'brief', brief: '练习 Python 测试修复' }, clientRequestId: 'request-1' }, source: null, context: { roadmapNode: { id: 'node-1', title: 'Python 测试', summary: '测试修复', completionStandard: '测试通过', capabilityKey: 'python.testing' }, roadmapRationale: [], learnerProfile: { snapshotId: null, dimensions: [] } }, onAttempt: (event) => attempts.push(`${event.phase}:${event.status}`) })
      expect(result.environment.key).toBe('python-pytest-v1')
      expect(result.verification.commands).toEqual(['pytest -q'])
      expect(fetchMock).toHaveBeenCalledTimes(3)
      expect(attempts).toEqual(['intent:running', 'intent:succeeded', 'blueprint:running', 'blueprint:succeeded', 'generate:running', 'generate:succeeded'])
    } finally { vi.unstubAllGlobals() }
  })

  it('repairs one invalid final output and keeps the reference solution private to the callback', async () => {
    const invalid = { ...spec, starterFiles: [] }
    const repaired = { exerciseSpec: spec, referenceSolution: { files: [{ path: 'src/order_summary.py', content: 'def fixed():\n    return True\n' }], verificationCommandKeys: ['pytest_quiet'] } }
    const responses = [intent, blueprint, invalid, repaired]
    const fetchMock = vi.fn(async () => response(responses[fetchMock.mock.calls.length - 1]))
    vi.stubGlobal('fetch', fetchMock)
    const attempts: string[] = []
    let referencePath = ''
    try {
      const builder = new StagedModelCaseBuilder({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      const result = await builder.build({ request: { roadmapNodeId: 'node-1', input: { kind: 'brief', brief: '练习 Python 测试修复' }, clientRequestId: 'request-1' }, source: null, context: { roadmapNode: { id: 'node-1', title: 'Python 测试', summary: '测试修复', completionStandard: '测试通过', capabilityKey: 'python.testing' }, roadmapRationale: [], learnerProfile: { snapshotId: null, dimensions: [] } }, onAttempt: (event) => attempts.push(`${event.phase}:${event.status}`), onReferenceSolution: (solution) => { referencePath = solution.files[0].path } })
      expect(result.title).toBe(spec.title)
      expect(referencePath).toBe('src/order_summary.py')
      expect(fetchMock).toHaveBeenCalledTimes(4)
      expect(attempts).toContain('generate:failed')
      expect(attempts).toContain('repair:running')
      expect(attempts).toContain('repair:succeeded')
    } finally { vi.unstubAllGlobals() }
  })

  it('records a failed stage when the blueprint output is invalid', async () => {
    const fetchMock = vi.fn(async () => response(fetchMock.mock.calls.length === 1 ? intent : { title: 'incomplete' }))
    vi.stubGlobal('fetch', fetchMock)
    const attempts: string[] = []
    try {
      const builder = new StagedModelCaseBuilder({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      await expect(builder.build({ request: { roadmapNodeId: 'node-1', input: { kind: 'brief', brief: '练习 Python 测试修复' }, clientRequestId: 'request-1' }, source: null, context: { roadmapNode: { id: 'node-1', title: 'Python 测试', summary: '测试修复', completionStandard: '测试通过', capabilityKey: 'python.testing' }, roadmapRationale: [], learnerProfile: { snapshotId: null, dimensions: [] } }, onAttempt: (event) => attempts.push(`${event.phase}:${event.status}`) })).rejects.toBeInstanceOf(CaseBuilderError)
      expect(attempts).toEqual(['intent:running', 'intent:succeeded', 'blueprint:running', 'blueprint:failed'])
      expect(fetchMock).toHaveBeenCalledTimes(2)
    } finally { vi.unstubAllGlobals() }
  })
})
