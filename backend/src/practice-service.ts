import { randomUUID } from 'node:crypto'
import type { LabExecutionResult } from './domain.js'
import type { LabScheduler } from './scheduler.js'
import { decideAfterLab, decideAfterMessage, decideAfterVerification } from './coach.js'
import { buildTutorContext } from './context.js'
import { createPlan } from './planner.js'
import type { ProductRepository } from './product-repository.js'
import type { CaseStage, Intake, LabSegment, MemoryItem, PracticeEvent, PracticeHistoryPage, PracticeRun, PracticeSnapshot, SourceItem, TutorInvocation, TutorResponse, TutorSource } from './product-types.js'
import { RetrievalService } from './retrieval.js'
import { TutorEngine, TutorProviderError, tutorResponseFromGenerated } from './tutor.js'
import { getManifest } from './fixtures.js'
import { validateStatement } from './sql-policy.js'
import { LabError } from './errors.js'

export class ProductNotFoundError extends Error {}

export type TutorStreamEvent =
  | { type: 'accepted'; invocationId: string }
  | { type: 'retrieval_started'; invocationId: string }
  | { type: 'sources'; invocationId: string; status: string; items: TutorSource[]; errorCode?: string }
  | { type: 'answer_delta'; invocationId: string; delta: string }
  | { type: 'completed'; invocationId: string; run: PracticeRun; tutor: TutorResponse; snapshot: PracticeSnapshot; sources: TutorSource[] }
  | { type: 'failed'; invocationId: string; code: string; message: string; retryable: boolean }

export interface TutorStreamResult {
  invocation: TutorInvocation
  run: PracticeRun
  tutor?: TutorResponse
  snapshot: PracticeSnapshot
  sources: TutorSource[]
}

function encodeCursor(updatedAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ updatedAt, id }), 'utf8').toString('base64url')
}

function decodeCursor(cursor: string | undefined): { updatedAt: string; id: string } | undefined {
  if (!cursor) return undefined
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { updatedAt?: unknown; id?: unknown }
    if (typeof value.updatedAt !== 'string' || typeof value.id !== 'string') throw new Error('invalid cursor')
    return { updatedAt: value.updatedAt, id: value.id }
  } catch { throw new LabError('invalid_request', '历史记录游标无效', 400) }
}

export class PracticeService {
  private readonly pendingQueues = new Map<string, string>()
  private readonly runLocks = new Map<string, Promise<void>>()

  constructor(private readonly repository: ProductRepository, private readonly scheduler: LabScheduler, private readonly tutor: TutorEngine, private readonly retrieval?: RetrievalService) {}

  private async withRunLock<T>(runId: string, action: () => Promise<T>): Promise<T> {
    const previous = this.runLocks.get(runId) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.runLocks.set(runId, queued)
    await previous
    try { return await action() } finally { release(); if (this.runLocks.get(runId) === queued) this.runLocks.delete(runId) }
  }

  private run(runId: string): PracticeRun {
    try { return this.repository.getPracticeRun(runId) } catch { throw new ProductNotFoundError(`Practice run not found: ${runId}`) }
  }

  assertOwnership(runId: string, learnerId: string): PracticeRun {
    const run = this.run(runId)
    if (run.learnerId !== learnerId) throw new LabError('forbidden', '无权访问该实践记录', 403)
    return run
  }

  history(learnerId: string, cursor?: string, limit = 20): PracticeHistoryPage {
    this.repository.ensureLearner(learnerId)
    const safeLimit = Math.min(Math.max(Math.trunc(limit), 1), 50)
    const records = this.repository.listPracticeHistory(learnerId, { cursor: decodeCursor(cursor), limit: safeLimit })
    const items = records.map(({ run, lastActivityAt, lastTutorProvider, lastTutorSourceStatus }) => ({
      id: run.id, caseId: run.caseId, stage: run.stage, status: run.status, createdAt: run.createdAt, updatedAt: run.updatedAt,
      lastActivityAt, lastTutorProvider, lastTutorSourceStatus,
      labState: run.labRunId ? (this.scheduler.isRunActive(run.labRunId) ? 'active' as const : 'reopen_required' as const) : 'none' as const,
    }))
    const last = records.at(-1)
    return { items, nextCursor: records.length === safeLimit && last ? encodeCursor(last.run.updatedAt, last.run.id) : null }
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
      this.repository.createLabSegment({ practiceRunId: practice.id, labRunId: lab.run.runId, fixtureVersion: lab.run.fixtureVersion })
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
        this.repository.createLabSegment({ practiceRunId: runId, labRunId: ticket.run.runId, fixtureVersion: ticket.run.fixtureVersion })
        this.repository.appendEvent({ learnerId: updated.learnerId, practiceRunId: runId, actor: 'system', type: 'case_presented', stage: updated.stage, payload: { caseId: updated.caseId, fixtureVersion: ticket.run.fixtureVersion, environment: 'mysql_lab', queued: true } })
        this.pendingQueues.delete(runId)
      }
    }
    return this.repository.snapshot(runId)
  }

  labAccess(runId: string): { status: 'waiting' | 'ready' | 'expired' | 'cancelled'; ticketId?: string; run?: unknown; accessToken?: string } {
    const practice = this.run(runId)
    const ticketId = this.pendingQueues.get(runId)
    if (!ticketId) {
      if (!practice.labRunId) return { status: 'expired' }
      const access = this.scheduler.getAccess(practice.labRunId)
      if (access) return { status: 'ready', run: access.run, accessToken: access.accessToken }
      this.repository.finishLabSegment(practice.labRunId, 'scheduler_unavailable_or_expired')
      this.repository.updatePracticeRun(runId, { labRunId: null })
      return { status: 'expired' }
    }
    const ticket = this.scheduler.getTicket(ticketId)
    if (ticket.status === 'ready' && ticket.run) {
      this.snapshot(runId)
      return { status: 'ready', run: ticket.run, accessToken: ticket.run.accessToken }
    }
    return { status: ticket.status === 'expired' || ticket.status === 'cancelled' ? ticket.status : 'waiting', ticketId }
  }

  private async reopenLabUnsafe(runId: string): Promise<{ practice: PracticeRun; lab?: { run: unknown; accessToken: string }; queue?: unknown }> {
    const practice = this.run(runId)
    if (practice.status === 'resolved') throw new LabError('practice_resolved', '该实践已经完成，请从历史中回看', 409)
    if (practice.labRunId && this.scheduler.isRunActive(practice.labRunId)) throw new LabError('lab_already_active', '当前实践已有可用 Lab', 409, true)
    const result = await this.scheduler.createRun(practice.caseId)
    if (result.kind === 'queued') {
      this.pendingQueues.set(runId, result.ticket.ticketId)
      return { practice: this.repository.updatePracticeRun(runId, { labRunId: null }), queue: result.ticket }
    }
    const updated = this.repository.updatePracticeRun(runId, { labRunId: result.run.runId })
    this.repository.createLabSegment({ practiceRunId: runId, labRunId: result.run.runId, fixtureVersion: result.run.fixtureVersion })
    this.repository.appendEvent({ learnerId: updated.learnerId, practiceRunId: runId, actor: 'system', type: 'lab_reopened', stage: updated.stage, payload: { labRunId: result.run.runId, fixtureVersion: result.run.fixtureVersion } })
    return { practice: updated, lab: { run: result.run, accessToken: result.accessToken } }
  }

  async reopenLab(runId: string): Promise<{ practice: PracticeRun; lab?: { run: unknown; accessToken: string }; queue?: unknown }> {
    return this.withRunLock(runId, () => this.reopenLabUnsafe(runId))
  }

  memories(learnerId: string) { this.repository.ensureLearner(learnerId); return this.repository.listMemories(learnerId) }

  updateMemory(learnerId: string, memoryId: string, update: { statement?: string; userNote?: string | null; status?: 'active' | 'corrected' | 'deleted' }) {
    this.repository.ensureLearner(learnerId)
    return this.repository.updateMemory(memoryId, update)
  }

  private queryForTutor(run: PracticeRun, message: string, snapshot: PracticeSnapshot): string {
    const evidenceTerms = snapshot.artifacts.slice(-3).map((artifact) => artifact.content.slice(0, 120)).join(' ')
    return `MySQL ${run.caseId} ${run.stage} ${message.slice(0, 260)} ${evidenceTerms}`.trim().replace(/\s+/g, ' ')
  }

  private shouldRetrieve(message: string, snapshot: PracticeSnapshot): boolean {
    const hasStageSources = snapshot.artifacts.some((artifact) => artifact.kind === 'tutor_reply' && Array.isArray(artifact.metadata.sourceRefs) && artifact.metadata.sourceRefs.length > 0)
    return !hasStageSources || /知乎|来源|依据|文章|经验|原理|官方|参考/.test(message)
  }

  private tutorSources(items: SourceItem[]): TutorSource[] {
    return items.slice(0, 3).map((source) => ({ id: source.id, title: source.title, author: source.author, url: source.url, excerpt: source.excerpt, retrievedAt: source.retrievedAt, provider: source.provider, role: typeof source.metadata.role === 'string' ? source.metadata.role : '相关经验', reason: `用于补充当前阶段的 ${source.title}，不能替代 Lab 实验结论。` }))
  }

  private replayTutor(invocation: TutorInvocation): { tutor: TutorResponse; sources: TutorSource[] } | null {
    const turn = this.repository.findTutorTurnByUserArtifact(invocation.userArtifactId)
    if (!turn?.assistantArtifactId) return null
    const assistant = this.repository.getArtifact(turn.assistantArtifactId)
    const event = this.repository.snapshot(invocation.practiceRunId).events.find((item) => item.type === 'tutor_reply' && item.artifactRefs.includes(assistant.id))
    if (!event) return null
    const payload = event.payload as unknown as TutorResponse
    return { tutor: { ...payload, response: assistant.content, provider: 'model' }, sources: this.tutorSources(this.repository.listSources(invocation.sourceIds)) }
  }

  private async runTutor(input: { runId: string; message: string; clientRequestId: string }, emit?: (event: TutorStreamEvent) => Promise<void> | void): Promise<TutorStreamResult> {
    const run = this.run(input.runId)
    const existing = this.repository.getTutorInvocationByRequest(input.runId, input.clientRequestId)
    if (existing) {
      const replay = existing.status === 'succeeded' ? this.replayTutor(existing) : null
      if (replay) {
        const currentRun = this.repository.getPracticeRun(input.runId)
        const currentSnapshot = this.repository.snapshot(input.runId)
        await emit?.({ type: 'accepted', invocationId: existing.id })
        await emit?.({ type: 'completed', invocationId: existing.id, run: currentRun, tutor: replay.tutor, snapshot: currentSnapshot, sources: replay.sources })
        return { invocation: existing, run: currentRun, tutor: replay.tutor, snapshot: currentSnapshot, sources: replay.sources }
      }
      if (existing.status === 'running') {
        await emit?.({ type: 'accepted', invocationId: existing.id })
        await emit?.({ type: 'failed', invocationId: existing.id, code: 'invocation_in_progress', message: '相同请求正在处理中，请稍后查看结果', retryable: true })
        return { invocation: existing, run, snapshot: this.repository.snapshot(input.runId), sources: [] }
      }
      await emit?.({ type: 'accepted', invocationId: existing.id })
      await emit?.({ type: 'failed', invocationId: existing.id, code: existing.failureCode ?? 'invocation_failed', message: existing.failureMessage ?? '该请求未完成，请使用重试', retryable: true })
      return { invocation: existing, run, snapshot: this.repository.snapshot(input.runId), sources: [] }
    }

    const userArtifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: input.runId, kind: 'user_message', sourceKind: 'user', verificationStatus: 'not_applicable', content: input.message, metadata: { clientRequestId: input.clientRequestId } })
    this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: input.runId, actor: 'user', type: 'user_message', stage: run.stage, payload: { message: input.message }, artifactRefs: [userArtifact.id], clientRequestId: input.clientRequestId })
    const invocation = this.repository.createTutorInvocation({ practiceRunId: input.runId, userArtifactId: userArtifact.id, clientRequestId: input.clientRequestId, provider: this.tutor.providerName, model: this.tutor.configuredModelName })
    await emit?.({ type: 'accepted', invocationId: invocation.id })
    const startedAt = Date.now()
    let sources: SourceItem[] = []
    try {
      const initialSnapshot = this.repository.snapshot(input.runId)
      await emit?.({ type: 'retrieval_started', invocationId: invocation.id })
      const retrieval = this.shouldRetrieve(input.message, initialSnapshot) ? await this.retrieval?.search(this.queryForTutor(run, input.message, initialSnapshot), 5) : { status: 'empty' as const, items: [], fromCache: false }
      const retrievalResult = retrieval ?? { status: 'unavailable' as const, items: [], fromCache: false, errorCode: 'zhihu_retrieval_not_configured' }
      sources = retrievalResult.items
      this.repository.updateTutorInvocation(invocation.id, { status: 'running', retrievalStatus: retrievalResult.status, sourceIds: sources.map((source) => source.id), failureCode: null, failureMessage: null, latencyMs: null })
      await emit?.({ type: 'sources', invocationId: invocation.id, status: retrievalResult.status, items: this.tutorSources(sources), errorCode: retrievalResult.errorCode })
      const contextSnapshot = this.repository.snapshot(input.runId)
      const context = buildTutorContext({ goal: this.goalForRun(run), run, events: contextSnapshot.events, artifacts: contextSnapshot.artifacts, pathNodes: contextSnapshot.pathNodes, stageMemories: contextSnapshot.stageMemories, sourceIds: sources.map((source) => source.id) })
      const generatedResponse = await this.tutor.generate(run, context, input.message, sources, async (delta) => { await emit?.({ type: 'answer_delta', invocationId: invocation.id, delta }) })
      const tutor = tutorResponseFromGenerated(run, context, generatedResponse, sources, retrievalResult.status)
      const assistantArtifact = this.repository.createArtifact({ learnerId: run.learnerId, practiceRunId: input.runId, kind: 'tutor_reply', sourceKind: 'tutor', verificationStatus: 'model_generated', content: tutor.response, metadata: { intent: tutor.intent, sourceRefs: tutor.sourceRefs, invocationId: invocation.id } })
      this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: input.runId, actor: 'tutor', type: 'tutor_reply', stage: run.stage, payload: { ...tutor, provider: 'model' }, artifactRefs: [assistantArtifact.id] })
      this.repository.saveTutorTurn({ practiceRunId: input.runId, userArtifactId: userArtifact.id, assistantArtifactId: assistantArtifact.id, mode: tutor.intent, provider: 'model', sourceStatus: tutor.sourceStatus })
      const decision = decideAfterMessage(run, contextSnapshot.events)
      const nextCount = input.message.trim().length < 12 ? run.noProgressCount + 1 : 0
      const updated = this.repository.updatePracticeRun(input.runId, { stage: decision.nextStage, noProgressCount: nextCount, hintLevel: nextCount >= 3 ? Math.min(3, run.hintLevel + 1) : run.hintLevel })
      this.repository.upsertStageMemory({ practiceRunId: input.runId, stage: updated.stage, memory: { currentGap: tutor.currentGap, latestQuestion: tutor.nextQuestion, hintLevel: updated.hintLevel }, sourceEventRefs: this.repository.listEvents(input.runId).slice(-2).map((event) => event.id) })
      const completedInvocation = this.repository.updateTutorInvocation(invocation.id, { status: 'succeeded', retrievalStatus: retrievalResult.status, sourceIds: sources.map((source) => source.id), latencyMs: Date.now() - startedAt })
      const result = { invocation: completedInvocation, run: updated, tutor, snapshot: this.repository.snapshot(input.runId), sources: this.tutorSources(sources) }
      await emit?.({ type: 'completed', invocationId: completedInvocation.id, run: result.run, tutor, snapshot: result.snapshot, sources: result.sources })
      return result
    } catch (error) {
      const failure = error instanceof TutorProviderError ? error : new TutorProviderError('tutor_failed', error instanceof Error ? error.message : 'Tutor 调用失败')
      const failed = this.repository.updateTutorInvocation(invocation.id, { status: 'failed', retrievalStatus: sources.length > 0 ? 'retrieved' : 'unavailable', sourceIds: sources.map((source) => source.id), failureCode: failure.code, failureMessage: failure.message, latencyMs: Date.now() - startedAt })
      this.repository.appendEvent({ learnerId: run.learnerId, practiceRunId: input.runId, actor: 'tutor', type: 'tutor_failed', stage: run.stage, payload: { invocationId: invocation.id, code: failure.code, retryable: failure.retryable } })
      await emit?.({ type: 'failed', invocationId: failed.id, code: failure.code, message: failure.message, retryable: failure.retryable })
      throw failure
    }
  }

  async streamTutor(input: { runId: string; message: string; clientRequestId: string }, emit: (event: TutorStreamEvent) => Promise<void> | void): Promise<TutorStreamResult> {
    return this.withRunLock(input.runId, () => this.runTutor(input, emit))
  }

  async retryTutor(runId: string, invocationId: string, emit: (event: TutorStreamEvent) => Promise<void> | void): Promise<TutorStreamResult> {
    const invocation = this.repository.getTutorInvocation(invocationId)
    if (invocation.practiceRunId !== runId) throw new LabError('not_found', 'Tutor 调用不存在', 404)
    const message = this.repository.getArtifact(invocation.userArtifactId).content
    return this.streamTutor({ runId, message, clientRequestId: randomUUID() }, emit)
  }

  getTutorInvocation(runId: string, invocationId: string): TutorInvocation {
    const invocation = this.repository.getTutorInvocation(invocationId)
    if (invocation.practiceRunId !== runId) throw new LabError('not_found', 'Tutor 调用不存在', 404)
    return invocation
  }

  async ask(runId: string, message: string, clientRequestId?: string): Promise<{ run: PracticeRun; tutor: TutorResponse; snapshot: PracticeSnapshot }> {
    const result = await this.withRunLock(runId, () => this.runTutor({ runId, message, clientRequestId: clientRequestId ?? randomUUID() }))
    if (!result.tutor) throw new LabError('tutor_unavailable', 'Tutor 暂时不可用，请稍后重试', 503, true)
    return { run: result.run, tutor: result.tutor, snapshot: result.snapshot }
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
