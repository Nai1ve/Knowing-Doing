import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { PlanningService } from '../src/planning.js'

function withPlanning<T>(callback: (service: PlanningService, repository: ProductRepository) => T): T {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-planning-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  try { return callback(new PlanningService(repository), repository) } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

function completeConversation(service: PlanningService, learnerId: string, goal = '成为高级后端 + AI 应用工程师') {
  let session = service.createSession(learnerId, { goal, clientRequestId: `${learnerId}-${goal}` })
  const answers = [
    ['experience', '做过后端服务', '做过后端服务'],
    ['priority_domain', '后端系统能力', '后端系统能力'],
    ['weekly_minutes', '每周 2 到 4 小时', 180],
    ['outcome', '一个可运行项目', '一个可运行项目'],
    ['summary', '确认路线草案', '确认路线草案'],
  ] as const
  for (const [stepKey, answer, structuredValue] of answers) session = service.addTurn(learnerId, session.id, { revision: session.revision, stepKey, answer, structuredValue })
  return { session, draft: service.getDraftForLearner(learnerId, session.draftRoadmapId!) }
}

describe('PlanningService', () => {
  it('persists ordered rule turns and instantiates the complete roadmap tree', () => withPlanning((service) => {
    const { session, draft } = completeConversation(service, 'planning-learner')
    expect(session.status).toBe('ready')
    expect(session.turns.map((turn) => turn.stepKey)).toEqual(['goal', 'experience', 'priority_domain', 'weekly_minutes', 'outcome', 'summary'])
    expect(session.turns.map((turn) => turn.sequence)).toEqual([1, 2, 3, 4, 5, 6])
    expect(draft.nodes).toHaveLength(22)
    expect(draft.nodes.filter((node) => node.parentId === null)).toHaveLength(3)
    expect(draft.nodes.find((node) => node.nodeKey === 'mysql-slow-query')?.caseId).toBe('mysql-order-list-index-001')
  }))

  it('creates a draft diff without changing a current plan before confirmation', () => withPlanning((service, repository) => {
    const { draft } = completeConversation(service, 'adjust-learner')
    const adjusted = service.adjust('adjust-learner', draft.planningSessionId, { revision: draft.planningSessionRevision, weeklyMinutes: 300, priorityDomain: 'AI 应用工程' })
    expect(adjusted.diff.map((item) => item.key)).toEqual(['weekly_minutes', 'priority_domain'])
    expect(adjusted.status).toBe('draft')
    expect(repository.getActivePlan('adjust-learner')).toBeNull()
  }))

  it('keeps mastered nodes as explicit self-reported progress in the next draft', () => withPlanning((service) => {
    const { session, draft } = completeConversation(service, 'mastered-learner')
    const adjusted = service.adjust('mastered-learner', session.id, {
      revision: session.revision,
      masteredNodeKeys: ['mysql-slow-query', 'index-fundamentals'],
    })
    expect(adjusted.nodes.find((node) => node.nodeKey === 'mysql-slow-query')?.status).toBe('self_reported')
    expect(adjusted.nodes.find((node) => node.nodeKey === 'index-fundamentals')?.status).toBe('self_reported')
    expect(adjusted.nodes.find((node) => node.nodeKey === 'rag')?.status).toBe('locked')
    expect(draft.id).not.toBe(adjusted.id)
  }))

  it('switches plans atomically while preserving the historical plan and makes confirmation idempotent', () => withPlanning((service, repository) => {
    const first = completeConversation(service, 'confirm-learner')
    const oldPlan = service.confirm('confirm-learner', first.draft.id, first.draft.revision)
    const second = completeConversation(service, 'confirm-learner', '成为更强的后端与 AI 工程师')
    const newPlan = service.confirm('confirm-learner', second.draft.id, second.draft.revision)
    expect(newPlan.id).not.toBe(oldPlan.id)
    expect(repository.getPlanForLearner(oldPlan.id, 'confirm-learner').status).toBe('superseded')
    expect(repository.getActivePlan('confirm-learner')?.id).toBe(newPlan.id)
    expect(service.confirm('confirm-learner', second.draft.id, second.draft.revision).id).toBe(newPlan.id)
  }))

  it('compares a re-planning draft with the current roadmap before confirmation', () => withPlanning((service, repository) => {
    const first = completeConversation(service, 'replan-learner')
    service.confirm('replan-learner', first.draft.id, first.draft.revision)
    const second = completeConversation(service, 'replan-learner', '成为高级后端与 AI 应用工程师')
    const adjusted = service.adjust('replan-learner', second.session.id, { revision: second.session.revision, weeklyMinutes: 300 })
    expect(adjusted.diff.find((item) => item.key === 'weekly_minutes')?.before).toBe('180')
    expect(repository.getActivePlan('replan-learner')?.goal).toBe('成为高级后端 + AI 应用工程师')
  }))

  it('protects ownership and revision, and updates concept and Lab progress from their proper sources', () => withPlanning((service, repository) => {
    const { draft } = completeConversation(service, 'owner-learner')
    expect(() => service.getDraftForLearner('other-learner', draft.id)).toThrow('路线图不存在')
    expect(() => service.adjust('owner-learner', draft.planningSessionId, { revision: draft.planningSessionRevision + 1, weeklyMinutes: 90 })).toThrow('规划内容已更新')
    const plan = service.confirm('owner-learner', draft.id, draft.revision)
    const roadmapId = plan.roadmapId!
    const branch = service.listNodes('owner-learner', roadmapId, draft.nodes.find((node) => node.nodeKey === 'data-performance')!.id)
    const concept = branch.nodes.find((node) => node.nodeKey === 'index-fundamentals')!
    const completed = service.completeNode('owner-learner', roadmapId, concept.id, { revision: concept.progressRevision })
    expect(completed.status).toBe('completed')
    const locked = draft.nodes.find((node) => node.nodeKey === 'rag')!
    expect(() => service.completeNode('owner-learner', roadmapId, locked.id, { revision: locked.progressRevision })).toThrow('当前节点需要展开子节点后完成')
    const labUnit = plan.units.find((unit) => unit.caseId === 'mysql-order-list-index-001')!
    const run = repository.createPracticeRun({ learnerId: 'owner-learner', planUnitId: labUnit.id, caseId: labUnit.caseId! })
    repository.updatePracticeRun(run.id, { stage: 'resolved', status: 'resolved' })
    service.markLabVerified(run.id)
    const labNode = service.listNodes('owner-learner', roadmapId, concept.parentId).nodes.find((node) => node.nodeKey === 'mysql-slow-query')!
    expect(labNode.status).toBe('verified')
  }))
})
