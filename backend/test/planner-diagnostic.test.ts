import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { AgentPlanningService, type PlanningProvider } from '../src/agent-planning.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

function serviceFor(test: (service: AgentPlanningService, repository: ProductRepository) => Promise<void> | void): Promise<void> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-diagnostic-')); const database = path.join(directory, 'product.db'); applyProductMigrations(database); const repository = new ProductRepository(database)
  const provider: PlanningProvider = { providerName: 'test', modelName: 'test-model', async stream(_input, onDelta) { await onDelta('我先确认目标和当前经验。'); return '我先确认目标和当前经验。' }, async interpret() { return { coveredTopics: ['goal_deadline', 'projects'], dimensions: [{ key: 'engineering', level: 'applied', confidence: 0.8, summary: '用户给出了实践线索', nextValidation: '在场景题中说明取舍' }, { key: 'delivery', level: 'exposed', confidence: 0.5, summary: '用户给出了交付线索', nextValidation: '补充真实项目结果' }], evidence: [{ topicKey: 'projects', sourceType: 'user_message', sourceId: 'message', excerpt: '负责一个真实服务的设计与交付。' }], supportedPracticeCandidates: [], followUpTopic: null } } }
  return Promise.resolve(test(new AgentPlanningService(repository, provider), repository)).finally(() => repository.close())
}

async function completeBaseline(service: AgentPlanningService, learnerId: string, sessionId: string, initialMessage: string, initialRequestId: string): Promise<void> {
  await service.streamMessage(learnerId, sessionId, initialMessage, initialRequestId, async () => undefined)
  await service.streamMessage(learnerId, sessionId, '我负责过真实项目的方案设计、交付和复盘。', 'baseline-2', async () => undefined)
}

describe('Planner phased diagnostic flow', () => {
  it('keeps the baseline open for at least two turns and advances no later than turn six', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-diagnostic-baseline-'))
    const database = path.join(directory, 'product.db')
    applyProductMigrations(database)
    const repository = new ProductRepository(database)
    const provider: PlanningProvider = {
      providerName: 'limited-evidence', modelName: 'test-model',
      async stream(_input, onDelta) { await onDelta('请补充一个最重要的能力证据。'); return '请补充一个最重要的能力证据。' },
      async interpret() { return { coveredTopics: [], dimensions: [], evidence: [], supportedPracticeCandidates: [], followUpTopic: null } },
    }
    try {
      const service = new AgentPlanningService(repository, provider)
      const learnerId = 'baseline-learner'
      const session = service.createSession(learnerId, { message: '我想学习后端架构设计', clientRequestId: 'baseline-start' })
      await service.streamMessage(learnerId, session.id, session.goal, 'baseline-start', async () => undefined)
      expect(service.phasedStatus(learnerId, session.id)).toMatchObject({ baselineTurns: 1, stage: 'baseline' })
      for (let turn = 2; turn <= 6; turn += 1) {
        await service.streamMessage(learnerId, session.id, `第 ${turn} 轮补充信息`, `baseline-${turn}`, async () => undefined)
      }
      expect(service.phasedStatus(learnerId, session.id)).toMatchObject({ baselineTurns: 6, stage: 'assessment_preparing' })
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('uses server-owned slots, preserves valid model content, repairs once, and fills malformed remainder deterministically', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-diagnostic-v2-'))
    const database = path.join(directory, 'product.db')
    applyProductMigrations(database)
    const repository = new ProductRepository(database)
    const contentCalls: Array<{ repair?: { invalidSlotIds: string[] } }> = []
    const provider: PlanningProvider = {
      providerName: 'malformed-model', modelName: 'test-model',
      async stream(_input, onDelta) { await onDelta('请补充一个真实项目经历。'); return '请补充一个真实项目经历。' },
      async interpret() { return { coveredTopics: ['projects'], dimensions: [{ key: 'foundations', level: 'applied', confidence: 0.7, summary: '有概念证据', nextValidation: '解释边界' }, { key: 'experience', level: 'exposed', confidence: 0.5, summary: '有项目证据', nextValidation: '补充结果' }], evidence: [{ topicKey: 'projects', sourceType: 'user_message', sourceId: 'message', excerpt: '负责过一个上线服务并复盘结果。' }], supportedPracticeCandidates: [], followUpTopic: null } },
      async generateAssessmentContent(input) {
        contentCalls.push({ repair: input.repair })
        if (input.repair) return { questions: [{ slotId: input.repair.invalidSlotIds[0], prompt: '短', rubric: {} }] }
        return { questions: [{ slotId: input.slots[0]!.id, prompt: '请说明你如何在实际任务中确认关键概念的边界与适用条件。', options: [{ value: 'evidence', label: '结合证据确认' }, { value: 'guess', label: '直接猜测' }], rubric: { criteria: ['说明判断依据'] }, referenceAnswer: { expected: 'evidence' } }, { slotId: input.slots[1]!.id, prompt: '短', rubric: {} }] }
      },
      async evaluateAssessment() { return { malformed: true } as never },
    }
    try {
      const service = new AgentPlanningService(repository, provider, { modelName: 'test-model', plannerAssessmentV2Enabled: true })
      const learnerId = 'v2-learner'
      const session = service.createSession(learnerId, { message: '我想提升后端系统设计能力', clientRequestId: 'start' })
      await completeBaseline(service, learnerId, session.id, session.goal, 'start')
      const assessment = await service.prepareAssessment(learnerId, session.id, 'v2-assessment')
      expect(assessment.questions).toHaveLength(12)
      expect(assessment.dimensions).toHaveLength(4)
      expect(assessment.questions[0]?.prompt).toContain('确认关键概念')
      expect(contentCalls).toHaveLength(2)
      expect(contentCalls[1]?.repair?.invalidSlotIds.length).toBe(11)
      expect(JSON.stringify(assessment)).not.toContain('referenceAnswer')
      expect(JSON.stringify(assessment)).not.toContain('rubric')

      const answers = assessment.questions.map((question) => ({ questionId: question.id, value: question.type === 'single_choice' ? question.options[0]!.value : question.type === 'multiple_choice' ? [question.options[0]!.value] : '我会记录事实、取舍和下一步验证。' }))
      service.submitAssessmentAnswers(learnerId, session.id, assessment.id, answers, 'v2-answers')
      const completed = await service.finalizeAssessment(learnerId, session.id, assessment.id, 'complete', 'v2-finish')
      expect(completed.status).toBe('completed')
      expect(completed.evaluation?.dimensions.every((dimension) => dimension.confidence <= 0.45)).toBe(true)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('freezes a valid diagnostic, hides rubrics, batches answers idempotently, and reaches ready only after explicit brief confirmation', async () => serviceFor(async (service, repository) => {
    const session = service.createSession('diagnostic-learner', { message: '我要在六个月内提升后端系统设计能力', clientRequestId: 'start' })
    await completeBaseline(service, 'diagnostic-learner', session.id, session.goal, 'start')
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
    await completeBaseline(service, 'abandon-learner', session.id, session.goal, 'start')
    const assessment = await service.prepareAssessment('abandon-learner', session.id, 'assessment')
    const abandoned = await service.finalizeAssessment('abandon-learner', session.id, assessment.id, 'abandon', 'abandon')
    expect(abandoned.status).toBe('abandoned'); expect(abandoned.evaluation?.dimensions.every((item) => item.confidence <= 0.15)).toBe(true)
  }))

  it('keeps planner invocation records queryable and rejects roadmap-gate state with blockers', async () => serviceFor(async (service, repository) => {
    const session = service.createSession('gate-learner', { message: '学习数据库优化', clientRequestId: 'start' })
    await completeBaseline(service, 'gate-learner', session.id, session.goal, 'start')
    expect(service.roadmapReadiness('gate-learner', session.id).blockers).toEqual(expect.arrayContaining(['assessment_not_terminal', 'requirements_not_confirmed']))
    expect(repository.db.prepare("SELECT COUNT(*) AS count FROM planning_agent_invocations WHERE kind = 'planner'").get()).toMatchObject({ count: 2 })
    await expect(service.generateRoadmap('gate-learner', session.id, randomUUID(), false, true)).rejects.toMatchObject({ code: 'planning_not_ready' })
  }))

  it('restores saved and skipped answers without exposing private scoring data, then reveals review only after finalization', async () => serviceFor(async (service) => {
    const learnerId = 'resume-assessment-learner'; const session = service.createSession(learnerId, { message: '我想验证自己的 Python 后端水平', clientRequestId: 'start' })
    await completeBaseline(service, learnerId, session.id, session.goal, 'start')
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
    await completeBaseline(service, learnerId, created.id, created.goal, 'start')
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
