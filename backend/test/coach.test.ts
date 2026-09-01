import { describe, expect, it } from 'vitest'
import { evaluatePracticeCompletion } from '../src/coach.js'
import type { Artifact, PracticeEvent, PracticeRun } from '../src/product-types.js'

const run: PracticeRun = {
  id: 'run-1', learnerId: 'learner-1', planUnitId: null, caseId: 'mysql-order-list-index-001', labRunId: 'lab-1',
  stage: 'verify', hintLevel: 0, noProgressCount: 0, status: 'active', createdAt: '', updatedAt: '',
}

function artifact(kind: Artifact['kind'], statement: string, id: string, createdAt: string, rows?: unknown[][], rawOutput = ''): Artifact {
  return {
    id, learnerId: run.learnerId, practiceRunId: run.id, kind, sourceKind: 'lab', verificationStatus: 'verified_lab',
    content: rawOutput, checksum: id, createdAt,
    metadata: { execution: { executionId: `execution-${id}`, runId: 'lab-1', caseId: run.caseId, revision: 1, clientRequestId: id, session: 'default', statement, status: 'succeeded', startedAt: createdAt, durationMs: 10, result: { kind: kind === 'result_set' ? 'result_set' : kind === 'explain' ? 'result_set' : 'command', columns: kind === 'explain' ? ['id', 'type', 'key', 'rows', 'Extra'] : ['id'], rows, rowCount: rows?.length ?? 0, affectedRows: kind === 'sql' ? 1 : undefined, warningCount: 0, truncated: false, rawOutput } } },
  }
}

const events: PracticeEvent[] = [{
  id: 'event-1', learnerId: run.learnerId, practiceRunId: run.id, sequence: 1, actor: 'lab', type: 'evidence_captured', stage: 'verify',
  payload: { artifactKind: 'result_set' }, artifactRefs: [], clientRequestId: null, createdAt: '2026-09-01T00:00:00.000Z',
}]

describe('practice completion coach', () => {
  it('requires a complete, comparable evidence chain before close', () => {
    const artifacts = [
      artifact('explain', 'EXPLAIN SELECT * FROM orders', 'baseline-plan', '2026-09-01T00:00:01.000Z', undefined, 'type | key | rows | Extra\nALL | NULL | 100000 | Using where'),
      artifact('result_set', 'SELECT * FROM orders', 'baseline-result', '2026-09-01T00:00:02.000Z', [[1]], 'id\n1'),
      artifact('sql', 'CREATE INDEX idx_orders_user_status_created ON orders (user_id, status, created_at)', 'index-attempt', '2026-09-01T00:00:03.000Z'),
      artifact('explain', 'EXPLAIN SELECT * FROM orders', 'optimized-plan', '2026-09-01T00:00:04.000Z', undefined, 'type | key | rows | Extra\nref | idx_demo | 10 | Using index'),
      artifact('result_set', 'SELECT * FROM orders', 'optimized-result', '2026-09-01T00:00:05.000Z', [[1]], 'id\n1'),
    ]
    const completion = evaluatePracticeCompletion(run, { artifacts, events })
    expect(completion.status).toBe('ready_to_close')
    expect(completion.ready).toBe(true)
    expect(completion.missing).toEqual([])
  })

  it('does not infer completion from a lone explain artifact', () => {
    const completion = evaluatePracticeCompletion(run, { artifacts: [artifact('explain', 'EXPLAIN SELECT * FROM orders', 'only-plan', '2026-09-01T00:00:01.000Z', undefined, 'type | key | rows | Extra')], events: [] })
    expect(completion.status).toBe('in_progress')
    expect(completion.ready).toBe(false)
    expect(completion.missing).toContain('优化 SQL 或索引尝试')
  })

  it('keeps a resolved practice resolved while retaining its evidence checks', () => {
    const completion = evaluatePracticeCompletion({ ...run, status: 'resolved' }, { artifacts: [], events: [] })
    expect(completion.status).toBe('resolved')
    expect(completion.ready).toBe(false)
  })
})
