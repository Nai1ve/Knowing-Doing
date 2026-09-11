import { createHash, randomUUID } from 'node:crypto'
import type { CaseManifest, QueueTicketView, RunView } from './domain.js'
import { LabError } from './errors.js'
import type { LearningCase, MySqlExerciseRequest, PracticeRun } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import { parseMySqlExerciseRequest } from './mysql-case-interpreter.js'
import { mysqlRequestForProfile } from './mysql-case-interpreter.js'
import { MySqlCaseMaterializationService } from './mysql-case-materialization-service.js'
import type { LabScheduler } from './scheduler.js'
import { PracticeEnvironmentCatalog } from './practice-environment-catalog.js'
import type { DynamicRuntimeStatus } from './planning-types.js'
import type { LabConfig, } from './config.js'
import { MySqlExerciseAgent, type MySqlExerciseCardContext } from './mysql-exercise-agent.js'

type Row = Record<string, unknown>
const text = (row: Row, key: string) => String(row[key])
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export class MySqlDynamicCaseService {
  private readonly materializations: MySqlCaseMaterializationService
  private readonly environments: PracticeEnvironmentCatalog
  private readonly locks = new Map<string, Promise<void>>()
  private readonly agent: MySqlExerciseAgent

  constructor(private readonly repository: ProductRepository, private readonly scheduler: LabScheduler, config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'> = { modelBaseUrl: '', modelApiKey: '', modelName: 'unconfigured', modelTimeoutMs: 30_000 }) {
    this.materializations = new MySqlCaseMaterializationService(repository)
    this.environments = new PracticeEnvironmentCatalog(repository.db)
    this.agent = new MySqlExerciseAgent(config)
  }

  private log(stage: string, details: Record<string, unknown>): void {
    console.info('[zhixing-mysql-case]', stage, details)
  }

  private async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(key) ?? Promise.resolve()
    let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve })
    const queued = previous.then(() => current)
    this.locks.set(key, queued)
    await previous
    try { return await action() } finally { release(); if (this.locks.get(key) === queued) this.locks.delete(key) }
  }

  async createCase(learnerId: string, input: { roadmapNodeId: string; request?: unknown; profileKey?: string; card?: MySqlExerciseCardContext; clientRequestId: string }): Promise<{ case: LearningCase; materialization: ReturnType<MySqlCaseMaterializationService['materialize']> }> {
    this.repository.ensureLearner(learnerId)
    const request = input.profileKey ? mysqlRequestForProfile(input.profileKey) : parseMySqlExerciseRequest(input.request)
    const fingerprint = createHash('sha256').update(stable({ protocol: input.profileKey ? 'mysql-card-gym-v1' : 'mysql-direct-v1', roadmapNodeId: input.roadmapNodeId, profileKey: input.profileKey ?? null, card: input.card ?? null, request })).digest('hex')
    this.log('create_started', { learnerId, roadmapNodeId: input.roadmapNodeId, fingerprint })
    return this.withLock(`${learnerId}:mysql-case:${fingerprint}`, async () => this.createCaseLocked(learnerId, input, request, fingerprint))
  }

  private async createCaseLocked(learnerId: string, input: { roadmapNodeId: string; request?: unknown; profileKey?: string; card?: MySqlExerciseCardContext; clientRequestId: string }, request: MySqlExerciseRequest, fingerprint: string): Promise<{ case: LearningCase; materialization: ReturnType<MySqlCaseMaterializationService['materialize']> }> {
    const node = this.repository.db.prepare(`SELECT n.id, n.node_key, n.capability_key, n.exercise_profile_key, n.learning_mode, n.roadmap_id, r.learner_id, r.status
      FROM roadmap_nodes n INNER JOIN learning_roadmaps r ON r.id = n.roadmap_id
      WHERE n.id = ? AND r.learner_id = ? AND r.status IN ('draft', 'active')`).get(input.roadmapNodeId, learnerId) as Row | undefined
    if (!node) throw new LabError('roadmap_node_not_found', '路线节点不存在', 404)
    const nodeCapability = node.capability_key == null ? null : text(node, 'capability_key')
    // Only the historical direct API may supply an explicit capability when an
    // old route row predates capability snapshots. GymBuildService never takes
    // this branch, so new card-scoped Gym construction cannot infer from title.
    const resolvedCapability = nodeCapability ? this.environments.byCapability(nodeCapability) : !input.profileKey ? this.environments.byCapability(request.capabilityKey) : null
    if (text(node, 'learning_mode') !== 'lab' || !resolvedCapability || !['mysql.slow-query', 'mysql.explain-plan'].includes(resolvedCapability.capabilityKey)) throw new LabError('mysql_case_capability_unavailable', '当前路线节点不是可用的 MySQL 实验', 409)
    if (request.capabilityKey !== resolvedCapability.capabilityKey) throw new LabError('mysql_case_capability_mismatch', '案例能力与路线节点不一致', 422)
    if (input.profileKey && (!input.card || input.card.nodeId !== input.roadmapNodeId)) throw new LabError('mysql_card_context_invalid', 'MySQL Gym 缺少冻结学习卡片', 422)
    if (input.profileKey && text(node, 'exercise_profile_key') !== input.profileKey) throw new LabError('mysql_case_profile_mismatch', '案例 profile 与路线卡片不一致', 422)
    const now = new Date().toISOString()
    this.log('persist_started', { learnerId, roadmapNodeId: input.roadmapNodeId, fingerprint })
    const persisted = this.repository.db.transaction(() => {
      const existingJob = this.repository.db.prepare('SELECT learning_case_id, input_fingerprint FROM case_generation_jobs WHERE learner_id = ? AND client_request_id = ?').get(learnerId, input.clientRequestId) as Row | undefined
      if (existingJob) {
        if (text(existingJob, 'input_fingerprint') !== fingerprint) throw new LabError('case_request_idempotency_conflict', 'clientRequestId 已用于其他 MySQL 案例输入', 409)
        return text(existingJob, 'learning_case_id')
      }
      const existing = this.repository.db.prepare('SELECT id FROM learning_cases WHERE learner_id = ? AND input_fingerprint = ?').get(learnerId, fingerprint) as Row | undefined
      const id = existing ? text(existing, 'id') : randomUUID()
      if (!existing) {
        this.repository.db.prepare(`INSERT INTO learning_cases(id, learner_id, roadmap_node_id, capability_key, template_key, environment_key, environment_version, runtime_kind, input_kind, input_snapshot_json, input_fingerprint, provider, version, status, case_spec_json, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'mysql-performance-v1', 'mysql-performance-v1', '1', 'mysql_lab', 'brief', ?, ?, ?, 3, 'generating', '{}', ?, ?)`).run(id, learnerId, input.roadmapNodeId, request.capabilityKey, JSON.stringify({ protocol: input.profileKey ? 'mysql-card-gym-v1' : 'mysql-direct-v1', profileKey: input.profileKey ?? null, request, card: input.card ?? null }), fingerprint, input.profileKey ? 'model' : 'fixture', now, now)
        this.repository.db.prepare(`INSERT INTO case_generation_jobs(id, learner_id, learning_case_id, client_request_id, input_fingerprint, provider, status, attempt_count, completed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, 'running', 1, NULL, ?, ?)`).run(randomUUID(), learnerId, id, input.clientRequestId, fingerprint, input.profileKey ? 'model' : 'fixture', now, now)
      }
      return id
    })()
    this.log('persist_finished', { learnerId, learningCaseId: persisted, fingerprint })
    let learningCase = this.repository.getLearningCaseForLearner(persisted, learnerId)
    const existingStatus = this.repository.db.prepare('SELECT status, preflight_status FROM learning_cases WHERE id = ? AND learner_id = ?').get(persisted, learnerId) as Row
    const existingMaterialization = this.materializations.get(learnerId, persisted)
    if (String(existingStatus.status) === 'ready' && String(existingStatus.preflight_status) === 'passed' && existingMaterialization?.status === 'materialized') {
      this.log('create_reused', { learnerId, learningCaseId: persisted, fingerprint })
      return { case: learningCase, materialization: existingMaterialization }
    }
    if (input.profileKey && learningCase.status !== 'ready') {
      try {
        const spec = await this.agent.build({ profileKey: input.profileKey, request, card: input.card! })
        this.repository.db.prepare("UPDATE learning_cases SET case_spec_json = ?, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'generating'").run(JSON.stringify(spec), new Date().toISOString(), persisted, learnerId)
        learningCase = this.repository.getLearningCaseForLearner(persisted, learnerId)
      } catch (error) {
        const message = error instanceof Error ? error.message.slice(0, 500) : 'MySQL 案例 Agent 失败'
        this.repository.db.transaction(() => {
          this.repository.db.prepare("UPDATE learning_cases SET status = 'failed', failure_code = 'mysql_exercise_generation_failed', failure_message = ?, updated_at = ? WHERE id = ? AND learner_id = ?").run(message, new Date().toISOString(), persisted, learnerId)
          this.repository.db.prepare("UPDATE case_generation_jobs SET status = 'failed', failure_code = 'mysql_exercise_generation_failed', failure_message = ?, completed_at = ?, updated_at = ? WHERE learning_case_id = ? AND learner_id = ? AND status = 'running'").run(message, new Date().toISOString(), new Date().toISOString(), persisted, learnerId)
        })()
        throw new LabError('mysql_exercise_generation_failed', 'MySQL 案例 Agent 未能生成可用案例', 503, true)
      }
    }
    this.log('materialization_started', { learnerId, learningCaseId: persisted })
    const materialization = this.materializations.materialize(learnerId, persisted, request)
    this.log('materialization_finished', { learnerId, learningCaseId: persisted, status: materialization.status })
    if (materialization.status === 'failed' || !materialization.plan) {
      throw new LabError('mysql_case_materialization_failed', materialization.failureMessage ?? '动态 MySQL 案例物料化失败', 503, true)
    }
    const refreshedStatus = this.repository.db.prepare('SELECT status, preflight_status FROM learning_cases WHERE id = ? AND learner_id = ?').get(persisted, learnerId) as Row
    if (String(refreshedStatus.status) !== 'ready' || String(refreshedStatus.preflight_status) !== 'passed') {
      this.log('preflight_started', { learnerId, learningCaseId: persisted })
      await this.preflight(learnerId, learningCase, materialization)
      this.log('preflight_finished', { learnerId, learningCaseId: persisted })
    }
    const completed = new Date().toISOString()
    this.repository.db.prepare("UPDATE case_generation_jobs SET status = 'succeeded', completed_at = ?, updated_at = ? WHERE learning_case_id = ? AND learner_id = ? AND status = 'running'").run(completed, completed, persisted, learnerId)
    return { case: this.repository.getLearningCaseForLearner(persisted, learnerId), materialization: this.materializations.get(learnerId, persisted)! }
  }

  async startPractice(learnerId: string, learningCaseId: string, planUnitId: string | null = null): Promise<{ practice: PracticeRun; lab?: { run: RunView; accessToken: string }; queue?: QueueTicketView }> {
    return this.withLock(`${learnerId}:${learningCaseId}`, async () => {
      const item = this.repository.getLearningCaseForLearner(learningCaseId, learnerId)
      if (!['mysql.slow-query', 'mysql.explain-plan'].includes(item.capabilityKey) || item.runtimeKind !== 'mysql_lab') throw new LabError('mysql_case_capability_mismatch', '该案例不能进入 MySQL Gym', 409)
      const materialization = this.materializations.get(learnerId, learningCaseId)
      if (!materialization?.plan || materialization.status !== 'materialized') throw new LabError('mysql_case_not_materialized', 'MySQL 案例物料尚未完成', 409, true)
      const plan = materialization.plan
      const manifest = this.manifestFor(item, materialization)
      await this.scheduler.registerDynamicCase(manifest, { schemaSql: plan.schemaSql, rowCount: plan.seedProfile.rowCount, distribution: plan.seedProfile.distribution as 'uniform' | 'skewed', faultSql: plan.faultSeed.sql })
      const existing = planUnitId
        ? this.repository.db.prepare("SELECT * FROM practice_runs INDEXED BY idx_practice_runs_learner_unit_case_updated WHERE learner_id = ? AND plan_unit_id = ? AND learning_case_id = ? AND status IN ('active', 'ready_to_close', 'resolved') ORDER BY updated_at DESC LIMIT 1").get(learnerId, planUnitId, learningCaseId) as Row | undefined
        : this.repository.db.prepare("SELECT * FROM practice_runs WHERE learner_id = ? AND learning_case_id = ? AND status IN ('active', 'ready_to_close', 'resolved') ORDER BY updated_at DESC LIMIT 1").get(learnerId, learningCaseId) as Row | undefined
      if (existing?.lab_run_id) {
        const access = this.scheduler.getAccess(String(existing.lab_run_id))
        if (access) return { practice: this.repository.getPracticeRun(text(existing, 'id')), lab: { run: access.run, accessToken: access.accessToken } }
        this.repository.finishLabSegment(String(existing.lab_run_id), 'scheduler_unavailable_or_expired')
        this.repository.updatePracticeRun(text(existing, 'id'), { labRunId: null })
      }
      const existingPractice = existing ? this.repository.getPracticeRun(text(existing, 'id')) : null
      const pendingTicketId = existingPractice?.runtimeQueueTicketId
      if (pendingTicketId && existingPractice) {
        const ticket = this.readQueueTicket(pendingTicketId)
        if (ticket?.status === 'waiting') return { practice: existingPractice, queue: ticket }
        if (ticket?.status === 'ready' && ticket.run) return this.adoptQueuedRun(existingPractice, ticket)
        this.repository.updatePracticeRun(existingPractice.id, { runtimeQueueTicketId: null, runtimeQueueExpiresAt: null })
      }
      const result = await this.scheduler.createRun(learningCaseId)
      if (result.kind === 'queued') {
        const practice = existingPractice ?? this.repository.createPracticeRun({ learnerId, planUnitId, caseId: learningCaseId, labRunId: null, practiceKind: 'mysql_lab', learningCaseId })
        const queuedPractice = this.repository.updatePracticeRun(practice.id, { runtimeQueueTicketId: result.ticket.ticketId, runtimeQueueExpiresAt: result.ticket.expiresAt })
        return { practice: queuedPractice, queue: result.ticket }
      }
      const practice = existingPractice
        ? this.repository.updatePracticeRun(existingPractice.id, { labRunId: result.run.runId, runtimeQueueTicketId: null, runtimeQueueExpiresAt: null, ...(planUnitId ? { planUnitId } : {}) })
        : this.repository.createPracticeRun({ learnerId, planUnitId, caseId: learningCaseId, labRunId: result.run.runId, practiceKind: 'mysql_lab', learningCaseId })
      this.repository.createLabSegment({ practiceRunId: practice.id, labRunId: result.run.runId, fixtureVersion: result.run.fixtureVersion })
      if (!existingPractice) this.repository.appendEvent({ learnerId, practiceRunId: practice.id, actor: 'system', type: 'case_presented', stage: 'observe', payload: { caseId: learningCaseId, materializationId: materialization.id, environment: 'mysql_lab', dynamic: true } })
      return { practice: this.repository.getPracticeRun(practice.id), lab: { run: result.run, accessToken: result.accessToken } }
    })
  }

  isRuntimeActive(runId: string): boolean { return this.scheduler.isRunActive(runId) }

  runtimeStatusForPractice(practice: PracticeRun): DynamicRuntimeStatus {
    if (practice.practiceKind !== 'mysql_lab' || !practice.learningCaseId) return 'none'
    if (practice.labRunId) return this.scheduler.isRunActive(practice.labRunId) ? 'active' : 'expired'
    if (!practice.runtimeQueueTicketId) return 'none'
    const ticket = this.readQueueTicket(practice.runtimeQueueTicketId)
    if (ticket?.status === 'waiting') return 'queued'
    if (ticket?.status === 'ready' && ticket.run) return 'active'
    return 'expired'
  }

  async runtime(learnerId: string, practiceRunId: string): Promise<{ status: 'none' | 'queued' | 'active' | 'expired' | 'failed'; practice: PracticeRun; queue?: QueueTicketView; lab?: { run: RunView; accessToken: string }; error?: { code: string; message: string; retryable: boolean } }> {
    const practice = this.repository.getPracticeRun(practiceRunId)
    if (practice.learnerId !== learnerId || !practice.learningCaseId || practice.practiceKind !== 'mysql_lab') throw new LabError('forbidden', '无权访问该动态实践', 403)
    const ticketId = practice.runtimeQueueTicketId
    if (ticketId) {
      const ticket = this.readQueueTicket(ticketId)
      if (ticket?.status === 'waiting') return { status: 'queued', practice, queue: ticket }
      if (ticket?.status === 'ready' && ticket.run) return this.adoptQueuedRun(practice, ticket)
      const cancelled = ticket?.status === 'cancelled'
      return { status: cancelled ? 'failed' : 'expired', practice: this.repository.updatePracticeRun(practiceRunId, { labRunId: null, runtimeQueueTicketId: null, runtimeQueueExpiresAt: null }), error: { code: cancelled ? 'runtime_queue_cancelled' : 'runtime_queue_expired', message: cancelled ? '运行排队已取消' : '运行排队已过期或服务重启后失效', retryable: true } }
    }
    if (!practice.labRunId) return { status: 'none', practice }
    const access = this.scheduler.getAccess(practice.labRunId)
    if (access) return { status: 'active', practice, lab: { run: access.run, accessToken: access.accessToken } }
    this.repository.finishLabSegment(practice.labRunId, 'scheduler_unavailable_or_expired')
    return { status: 'expired', practice: this.repository.updatePracticeRun(practiceRunId, { labRunId: null }), error: { code: 'runtime_expired', message: '实验运行已失效，需要重新启动 Gym', retryable: true } }
  }

  async supersedeEmptyPractice(practice: PracticeRun, replacementCaseId: string): Promise<void> {
    if (!practice.learningCaseId) return
    if (practice.labRunId) await this.scheduler.release(practice.labRunId, undefined).catch(() => undefined)
    this.repository.db.transaction(() => {
      if (practice.labRunId) this.repository.finishLabSegment(practice.labRunId, 'gym_case_superseded')
      this.repository.updatePracticeRun(practice.id, { status: 'ended', labRunId: null, runtimeQueueTicketId: null, runtimeQueueExpiresAt: null })
      this.repository.appendEvent({ learnerId: practice.learnerId, practiceRunId: practice.id, actor: 'system', type: 'gym_case_superseded', stage: practice.stage, payload: { learningCaseId: practice.learningCaseId, replacementCaseId } })
    })()
  }

  private adoptQueuedRun(practice: PracticeRun, ticket: QueueTicketView): { status: 'active'; practice: PracticeRun; lab: { run: RunView; accessToken: string } } {
    if (!ticket.run) throw new LabError('runtime_queue_invalid', '运行排队返回无效结果', 503, true)
    const updated = this.repository.updatePracticeRun(practice.id, { labRunId: ticket.run.runId, runtimeQueueTicketId: null, runtimeQueueExpiresAt: null })
    this.repository.createLabSegment({ practiceRunId: practice.id, labRunId: ticket.run.runId, fixtureVersion: ticket.run.fixtureVersion })
    return { status: 'active', practice: updated, lab: { run: ticket.run, accessToken: ticket.run.accessToken } }
  }

  private readQueueTicket(ticketId: string): QueueTicketView | null {
    try { return this.scheduler.getTicket(ticketId) } catch (error) {
      if (error instanceof LabError && error.code === 'queue_ticket_not_found') return null
      throw error
    }
  }

  materializationFor(learnerId: string, learningCaseId: string) { return this.materializations.get(learnerId, learningCaseId) }

  private manifestFor(item: LearningCase, materialization: NonNullable<ReturnType<MySqlCaseMaterializationService['get']>>): CaseManifest {
    const plan = materialization.plan!
    return {
      id: item.id,
      title: item.spec?.title ?? '动态 MySQL 慢查询案例',
      schema: `zhixing_dynamic_${item.id.replaceAll('-', '').slice(0, 24)}`,
      allowedSessions: ['default'],
      fixtureVersion: `${plan.registryVersion}:${materialization.materializationFingerprint.slice(0, 16)}`,
      tables: ['orders'],
      baselineIndexes: { orders: { PRIMARY: '' } },
    }
  }

  private async preflight(learnerId: string, item: LearningCase, materialization: NonNullable<ReturnType<MySqlCaseMaterializationService['get']>>): Promise<void> {
    const plan = materialization.plan!
    const manifest = this.manifestFor(item, materialization)
    const now = new Date().toISOString()
    let started: Awaited<ReturnType<LabScheduler['createRun']>> | null = null
    try {
      this.log('preflight_registering', { learnerId, learningCaseId: item.id })
      await this.scheduler.registerDynamicCase(manifest, { schemaSql: plan.schemaSql, rowCount: plan.seedProfile.rowCount, distribution: plan.seedProfile.distribution as 'uniform' | 'skewed', faultSql: plan.faultSeed.sql })
      this.log('preflight_registered', { learnerId, learningCaseId: item.id })
      started = await this.scheduler.createRun(item.id)
      this.log('preflight_run_created', { learnerId, learningCaseId: item.id, kind: started.kind })
      if (started.kind !== 'started') throw new Error('dynamic_case_preflight_queued')
      const session = await this.scheduler.createSession(started.run.runId, started.accessToken, 'default')
      this.log('preflight_session_created', { learnerId, learningCaseId: item.id })
      const query = plan.query.sql.replaceAll('?', '1')
      const initial = await this.scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, `EXPLAIN ${query}`, `mysql-preflight-explain:${item.id}`)
      this.log('preflight_explain_finished', { learnerId, learningCaseId: item.id, status: initial.status })
      if (initial.status !== 'succeeded' || initial.result?.kind !== 'result_set' || (initial.result.rows?.length ?? 0) === 0) throw new Error('mysql_preflight_initial_explain_failed')
      const repaired = await this.scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, plan.referenceSolution.sql, `mysql-preflight-repair:${item.id}`)
      this.log('preflight_reference_finished', { learnerId, learningCaseId: item.id, status: repaired.status })
      if (repaired.status !== 'succeeded') throw new Error('mysql_preflight_reference_failed')
      const verified = await this.scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, `EXPLAIN ${query}`, `mysql-preflight-verify:${item.id}`)
      this.log('preflight_verify_finished', { learnerId, learningCaseId: item.id, status: verified.status })
      if (verified.status !== 'succeeded' || verified.result?.kind !== 'result_set' || (verified.result.rows?.length ?? 0) === 0) throw new Error('mysql_preflight_reference_explain_failed')
      this.repository.db.prepare("UPDATE learning_cases SET status = 'ready', preflight_status = 'passed', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(now, item.id, learnerId)
      this.repository.db.prepare("UPDATE case_materializations SET status = 'materialized', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(now, materialization.id, learnerId)
      this.repository.db.prepare('INSERT INTO case_materialization_events(id, learner_id, learning_case_id, materialization_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, item.id, materialization.id, 'preflight_passed', JSON.stringify({ queryTemplateKey: plan.request.queryTemplateKey }), now)
    } catch (error) {
      this.log('preflight_failed', { learnerId, learningCaseId: item.id, errorCode: error instanceof LabError ? error.code : 'mysql_preflight_failed' })
      const message = error instanceof Error ? error.message.slice(0, 500) : 'MySQL 动态案例预检失败'
      this.repository.db.prepare("UPDATE learning_cases SET status = 'failed', preflight_status = 'failed', failure_code = 'mysql_preflight_failed', failure_message = ?, updated_at = ? WHERE id = ? AND learner_id = ?").run(message, now, item.id, learnerId)
      this.repository.db.prepare("UPDATE case_materializations SET status = 'failed', failure_code = 'mysql_preflight_failed', failure_message = ?, updated_at = ? WHERE id = ? AND learner_id = ?").run(message, now, materialization.id, learnerId)
      this.repository.db.prepare('INSERT INTO case_materialization_events(id, learner_id, learning_case_id, materialization_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, item.id, materialization.id, 'preflight_failed', JSON.stringify({ message }), now)
      throw new LabError('mysql_case_preflight_failed', '动态 MySQL 案例预检失败，案例不可进入 Lab', 503, true)
    } finally {
      if (started?.kind === 'started') await this.scheduler.release(started.run.runId, started.accessToken).catch(() => undefined)
    }
  }
}
