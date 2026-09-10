import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder, ModelCaseBuilder } from '../src/case-builder.js'

const validSpec = {
  title: '配置解析器的边界修复',
  scenario: '一个配置解析器在缺少可选字段时行为不稳定。',
  learningGoal: '通过测试定位并修复边界条件。',
  difficulty: 'applied',
  environment: { templateKey: 'python-pytest-v1', services: [] },
  starterFiles: [{ path: 'test_config.py', content: 'def test_config():\n    assert True\n' }],
  tasks: [{ key: 'observe', instruction: '运行测试并记录现象。', recommendedCommands: ['pytest -q'], expectedObservation: '测试结果可见。' }],
  verification: { commands: ['pytest -q'], successSignals: ['1 passed'] },
  tutorContext: { concepts: ['边界条件'], likelyMisconceptions: [], evidenceToNotice: ['pytest 输出'] },
}

function modelResponse(value: unknown): Response {
  return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(value) } }] }), { headers: { 'content-type': 'application/json' } })
}

describe('ModelCaseBuilder', () => {
  it('repairs one invalid structured response and returns a validated CaseSpec', async () => {
    const responses = [{ malformed: true }, validSpec]
    const fetchMock = vi.fn(async () => modelResponse(responses.shift() ?? validSpec))
    vi.stubGlobal('fetch', fetchMock)
    const attempts: string[] = []
    try {
      const builder = new ModelCaseBuilder({ modelBaseUrl: 'https://model.test', modelApiKey: 'test-key', modelName: 'test-model', modelTimeoutMs: 1000 })
      const spec = await builder.build({ request: { roadmapNodeId: 'node-1', input: { kind: 'brief', brief: '练习测试修复' }, clientRequestId: 'request-1' }, source: null, onAttempt: (event) => attempts.push(`${event.phase}:${event.status}`) })
      expect(spec.title).toBe(validSpec.title)
      expect(fetchMock).toHaveBeenCalledTimes(2)
      expect(attempts).toEqual(['repair:running', 'repair:succeeded'])
    } finally { vi.unstubAllGlobals() }
  })

  it('fails explicitly when the model is not configured', async () => {
    const builder = new ModelCaseBuilder({ modelBaseUrl: '', modelApiKey: '', modelName: 'test-model', modelTimeoutMs: 1000 })
    await expect(builder.build({ request: { roadmapNodeId: 'node-1', input: { kind: 'brief', brief: '练习测试修复' }, clientRequestId: 'request-2' }, source: null })).rejects.toMatchObject({ code: 'model_not_configured' })
  })
})

describe('FixtureCaseBuilder', () => {
  it('builds the admitted Go fixture with a platform-owned command', async () => {
    const result = await new FixtureCaseBuilder().build({
      request: { roadmapNodeId: 'go-node', input: { kind: 'brief', brief: '练习 Go 测试边界条件' }, clientRequestId: 'go-case' },
      source: null,
      context: { roadmapNode: { id: 'go-node', title: 'Go 测试', summary: 'Go 测试', completionStandard: '测试通过', capabilityKey: 'go.testing' }, roadmapRationale: [], learnerProfile: { snapshotId: null, dimensions: [] } },
    })
    expect(result.environment.key).toBe('go-test-v1')
    expect(result.verification.commands).toEqual(['go test ./...'])
    expect(result.starterFiles.some((file) => file.path.endsWith('.go'))).toBe(true)
  })
})
