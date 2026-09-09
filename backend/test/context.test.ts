import { describe, expect, it } from 'vitest'
import { buildWorkspaceTutorContext } from '../src/context.js'
import type { Artifact, LearningCase, PracticeEvent, PracticeRun, StageMemory } from '../src/product-types.js'

const run: PracticeRun = { id: 'practice-1', learnerId: 'learner-1', planUnitId: null, caseId: 'workspace:case-1', practiceKind: 'code_workspace', learningCaseId: 'case-1', labRunId: null, stage: 'attempt', hintLevel: 0, noProgressCount: 0, status: 'active', createdAt: '', updatedAt: '' }
const learningCase: LearningCase = {
  id: 'case-1', learnerId: 'learner-1', roadmapNodeId: 'node-1', capabilityKey: 'python.testing', templateKey: 'python-pytest-v1', inputKind: 'brief', inputSnapshot: { context: { roadmapNode: { title: 'Python 测试', summary: '理解测试反馈', completionStandard: '能修复并验证一个边界问题' } } }, inputFingerprint: 'fingerprint', provider: 'fixture', version: 1, status: 'ready',
  spec: { title: '边界修复', scenario: '一个订单汇总器', learningGoal: '定位并修复测试失败', difficulty: 'applied', environment: { templateKey: 'python-pytest-v1', services: [] }, starterFiles: [{ path: 'order.py', content: 'def total(items):\n    return sum(items)\n' }], tasks: [{ key: 'observe', instruction: '先运行测试', recommendedCommands: ['pytest -q'], expectedObservation: '看到失败断言' }], verification: { commands: ['pytest -q'], successSignals: ['passed'] }, tutorContext: { concepts: ['边界条件'], likelyMisconceptions: ['只改断言'], evidenceToNotice: ['失败输出'] } },
  failureCode: null, failureMessage: null, createdAt: '', updatedAt: '',
}

function artifact(partial: Partial<Artifact> & Pick<Artifact, 'id' | 'kind' | 'content'>): Artifact {
  return { learnerId: 'learner-1', practiceRunId: run.id, sourceKind: 'workspace', verificationStatus: 'not_applicable', metadata: {}, checksum: '', createdAt: '', ...partial }
}

describe('workspace tutor context', () => {
  it('keeps workspace context bounded to current case evidence', () => {
    const events: PracticeEvent[] = [{ id: 'event-1', learnerId: run.learnerId, practiceRunId: run.id, sequence: 1, actor: 'workspace', type: 'workspace_execution_finished', stage: 'attempt', payload: { command: 'pytest -q', status: 'failed', exitCode: 1, durationMs: 35 }, artifactRefs: ['output-1'], clientRequestId: null, createdAt: '' }]
    const artifacts = [artifact({ id: 'output-1', kind: 'workspace_error', content: 'FAILED test_order.py::test_empty', metadata: { executionId: 'execution-1' } }), artifact({ id: 'file-1', kind: 'workspace_file', content: 'def total(items):\n    return sum(items)\n', metadata: { path: 'order.py', revision: 2 } }), artifact({ id: 'old-sql', kind: 'sql', content: 'SELECT * FROM orders' })]
    const stageMemories: StageMemory[] = []
    const context = buildWorkspaceTutorContext({ goal: '完成 Python 测试案例', run, learningCase, workspaceStatus: 'active', events, artifacts, pathNodes: [], stageMemories })

    expect(context.workspace.status).toBe('active')
    expect(context.workspace.node.title).toBe('Python 测试')
    expect(context.workspace.currentTask?.key).toBe('observe')
    expect(context.workspace.recentExecutions[0]).toMatchObject({ command: 'pytest -q', status: 'failed', stderr: 'FAILED test_order.py::test_empty' })
    expect(context.workspace.recentFiles).toEqual([{ path: 'order.py', revision: 2, content: expect.stringContaining('def total') }])
    expect(context.rawEvidence.map((item) => item.kind)).not.toContain('sql')
  })
})
