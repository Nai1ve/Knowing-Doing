import { randomUUID } from 'node:crypto'
import type { LabExecutionResult } from './domain.js'
import type { LabScheduler } from './scheduler.js'
import { decideAfterLab, decideAfterMessage, decideAfterVerification } from './coach.js'
import { buildTutorContext } from './context.js'
import { createPlan } from './planner.js'
import type { ProductRepository } from './product-repository.js'
import type { CaseStage, Intake, PracticeRun, PracticeSnapshot, TutorResponse } from './product-types.js'
import { TutorEngine } from './tutor.js'
import { getManifest } from './fixtures.js'
import { validateStatement } from './sql-policy.js'
import { LabError } from './errors.js'

export class ProductNotFoundError extends Error {}

export class PracticeService {
  private readonly pendingQueues = new Map<string, string>()

  constructor(private readonly repository: ProductRepository, private readonly scheduler: LabScheduler, private readonly tutor: TutorEngine) {}

  private run(runId: string): PracticeRun {
    try { return this.repository.getPracticeRun(runId) } catch { throw new ProductNotFoundError(`Practice run not found: ${runId}`) }
  }

  createIntake(input: { learnerId: string; goal: string; technology?: string; outcome?: string | null; weeklyMinutes?: number | null }): Intake {
    this.repository.ensureLearner(input.learnerId)
    return this.repository.createIntake({ ...input, technology: input.technology?.trim() || this.inferTechnology(input.goal) })
  }

  getIntake(id: string): Intake { try { return this.repository.getIntake(id) } catch { throw new ProductNotFoundError(`Intake not found: ${id}`) } }

  draftPlan(intakeId: string) { return createPlan(this.repository, this.getIntake(intakeId)) }

  confirmPlan(planId: string) { return this.repository.confirmPlan(planId) }

  async startPractice(input: { learnerId: string; planUnitId?: string | null; caseId: PracticeRun['caseId'] }) {
    this.repository.ensureLearner(input.learnerId)
    const lab = await this.scheduler.createRun(input.caseId)
    if (lab.kind === 'queued') {
      try {
        const practice = this.repository.createPracticeRun({ ...input })
        this.pendingQueues.set(practice.id, lab.ticket.ticketId)
        return { practice, queue: lab.ticket }
      } catch (error) {
        this.scheduler.cancelTicket(lab.ticket.ticketId)
        throw error
      }
    }
    try {
      const practice = this.repository.createPracticeRun({ ...input, labRunId: lab.run.runId })
      this.repository.appendEvent({ learnerId: input.learnerId, practiceRunId: practice.id, actor: 'system', type: 'case_presented', stage: 'observe', payload: { caseId: input.caseId, fixtureVersion: lab.run.fixtureVersion, environment: 'mysql_lab' } })
      return { practice: this.repository.getPracticeRun(practice.id), lab: { run: lab.run, accessToken: lab.accessToken } }
    } catch (error) {
      await this.scheduler.release(lab.run.runId, lab.accessToken).catch(() => undefined)
      throw error
    }
  }

  snapshot(runId: string): PracticeSnapshot {
    const run = this.run(runId)
    const ticketId = this.pendingQueues.get(runId)
    if (ticketId) {
      const ticket = this.scheduler.getTicket(ticketId)
      if (ticket.status === 'ready' && ticket.run) {
        const updated = this.repository.updatePracticeRun(runId, { labRunId: ticket.run.runId })
        this.repository.appendEvent({ learnerId: updated.learnerId, practiceRunId: runId, actor: 'system', type: 'case_presented', stage: updated.stage, payload: { caseId: updated.caseId, fixtureVersion: ticket.run.fixtureVersion, environment: 'mysql_lab', queued: true } })
        this.pendingQueues.delete(runId)
      }
    }
    return this.repository.snapshot(runId)
  }

  labAccess(runId: string): { status: 'waiting' | 'ready' | 'expired' | 'cancelled'; ticketId?: string; run?: unknown; accessToken?: string } {
    const practice = this.run(runId)
    const ticketId = this.pendingQueues.get(runId)
    if (!ticketId) return practice.labRunId ? { status: 'ready' } : { status: 'waiting' }
    const ticket = this.scheduler.getTicket(ticketId)
    if (ticket.status === 'ready' && ticket.run) {
      this.snapshot(runId)
      return { status: 'ready', run: ticket.run, accessToken: ticket.run.accessToken }
    }
    return { status: ticket.status === 'expired' || ticket.status === 'cancelled' ? ticket.status : 'waiting', ticketId }
  }

  memories(learnerId: string) { this.repository.ensureLearner(learnerId); return this.repository.listMemories(learnerId) }

  updateMemory(learnerId: string, memoryId: string, update: { statement?: string; userNote?: string | null; status?: 'active' | 'corrected' | 'deleted' }) {
    this.repository.ensureLearner(learnerId)
    return this.repository.updateMemory(memoryId, update)
  }

  async ask(runId: string, message: string, clientRequestId?: string): Promise<{ run: PracticeRun; tutor: TutorResponse; snapshot: PracticeSnapshot }> {
    const run = this.run(runId); const snapshot = this.repository.snapshot(runId); const requestId = clientRequestId ?? randomUUID()
    const userArtifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: message, metadata: { clientRequestId: requestId } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'user', type: 'user_message', stage: run.stage, payload: { message }, artifactRefs: [userArtifact.id], clientRequestId: requestId })
    const nextSnapshot = this.repository.snapshot(runId)
    const tutor = await this.tutor.respond(run, buildTutorContext({ goal: this.goalForRun(run), run, events: nextSnapshot.events, artifacts: nextSnapshot.artifacts, pathNodes: nextSnapshot.pathNodes, stageMemories: nextSnapshot.stageMemories, sourceIds: this.repository.listSources().map((source) => source.id) }), message)
    const assistantArtifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: 'tutor_reply', sourceKind: 'tutor', verificationStatus: 'model_generated', content: tutor.response, metadata: { intent: tutor.intent, sourceRefs: tutor.sourceRefs } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'tutor', type: 'tutor_reply', stage: run.stage, payload: { ...tutor, provider: tutor.provider }, artifactRefs: [assistantArtifact.id] })
    this.repository.saveTutorTurn({ practiceRunId: runId, userArtifactId: userArtifact.id, assistantArtifactId: assistantArtifact.id, mode: tutor.intent, provider: tutor.provider, sourceStatus: tutor.sourceStatus })
    const decision = decideAfterMessage(run, nextSnapshot.events)
    const nextCount = message.trim().length < 12 ? run.noProgressCount + 1 : 0
    const updated = this.repository.updatePracticeRun(runId, { stage: decision.nextStage, noProgressCount: nextCount, hintLevel: nextCount >= 3 ? Math.min(3, run.hintLevel + 1) : run.hintLevel })
    this.repository.upsertStageMemory({ practiceRunId: runId, stage: updated.stage, memory: { currentGap: tutor.currentGap, latestQuestion: tutor.nextQuestion, hintLevel: updated.hintLevel }, sourceEventRefs: this.repository.listEvents(runId).slice(-2).map((event) => event.id) })
    return { run: updated, tutor, snapshot: this.repository.snapshot(runId) }
  }

  async executeLab(input: { runId: string; token: string; revision: number; sessionId: string; statement: string; clientRequestId: string }): Promise<{ execution: LabExecutionResult; run: PracticeRun; snapshot: PracticeSnapshot }> {
    const run = this.run(input.runId)
    if (!run.labRunId) throw new LabError('lab_run_not_ready', '当前实践尚未获得可执行的 Lab 运行', 409, true)
    validateStatement(input.statement, getManifest(run.caseId))
    const existingEvidence = this.repository.findEventByClientRequestId(run.id, `${input.clientRequestId}:evidence`)
    if (existingEvidence) {
      const evidenceId = existingEvidence.artifactRefs[0]
      const previous = evidenceId ? this.repository.getArtifact(evidenceId).metadata.execution : undefined
      if (previous && typeof previous === 'object') return { execution: previous as LabExecutionResult, run, snapshot: this.repository.snapshot(run.id) }
    }
    const execution = await this.scheduler.execute(run.labRunId, input.token, input.revision, input.sessionId, input.statement, input.clientRequestId)
    const outputKind = execution.status === 'succeeded' && /\bEXPLAIN\b/i.test(execution.statement) ? 'explain' : execution.status === 'succeeded' && execution.result?.kind === 'result_set' ? 'result_set' : execution.status === 'succeeded' ? 'sql' : 'error'
    const executionMetadata = { execution }
    const statementArtifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: 'sql', sourceKind: 'lab', verificationStatus: 'verified_lab', content: execution.statement, metadata: { ...executionMetadata, executionId: execution.executionId, revision: execution.revision, status: execution.status } })
    const outputArtifact = outputKind === 'sql' ? statementArtifact : this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: run.id, kind: outputKind, sourceKind: 'lab', verificationStatus: 'verified_lab', content: execution.result?.rawOutput ?? execution.error?.message ?? '', metadata: { ...executionMetadata, executionId: execution.executionId, statement: execution.statement, revision: execution.revision, status: execution.status } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'user', type: 'attempt_submitted', stage: run.stage, payload: { statement: execution.statement }, artifactRefs: [statementArtifact.id], clientRequestId: `${input.clientRequestId}:attempt` })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'lab', type: 'evidence_captured', stage: run.stage, payload: { artifactKind: outputKind, executionId: execution.executionId, status: execution.status }, artifactRefs: [outputArtifact.id, statementArtifact.id], clientRequestId: `${input.clientRequestId}:evidence` })
    const currentSnapshot = this.repository.snapshot(run.id)
    const decision = decideAfterLab(run, currentSnapshot.events, execution, outputKind)
    const updated = this.repository.updatePracticeRun(run.id, { stage: decision.nextStage })
    if (updated.stage !== run.stage) this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: run.id, actor: 'rule', type: 'stage_transitioned', stage: updated.stage, payload: { from: run.stage, to: updated.stage, reason: decision.reason } })
    this.repository.createPathNode({ practiceRunId: run.id, stage: updated.stage, title: decision.reason, judgment: decision.judgmentChange ?? '记录一次新的实验结果。', outcome: execution.status, judgmentChange: decision.judgmentChange, nextGap: decision.nextGap, importance: 'high', eventRefs: this.repository.listEvents(run.id).slice(-3).map((event) => event.id), artifactRefs: [outputArtifact.id, statementArtifact.id] })
    this.repository.upsertStageMemory({ practiceRunId: run.id, stage: updated.stage, memory: { currentGap: decision.nextGap, lastExecutionId: execution.executionId, lastArtifactId: outputArtifact.id }, sourceEventRefs: this.repository.listEvents(run.id).slice(-3).map((event) => event.id) })
    return { execution, run: updated, snapshot: this.repository.snapshot(run.id) }
  }

  addExternalArtifact(runId: string, input: { kind?: 'external_text' | 'source_excerpt'; content: string; sourceKind?: 'user' | 'zhihu' | 'global_search'; metadata?: Record<string, unknown> }) {
    const run = this.run(runId)
    const artifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: input.kind ?? 'external_text', sourceKind: input.sourceKind ?? 'user', verificationStatus: input.sourceKind === 'zhihu' ? 'source_verified' : 'external_unverified', content: input.content, metadata: input.metadata })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'user', type: 'artifact_added', stage: run.stage, payload: { verificationStatus: artifact.verificationStatus, kind: artifact.kind }, artifactRefs: [artifact.id] })
    return artifact
  }

  verify(runId: string) {
    const run = this.run(runId); const snapshot = this.repository.snapshot(runId)
    const kinds = new Set(snapshot.artifacts.filter((artifact) => artifact.verificationStatus === 'verified_lab').map((artifact) => artifact.kind))
    const decision = decideAfterVerification(run, snapshot.events, kinds.has('explain') && kinds.has('sql') && kinds.has('result_set'))
    const updated = this.repository.updatePracticeRun(runId, { stage: decision.nextStage, status: decision.outcome === 'resolved' ? 'resolved' : run.status })
    if (updated.stage !== run.stage) this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'rule', type: 'stage_transitioned', stage: updated.stage, payload: { from: run.stage, to: updated.stage, reason: decision.reason } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'rule', type: 'attempt_reviewed', stage: updated.stage, payload: { outcome: decision.outcome, reason: decision.reason, nextGap: decision.nextGap } })
    if (decision.outcome === 'resolved') this.repository.upsertMemory({ learnerId: run.learnerId, category: 'capability', topic: 'mysql-query-optimization', status: 'active', statement: '能够基于执行计划、SQL 尝试和结果集证据验证一次 MySQL 查询优化。', scope: run.caseId, confidence: 0.7, evidenceRefs: snapshot.artifacts.filter((artifact) => artifact.verificationStatus === 'verified_lab').map((artifact) => artifact.id), userNote: null })
    return { run: updated, decision, snapshot: this.repository.snapshot(runId) }
  }

  generateNoteOutline(runId: string) {
    const run = this.run(runId); const snapshot = this.repository.snapshot(runId)
    const evidence = snapshot.artifacts.filter((artifact) => artifact.verificationStatus === 'verified_lab' || artifact.verificationStatus === 'external_unverified')
    const outline = [
      '# MySQL 工程问题复盘',
      '',
      '## 1. 问题与约束',
      `- 案例：${run.caseId}`,
      '- 待补：症状、业务语义和环境边界。',
      '',
      '## 2. 采取过的判断',
      ...snapshot.pathNodes.map((node) => `- ${node.judgment}${node.judgmentChange ? `（变化：${node.judgmentChange}）` : ''}`),
      (snapshot.pathNodes.length ? '' : '- 待补：用户假设和关键判断转折。'),
      '',
      '## 3. 执行与证据',
      ...evidence.map((artifact) => `- [${artifact.verificationStatus}] ${artifact.kind} · evidence:${artifact.id}`),
      (evidence.length ? '' : '- 待补：SQL、EXPLAIN、基准和结果集校验。'),
      '',
      '## 4. 失败尝试',
      '- 待补：尝试内容、不足之处和由此排除的方向。',
      '',
      '## 5. 最终方案与残余风险',
      `- 当前实践状态：${run.status}；只有 Lab 证据通过验证后才能写成“已解决”。`,
      '- 待补：根因、修复、索引代价、数据分布和后续风险。',
    ].join('\n')
    const artifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: 'note_outline', sourceKind: 'system', verificationStatus: 'model_generated', content: outline, metadata: { generationMethod: 'evidence_template', eventRefs: snapshot.events.map((event) => event.id), artifactRefs: evidence.map((item) => item.id), editable: true } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'system', type: 'note_outline_generated', stage: run.stage, payload: { artifactId: artifact.id, generationMethod: 'evidence_template' }, artifactRefs: [artifact.id] })
    return { artifact, snapshot: this.repository.snapshot(runId) }
  }

  generateArticleDraft(runId: string, outline?: string) {
    const run = this.run(runId); const snapshot = this.repository.snapshot(runId)
    const sourceLines = snapshot.artifacts.filter((artifact) => artifact.kind === 'explain' || artifact.kind === 'result_set' || artifact.kind === 'benchmark').map((artifact) => `- ${artifact.kind}: evidence:${artifact.id}`)
    const article = [
      `# 一次 MySQL ${run.caseId.includes('order-list') ? '慢查询' : '工程问题'} 的证据化排查`,
      '',
      '## 背景',
      '这篇文章来自知行的一次受控实验。文中的实验结果只代表当前固定数据与环境，不等同于生产环境承诺。',
      '',
      '## 我的判断路径',
      outline?.trim() || snapshot.pathNodes.map((node) => node.judgment).join('\n') || '待补：从症状到假设，再到验证。',
      '',
      '## 实验与证据',
      sourceLines.length ? sourceLines.join('\n') : '待补：请先完成 EXPLAIN、基准和结果集验证。',
      '',
      '## 结论与边界',
      '当前初稿仍需人工核对 SQL、结果集、环境标签和来源。删除或修改证据后，相关断言必须重新确认。',
      '',
      '## 来源与证据索引',
      sourceLines.length ? sourceLines.join('\n') : '- 暂无已记录的实验型证据。',
    ].join('\n')
    const artifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: runId, kind: 'article_draft', sourceKind: 'system', verificationStatus: 'model_generated', content: article, metadata: { generationMethod: 'evidence_template', editable: true, reviewStatus: 'needs_human_review' } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: runId, actor: 'system', type: 'article_draft_generated', stage: run.stage, payload: { artifactId: artifact.id, reviewStatus: 'needs_human_review' }, artifactRefs: [artifact.id] })
    return { artifact, snapshot: this.repository.snapshot(runId) }
  }

  private goalForRun(run: PracticeRun): string { return run.caseId === 'mysql-order-list-index-001' ? '学习 MySQL 慢查询优化' : `学习 ${run.caseId}` }
  private inferTechnology(goal: string): string { return /k8s|kubernetes/i.test(goal) ? 'Kubernetes' : /redis/i.test(goal) ? 'Redis' : /kafka/i.test(goal) ? 'Kafka' : 'MySQL 8' }
}
