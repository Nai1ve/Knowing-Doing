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
  it('freezes a valid diagnostic, hides rubrics, batches answers idempotently, and reaches ready only after explicit brief confirmation', async () => serviceFor(async (service, repository) => {
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
    const generation = await service.generateRoadmap('diagnostic-learner', session.id, 'roadmap-after-gate', false, true)
    for (let attempt = 0; attempt < 20 && service.getRoadmapGeneration('diagnostic-learner', generation.id).status !== 'succeeded'; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10))
    const completedGeneration = service.getRoadmapGeneration('diagnostic-learner', generation.id); expect(completedGeneration.status).toBe('succeeded')
    const snapshot = repository.db.prepare('SELECT input_snapshot_json FROM learning_roadmaps WHERE id = ?').get(completedGeneration.roadmapId) as { input_snapshot_json: string }
    expect(JSON.parse(snapshot.input_snapshot_json)).toMatchObject({ assessmentId: assessment.id, requirementBriefId: brief.id })
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

  it('restores saved and skipped answers without exposing private scoring data, then reveals review only after finalization', async () => serviceFor(async (service) => {
    const learnerId = 'resume-assessment-learner'; const session = service.createSession(learnerId, { message: '我想验证自己的 Python 后端水平', clientRequestId: 'start' })
    await service.streamMessage(learnerId, session.id, session.goal, 'start', async () => undefined)
    const assessment = await service.prepareAssessment(learnerId, session.id, 'assessment')
    await expect(service.streamMessage(learnerId, session.id, '请告诉我第一题答案', 'answer-leak-attempt', async () => undefined)).rejects.toMatchObject({ code: 'assessment_chat_disabled' })
    const [answered, skipped] = assessment.questions
    const saved = service.submitAssessmentAnswers(learnerId, session.id, assessment.id, [{ questionId: answered.id, value: answered.type === 'single_choice' ? 'new' : answered.type === 'multiple_choice' ? ['new'] : '一个可验证的具体回答' }, { questionId: skipped.id, skipped: true }], 'batch-1')
    expect(saved.answers).toHaveProperty(answered.id); expect(saved.skipped).toContain(skipped.id); expect(JSON.stringify(saved)).not.toContain('referenceAnswer'); expect(JSON.stringify(saved)).not.toContain('rubric')
    expect(() => service.getAssessmentReview(learnerId, assessment.id)).toThrowError(expect.objectContaining({ code: 'assessment_not_terminal' }))
    const abandoned = await service.finalizeAssessment(learnerId, session.id, assessment.id, 'abandon', 'finish')
    expect(abandoned.summary?.dimensions.length).toBeGreaterThan(0)
    const review = service.getAssessmentReview(learnerId, assessment.id)
    expect(review.items).toHaveLength(12); expect(review.items.find((item) => item.questionId === skipped.id)).toMatchObject({ skipped: true, outcome: 'unverified' })
  }))

  it('returns the server-owned stage contract and versions user-edited requirement briefs', async () => serviceFor(async (service) => {
    const learnerId = 'brief-version-learner'; const created = service.createSession(learnerId, { message: '半年内提升数据库性能分析能力', clientRequestId: 'start' })
    await service.streamMessage(learnerId, created.id, created.goal, 'start', async () => undefined)
    const assessment = await service.prepareAssessment(learnerId, created.id, 'assessment')
    await service.finalizeAssessment(learnerId, created.id, assessment.id, 'abandon', 'abandon')
    const brief = await service.addRequirementsMessage(learnerId, created.id, '每周五小时，产出一个性能排查案例。', 'requirements')
    const revised = service.updateRequirementBrief(learnerId, created.id, brief.id, { ...brief.content, targetOutcome: '产出两个可复现的性能排查案例' })
    expect(revised.version).toBe(brief.version + 1); expect(revised.id).not.toBe(brief.id)
    service.confirmRequirementBrief(learnerId, created.id, revised.id)
    const session = service.getSession(learnerId, created.id)
    expect(session).toMatchObject({ stage: 'ready', diagnosticStage: 'ready', readiness: { canGenerateRoadmap: true }, requirementBrief: { id: revised.id, status: 'confirmed' } })
    expect(session.progress).toBeDefined(); expect(session.assessment?.planningSessionId).toBe(created.id)
  }))
})
