import { mkdtempSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentPlanningService, type PlanningProvider } from '../src/agent-planning.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

function serviceFor(test: (service: AgentPlanningService, repository: ProductRepository) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-diagnostic-')); const database = path.join(directory, 'product.db'); applyProductMigrations(database); const repository = new ProductRepository(database)
  const provider: PlanningProvider = { providerName: 'test', modelName: 'test-model', async stream(_input, onDelta) { await onDelta('我先确认目标和当前经验。'); return '我先确认目标和当前经验。' }, async interpret() { return { coveredTopics: ['goal_deadline'], dimensions: [{ key: 'engineering', level: 'applied', confidence: 0.8, summary: '用户给出了实践线索', nextValidation: '在场景题中说明取舍' }], evidence: [], supportedPracticeCandidates: [], followUpTopic: null } } }
  return Promise.resolve(test(new AgentPlanningService(repository, provider), repository)).finally(() => repository.close())
}

describe('Planner phased diagnostic flow', () => {
  it('freezes a valid diagnostic, hides rubrics, batches answers idempotently, and reaches ready only after explicit brief confirmation', async () => serviceFor(async (service) => {
    const session = service.createSession('diagnostic-learner', { message: '我要在六个月内提升后端系统设计能力', clientRequestId: 'start' })
    await service.streamMessage('diagnostic-learner', session.id, session.goal, 'start', async () => undefined)
    expect(service.phasedStatus('diagnostic-learner', session.id).stage).toBe('assessment_preparing')
    const assessment = await service.prepareAssessment('diagnostic-learner', session.id, 'assessment-1')
    expect(assessment.dimensions).toHaveLength(4); expect(assessment.questions).toHaveLength(12)
    expect(JSON.stringify(assessment)).not.toContain('referenceAnswer'); expect(JSON.stringify(assessment)).not.toContain('rubric')
    const answers = assessment.questions.map((question) => ({ questionId: question.id, value: question.type === 'single_choice' ? 'new' : question.type === 'multiple_choice' ? ['new'] : '我会说明上下文、取舍和结果。' }))
    service.submitAssessmentAnswers('diagnostic-learner', session.id, assessment.id, answers, 'answer-batch')
    service.submitAssessmentAnswers('diagnostic-learner', session.id, assessment.id, answers, 'answer-batch')
    expect(service.phasedStatus('diagnostic-learner', session.id).assessment?.answerCount).toBe(12)
    const completed = await service.finalizeAssessment('diagnostic-learner', session.id, assessment.id, 'complete', 'finish')
    expect(completed.evaluation).not.toHaveProperty('totalScore')
    const brief = await service.addRequirementsMessage('diagnostic-learner', session.id, '每周投入五小时，优先产出一个可展示的设计案例。', 'requirement-1')
    expect(service.phasedStatus('diagnostic-learner', session.id).readiness.ready).toBe(false)
    service.confirmRequirementBrief('diagnostic-learner', session.id, brief.id)
    expect(service.phasedStatus('diagnostic-learner', session.id).readiness).toMatchObject({ ready: true, stage: 'ready' })
  }))

  it('creates a low-confidence unverified result when abandoned without answers and keeps failures retryable', async () => serviceFor(async (service) => {
    const session = service.createSession('abandon-learner', { message: '我想学习分布式系统', clientRequestId: 'start' })
    await service.streamMessage('abandon-learner', session.id, session.goal, 'start', async () => undefined)
    const assessment = await service.prepareAssessment('abandon-learner', session.id, 'assessment')
    const abandoned = await service.finalizeAssessment('abandon-learner', session.id, assessment.id, 'abandon', 'abandon')
    expect(abandoned.status).toBe('abandoned'); expect(abandoned.evaluation?.dimensions.every((item) => item.confidence <= 0.15)).toBe(true)
  }))

  it('keeps planner invocation records queryable and rejects roadmap-gate state with blockers', async () => serviceFor(async (service, repository) => {
    const session = service.createSession('gate-learner', { message: '学习数据库优化', clientRequestId: 'start' })
    await service.streamMessage('gate-learner', session.id, session.goal, 'start', async () => undefined)
    expect(service.roadmapReadiness('gate-learner', session.id).blockers).toEqual(expect.arrayContaining(['assessment_not_terminal', 'requirements_not_confirmed']))
    expect(repository.db.prepare("SELECT COUNT(*) AS count FROM planning_agent_invocations WHERE kind = 'planner'").get()).toMatchObject({ count: 1 })
    await expect(service.generateRoadmap('gate-learner', session.id, randomUUID(), false, true)).rejects.toMatchObject({ code: 'planning_not_ready' })
  }))
})
