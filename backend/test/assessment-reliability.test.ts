import { mkdtempSync, rmSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { AgentPlanningService, PlanningAgentError, type AssessmentContentGenerationInput, type PlanningProvider } from '../src/agent-planning.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'

function withService<T>(callback: (service: AgentPlanningService, repository: ProductRepository) => Promise<T> | T, providerOverride?: PlanningProvider): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-assessment-reliability-'))
  const database = path.join(directory, 'product.db')
  applyProductMigrations(database)
  const repository = new ProductRepository(database)
  const provider: PlanningProvider = {
    providerName: 'test', modelName: 'test-model',
    async stream(_input, onDelta) { await onDelta('请补充一个真实项目经历。'); return '请补充一个真实项目经历。' },
    async interpret() { return { coveredTopics: ['projects'], dimensions: [{ key: 'engineering', level: 'applied', confidence: 0.8, summary: '有实践线索', nextValidation: '解释设计取舍' }, { key: 'delivery', level: 'exposed', confidence: 0.5, summary: '有交付线索', nextValidation: '补充结果' }], evidence: [{ topicKey: 'projects', sourceType: 'user_message', sourceId: 'message', excerpt: '负责过一个上线服务的设计、交付和复盘。' }], supportedPracticeCandidates: [], followUpTopic: null } },
  }
  const close = () => { try { repository.close() } catch { /* already closed */ } }
  return Promise.resolve(callback(new AgentPlanningService(repository, providerOverride ?? provider), repository)).finally(close)
}

async function completeBaseline(service: AgentPlanningService, learnerId: string, sessionId: string, initialMessage: string, initialRequestId: string): Promise<void> {
  await service.streamMessage(learnerId, sessionId, initialMessage, initialRequestId, async () => undefined)
  await service.streamMessage(learnerId, sessionId, '我负责过真实项目的方案设计、交付和复盘。', 'baseline-2', async () => undefined)
}

function validQuestionContent(input: AssessmentContentGenerationInput): { questions: Array<Record<string, unknown>> } {
  return {
    questions: input.slots.map((slot) => ({
      slotId: slot.id,
      prompt: `请结合真实场景说明你如何处理 ${slot.dimensionKey} 的关键判断（题位 ${slot.position}）。`,
      options: ['single_choice', 'multiple_choice'].includes(slot.type) ? [{ value: 'evidence', label: '先收集证据并定义验证标准' }, { value: 'assume', label: '直接按未经验证的假设推进' }] : [],
      rubric: { criteria: ['回答需要引用具体事实、判断或验证步骤。'], evidenceSignals: ['可观察的证据或取舍'] },
      referenceAnswer: { expected: '仅供内部评估器使用。' },
    })),
  }
}

function baselineProvider(): PlanningProvider {
  return {
    providerName: 'test', modelName: 'test-model',
    async stream(_input, onDelta) { await onDelta('请补充一个真实项目经历。'); return '请补充一个真实项目经历。' },
    async interpret() { return { coveredTopics: ['projects'], dimensions: [{ key: 'engineering', level: 'applied', confidence: 0.8, summary: '有实践线索', nextValidation: '解释设计取舍' }, { key: 'delivery', level: 'exposed', confidence: 0.5, summary: '有交付线索', nextValidation: '补充结果' }], evidence: [{ topicKey: 'projects', sourceType: 'user_message', sourceId: 'message', excerpt: '负责过一个上线服务的设计、交付和复盘。' }], supportedPracticeCandidates: [], followUpTopic: null } },
  }
}

describe('Assessment reliability', () => {
  it('coalesces concurrent assessment opens onto one active assessment without duplicate generations', async () => withService(async (service, repository) => {
    const slowProvider: PlanningProvider = {
      ...baselineProvider(),
      async generateAssessmentContent(input) {
        await new Promise((resolve) => setTimeout(resolve, 40))
        return validQuestionContent(input)
      },
    }
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-assessment-concurrent-'))
    const database = path.join(directory, 'product.db')
    applyProductMigrations(database)
    const repo = new ProductRepository(database)
    try {
      const slow = new AgentPlanningService(repo, slowProvider, { modelName: 'test-model', plannerAssessmentV2Enabled: true })
      const learnerId = 'concurrent-open-learner'
      const session = slow.createSession(learnerId, { message: '我想验证后端系统设计能力', clientRequestId: 'start' })
      await completeBaseline(slow, learnerId, session.id, session.goal, 'start')
      const [first, second] = await Promise.all([
        slow.prepareAssessment(learnerId, session.id, 'open-1'),
        slow.prepareAssessment(learnerId, session.id, 'open-2'),
      ])
      // Both opens resolve to the same assessment row.
      expect(first.id).toBe(second.id)
      await vi.waitFor(() => expect(repo.db.prepare('SELECT status FROM planning_assessments WHERE id = ?').get(first.id)).toMatchObject({ status: 'answering' }))
      expect(repo.db.prepare("SELECT COUNT(*) AS count FROM planning_assessments WHERE session_id = ? AND status IN ('preparing', 'answering')").get(session.id)).toMatchObject({ count: 1 })
      expect(repo.db.prepare("SELECT COUNT(*) AS count FROM planning_agent_invocations WHERE session_id = ? AND kind = 'assessment_generator' AND status = 'succeeded'").get(session.id)).toMatchObject({ count: 1 })
    } finally {
      repo.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }))

  it('keeps the user unblocked and answerable after two consecutive invalid question generations (v2 fallback)', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-assessment-invalid-v2-'))
    const database = path.join(directory, 'product.db')
    applyProductMigrations(database)
    const repository = new ProductRepository(database)
    let contentCalls = 0
    const provider: PlanningProvider = {
      ...baselineProvider(),
      async generateAssessmentContent() {
        contentCalls += 1
        // Structurally invalid every time: no slotId, no reference answer, prompt too short.
        return { questions: [{ prompt: '短', rubric: { criteria: [] } }] }
      },
    }
    try {
      const service = new AgentPlanningService(repository, provider, { modelName: 'test-model', plannerAssessmentV2Enabled: true })
      const learnerId = 'invalid-v2-learner'
      const session = service.createSession(learnerId, { message: '我想提升后端系统设计能力', clientRequestId: 'start' })
      await completeBaseline(service, learnerId, session.id, session.goal, 'start')
      const assessment = await service.prepareAssessment(learnerId, session.id, 'v2-invalid')
      expect(contentCalls).toBeGreaterThanOrEqual(2)
      expect(assessment.status).toBe('answering')
      expect(assessment.questions).toHaveLength(12)
      expect(JSON.stringify(assessment)).not.toContain('referenceAnswer')
      expect(JSON.stringify(assessment)).not.toContain('rubric')
      // Answers remain fully writable after the malformed generation.
      const answers = assessment.questions.map((question) => ({ questionId: question.id, value: question.type === 'single_choice' ? question.options[0]!.value : question.type === 'multiple_choice' ? [question.options[0]!.value] : '我会记录事实、取舍和下一步验证。' }))
      service.submitAssessmentAnswers(learnerId, session.id, assessment.id, answers, 'v2-answers')
      const completed = await service.finalizeAssessment(learnerId, session.id, assessment.id, 'complete', 'v2-finish')
      expect(completed.status).toBe('completed')
      expect(completed.answerCount).toBe(12)
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('surfaces a safe retryable error and preserves the session after two consecutive invalid v1 outputs', async () => withService(async (service, repository) => {
    let generationCalls = 0
    const failingProvider: PlanningProvider = {
      ...baselineProvider(),
      async generateAssessment() {
        generationCalls += 1
        throw new PlanningAgentError('assessment_invalid_output', 'raw model output with secret-token-abc', true, { validationIssues: [{ path: 'questions', code: 'too_small' }] })
      },
    }
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-assessment-invalid-v1-'))
    const database = path.join(directory, 'product.db')
    applyProductMigrations(database)
    const repo = new ProductRepository(database)
    try {
      const service1 = new AgentPlanningService(repo, failingProvider)
      const learnerId = 'invalid-v1-learner'
      const session = service1.createSession(learnerId, { message: '我想学习分布式系统设计', clientRequestId: 'start' })
      await completeBaseline(service1, learnerId, session.id, session.goal, 'start')
      await expect(service1.prepareAssessment(learnerId, session.id, 'invalid-1')).rejects.toMatchObject({ code: 'assessment_invalid_output', retryable: true })
      const failed = service1.phasedStatus(learnerId, session.id).assessment
      expect(failed).toMatchObject({ status: 'failed' })
      expect(failed?.error).toBe('诊断题目生成失败，请重试')
      expect(JSON.stringify(failed)).not.toContain('secret-token-abc')
      // Second invalid generation through the auto-recovery path.
      await expect(service1.recoverFailedAssessment(learnerId, session.id)).rejects.toMatchObject({ code: 'assessment_invalid_output' })
      expect(generationCalls).toBe(2)
      // Session context and messages are never lost by a failed generation.
      expect(service1.getSession(learnerId, session.id).messages.length).toBeGreaterThanOrEqual(2)
      expect(service1.phasedStatus(learnerId, session.id).stage).toBe('assessment_preparing')
    } finally {
      repo.close()
      rmSync(directory, { recursive: true, force: true })
    }
  }))

  it('recovers interrupted preparations and evaluations after a service restart', async () => {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-assessment-restart-'))
    const database = path.join(directory, 'product.db')
    applyProductMigrations(database)
    const repository = new ProductRepository(database)
    const provider: PlanningProvider = { ...baselineProvider(), async generateAssessmentContent(input) { return validQuestionContent(input) } }
    try {
      const first = new AgentPlanningService(repository, provider, { modelName: 'test-model', plannerAssessmentV2Enabled: true })
      const learnerId = 'restart-learner'
      const session = first.createSession(learnerId, { message: '我想提升后端系统设计能力', clientRequestId: 'start' })
      await completeBaseline(first, learnerId, session.id, session.goal, 'start')
      const now = new Date().toISOString()
      // Simulate a crash while the model is generating questions.
      repository.db.prepare("INSERT INTO planning_assessments(id, session_id, learner_id, version, status, direction, model, dimensions_json, client_request_id, created_at, updated_at) VALUES (?, ?, ?, 1, 'preparing', ?, 'test-model', '[]', 'crash-1', ?, ?)").run('crash-assessment', session.id, learnerId, session.goal, now, now)
      repository.db.prepare("UPDATE planning_sessions SET active_assessment_id = 'crash-assessment', stage = 'assessment_preparing', updated_at = ? WHERE id = ?").run(now, session.id)
      repository.db.prepare("INSERT INTO planning_agent_invocations(id, session_id, learner_id, client_request_id, kind, provider, model, status, input_fingerprint, created_at) VALUES (?, ?, ?, 'crash-1', 'assessment_generator', 'test', 'test-model', 'running', 'x', ?)").run('crash-invocation', session.id, learnerId, now)

      // Constructing a new service instance is the restart: the constructor fences stale leases.
      const restarted = new AgentPlanningService(repository, provider, { modelName: 'test-model', plannerAssessmentV2Enabled: true })
      expect(repository.db.prepare('SELECT status, failure_code FROM planning_assessments WHERE id = ?').get('crash-assessment')).toMatchObject({ status: 'failed', failure_code: 'service_restarted' })
      expect(repository.db.prepare('SELECT status FROM planning_agent_invocations WHERE id = ?').get('crash-invocation')).toMatchObject({ status: 'interrupted' })
      expect(restarted.getSession(learnerId, session.id).assessment?.error).toBe('服务重启中断了题目生成，请重试')
      const healed = await restarted.recoverFailedAssessment(learnerId, session.id)
      expect(healed).toMatchObject({ status: 'answering', recoveredFromFailure: true })
      expect(healed?.questions).toHaveLength(12)

      // A crash during evaluation must return the session to answering with answers intact.
      const evaluatingId = randomUUID()
      repository.db.prepare("INSERT INTO planning_assessments(id, session_id, learner_id, version, status, direction, model, dimensions_json, client_request_id, created_at, updated_at) VALUES (?, ?, ?, 3, 'evaluating', ?, 'test-model', '[]', 'eval-crash', ?, ?)").run(evaluatingId, session.id, learnerId, session.goal, now, now)
      repository.db.prepare("UPDATE planning_sessions SET active_assessment_id = ?, stage = 'assessment_evaluating', updated_at = ? WHERE id = ?").run(evaluatingId, now, session.id)
      const again = new AgentPlanningService(repository, provider, { modelName: 'test-model', plannerAssessmentV2Enabled: true })
      expect(repository.db.prepare('SELECT status FROM planning_assessments WHERE id = ?').get(evaluatingId)).toMatchObject({ status: 'answering' })
      expect(again.phasedStatus(learnerId, session.id).stage).toBe('assessment_answering')
    } finally {
      repository.close()
      rmSync(directory, { recursive: true, force: true })
    }
  })

  it('keeps the roadmap gate closed unless assessment, brief, and stage are simultaneously ready', async () => withService(async (service, repository) => {
    const learnerId = 'triple-gate-learner'
    const session = service.createSession(learnerId, { message: '我想系统学习数据库性能优化', clientRequestId: 'start' })
    await completeBaseline(service, learnerId, session.id, session.goal, 'start')
    const assessment = await service.prepareAssessment(learnerId, session.id, 'assessment')
    const answers = assessment.questions.map((question) => ({ questionId: question.id, value: question.type === 'single_choice' ? question.options[0]!.value : question.type === 'multiple_choice' ? [question.options[0]!.value] : '一个可验证的具体回答' }))
    service.submitAssessmentAnswers(learnerId, session.id, assessment.id, answers, 'answers')
    await service.finalizeAssessment(learnerId, session.id, assessment.id, 'complete', 'finish')

    // Assessment terminal but requirements not confirmed -> 409.
    await expect(service.generateRoadmap(learnerId, session.id, randomUUID(), false, true)).rejects.toMatchObject({ code: 'planning_not_ready' })
    const brief = await service.addRequirementsMessage(learnerId, session.id, '每周投入五小时，产出可复现的性能排查案例。', 'requirements')
    service.confirmRequirementBrief(learnerId, session.id, brief.id)
    expect(service.roadmapReadiness(learnerId, session.id).ready).toBe(true)

    // Stage forced away from ready while assessment + brief are confirmed -> 409 with stage blocker.
    repository.db.prepare("UPDATE planning_sessions SET stage = 'generating', updated_at = ? WHERE id = ?").run(new Date().toISOString(), session.id)
    await expect(service.generateRoadmap(learnerId, session.id, randomUUID(), false, true)).rejects.toMatchObject({ code: 'planning_not_ready' })
    expect(service.roadmapReadiness(learnerId, session.id).blockers).toContain('stage_not_ready')
  }))

  it('never exposes reference answers, rubrics, per-question scores, or raw errors before the assessment is terminal', async () => withService(async (service, repository) => {
    const learnerId = 'dto-audit-learner'
    const session = service.createSession(learnerId, { message: '我想提升 Python 后端能力', clientRequestId: 'start' })
    await completeBaseline(service, learnerId, session.id, session.goal, 'start')
    const assessment = await service.prepareAssessment(learnerId, session.id, 'assessment')
    const serialized = JSON.stringify(assessment)
    expect(serialized).not.toContain('referenceAnswer')
    expect(serialized).not.toContain('rubric')
    expect(serialized).not.toContain('questionResults')
    expect(assessment.evaluation).toBeNull()
    expect(assessment.summary).toBeNull()
    const submitted = service.submitAssessmentAnswers(learnerId, session.id, assessment.id, [{ questionId: assessment.questions[0]!.id, value: assessment.questions[0]!.options[0]?.value ?? '文本' }], 'batch-1')
    expect(JSON.stringify(submitted)).not.toContain('referenceAnswer')
    expect(JSON.stringify(submitted)).not.toContain('rubric')
    expect(JSON.stringify(submitted)).not.toContain('questionResults')
    expect(submitted.evaluation).toBeNull()
    expect(submitted.summary).toBeNull()
  }))
})
