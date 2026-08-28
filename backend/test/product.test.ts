import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

function withRepository<T>(callback: (repository: ProductRepository) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-product-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  try { return callback(repository) } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

describe('product repository', () => {
  it('applies a plan and keeps ordered units', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const intake = repository.createIntake({ learnerId: 'learner-1', goal: '学习 MySQL 慢查询', technology: 'MySQL 8' })
    const plan = repository.createPlan({ learnerId: 'learner-1', intakeId: intake.id, title: 'MySQL route', goal: intake.goal, sourceStatus: 'local_catalog', units: [
      { position: 1, title: '观察', objective: '建立证据意识', caseId: null, status: 'current', sourceRefs: [] },
      { position: 2, title: '慢查询', objective: '验证索引', caseId: 'mysql-order-list-index-001', status: 'upcoming', sourceRefs: [] },
    ] })
    expect(plan.units.map((unit) => unit.position)).toEqual([1, 2])
    expect(repository.getIntake(intake.id).status).toBe('planned')
  }))

  it('deduplicates events inside the transactional write', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    const input = { learnerId: run.learnerId, practiceRunId: run.id, actor: 'user' as const, type: 'user_message' as const, stage: 'observe' as const, payload: { message: 'same' }, clientRequestId: 'request-1' }
    const first = repository.appendEvent(input)
    const second = repository.appendEvent(input)
    expect(second.id).toBe(first.id)
    expect(repository.listEvents(run.id)).toHaveLength(1)
    expect(repository.listEvents(run.id)[0]?.sequence).toBe(1)
  }))

  it('keeps current stage memory separate from long-term memory', () => withRepository((repository) => {
    repository.ensureLearner('learner-1')
    const run = repository.createPracticeRun({ learnerId: 'learner-1', caseId: 'mysql-order-list-index-001' })
    repository.upsertStageMemory({ practiceRunId: run.id, stage: 'observe', memory: { currentGap: 'EXPLAIN' }, sourceEventRefs: [] })
    const memory = repository.upsertMemory({ learnerId: 'learner-1', category: 'gap', topic: 'explain', status: 'active', statement: '还不能稳定解释执行计划', scope: run.caseId, confidence: 0.8, evidenceRefs: [], userNote: null })
    expect(repository.listStageMemories(run.id)[0]?.memory.currentGap).toBe('EXPLAIN')
    expect(repository.listMemories('learner-1')[0]?.id).toBe(memory.id)
  }))
})
