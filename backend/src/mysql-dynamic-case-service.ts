import { createHash, randomUUID } from 'node:crypto'
import type { CaseManifest } from './domain.js'
import { LabError } from './errors.js'
import type { LearningCase, MySqlExerciseRequest, PracticeRun } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import { parseMySqlExerciseRequest } from './mysql-case-interpreter.js'
import { MySqlCaseMaterializationService } from './mysql-case-materialization-service.js'
import type { LabScheduler } from './scheduler.js'

type Row = Record<string, unknown>
const text = (row: Row, key: string) => String(row[key])
const stable = (value: unknown): string => {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

export class MySqlDynamicCaseService {
  private readonly materializations: MySqlCaseMaterializationService
  private readonly locks = new Map<string, Promise<void>>()

  constructor(private readonly repository: ProductRepository, private readonly scheduler: LabScheduler) {
    this.materializations = new MySqlCaseMaterializationService(repository)
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

  async createCase(learnerId: string, input: { roadmapNodeId: string; request: unknown; clientRequestId: string }): Promise<{ case: LearningCase; materialization: ReturnType<MySqlCaseMaterializationService['materialize']> }> {
    this.repository.ensureLearner(learnerId)
    const request = parseMySqlExerciseRequest(input.request)
    const fingerprint = createHash('sha256').update(stable({ roadmapNodeId: input.roadmapNodeId, request })).digest('hex')
    return this.withLock(`${learnerId}:mysql-case:${fingerprint}`, async () => this.createCaseLocked(learnerId, input, request, fingerprint))
  }

  private async createCaseLocked(learnerId: string, input: { roadmapNodeId: string; request: unknown; clientRequestId: string }, request: MySqlExerciseRequest, fingerprint: string): Promise<{ case: LearningCase; materialization: ReturnType<MySqlCaseMaterializationService['materialize']> }> {
    const node = this.repository.db.prepare(`SELECT n.id, n.capability_key, n.learning_mode, n.roadmap_id, r.learner_id, r.status
      FROM roadmap_nodes n INNER JOIN learning_roadmaps r ON r.id = n.roadmap_id
      WHERE n.id = ? AND r.learner_id = ? AND r.status IN ('draft', 'active')`).get(input.roadmapNodeId, learnerId) as Row | undefined
    if (!node) throw new LabError('roadmap_node_not_found', '路线节点不存在', 404)
    if (text(node, 'learning_mode') !== 'lab' || text(node, 'capability_key') !== 'mysql.slow-query') throw new LabError('mysql_case_capability_unavailable', '当前路线节点不是可用的 MySQL 慢查询实验', 409)
    if (request.capabilityKey !== 'mysql.slow-query') throw new LabError('mysql_case_capability_mismatch', '案例能力与路线节点不一致', 422)
    const now = new Date().toISOString()
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
          VALUES (?, ?, ?, 'mysql.slow-query', 'mysql-performance-v1', 'mysql-performance-v1', '1', 'mysql_lab', 'brief', ?, ?, 'fixture', 1, 'ready', '{}', ?, ?)`).run(id, learnerId, input.roadmapNodeId, JSON.stringify({ request }), fingerprint, now, now)
        this.repository.db.prepare(`INSERT INTO case_generation_jobs(id, learner_id, learning_case_id, client_request_id, input_fingerprint, provider, status, attempt_count, completed_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'fixture', 'succeeded', 1, ?, ?, ?)`).run(randomUUID(), learnerId, id, input.clientRequestId, fingerprint, now, now, now)
      }
      return id
    })()
    const learningCase = this.repository.getLearningCaseForLearner(persisted, learnerId)
    const materialization = this.materializations.materialize(learnerId, persisted, request)
    if (materialization.status === 'failed' || !materialization.plan) {
      throw new LabError('mysql_case_materialization_failed', materialization.failureMessage ?? '动态 MySQL 案例物料化失败', 503, true)
    }
    const existingStatus = this.repository.db.prepare('SELECT preflight_status FROM learning_cases WHERE id = ? AND learner_id = ?').get(persisted, learnerId) as Row
    if (String(existingStatus.preflight_status) !== 'passed') await this.preflight(learnerId, learningCase, materialization)
    return { case: this.repository.getLearningCaseForLearner(persisted, learnerId), materialization: this.materializations.get(learnerId, persisted)! }
  }

  async startPractice(learnerId: string, learningCaseId: string): Promise<{ practice: PracticeRun; lab: { run: unknown; accessToken: string } }> {
    return this.withLock(`${learnerId}:${learningCaseId}`, async () => {
      const item = this.repository.getLearningCaseForLearner(learningCaseId, learnerId)
      if (item.capabilityKey !== 'mysql.slow-query' || item.runtimeKind !== 'mysql_lab') throw new LabError('mysql_case_capability_mismatch', '该案例不能进入 MySQL Lab', 409)
      const materialization = this.materializations.get(learnerId, learningCaseId)
      if (!materialization?.plan || materialization.status !== 'materialized') throw new LabError('mysql_case_not_materialized', 'MySQL 案例物料尚未完成', 409, true)
      const plan = materialization.plan
      const manifest = this.manifestFor(item, materialization)
      await this.scheduler.registerDynamicCase(manifest, { schemaSql: plan.schemaSql, rowCount: plan.seedProfile.rowCount, distribution: plan.seedProfile.distribution as 'uniform' | 'skewed', faultSql: plan.faultSeed.sql })
      const existing = this.repository.db.prepare("SELECT * FROM practice_runs WHERE learner_id = ? AND learning_case_id = ? AND status IN ('active', 'ready_to_close', 'resolved') ORDER BY updated_at DESC LIMIT 1").get(learnerId, learningCaseId) as Row | undefined
      if (existing?.lab_run_id) {
        const access = this.scheduler.getAccess(String(existing.lab_run_id))
        if (access) return { practice: this.repository.getPracticeRun(text(existing, 'id')), lab: { run: access.run, accessToken: access.accessToken } }
      }
      const result = await this.scheduler.createRun(learningCaseId)
      if (result.kind === 'queued') throw new LabError('mysql_case_queued', '动态 MySQL 案例正在排队，请稍后重试', 409, true)
      const practice = existing ? this.repository.updatePracticeRun(text(existing, 'id'), { labRunId: result.run.runId }) : this.repository.createPracticeRun({ learnerId, planUnitId: null, caseId: learningCaseId, labRunId: result.run.runId, practiceKind: 'mysql_lab', learningCaseId })
      this.repository.createLabSegment({ practiceRunId: practice.id, labRunId: result.run.runId, fixtureVersion: result.run.fixtureVersion })
      if (!existing) this.repository.appendEvent({ learnerId, practiceRunId: practice.id, actor: 'system', type: 'case_presented', stage: 'observe', payload: { caseId: learningCaseId, materializationId: materialization.id, environment: 'mysql_lab', dynamic: true } })
      return { practice: this.repository.getPracticeRun(practice.id), lab: { run: result.run, accessToken: result.accessToken } }
    })
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
      await this.scheduler.registerDynamicCase(manifest, { schemaSql: plan.schemaSql, rowCount: plan.seedProfile.rowCount, distribution: plan.seedProfile.distribution as 'uniform' | 'skewed', faultSql: plan.faultSeed.sql })
      started = await this.scheduler.createRun(item.id)
      if (started.kind !== 'started') throw new Error('dynamic_case_preflight_queued')
      const session = await this.scheduler.createSession(started.run.runId, started.accessToken, 'default')
      const query = plan.query.sql.replaceAll('?', '1')
      const initial = await this.scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, `EXPLAIN ${query}`, `mysql-preflight-explain:${item.id}`)
      if (initial.status !== 'succeeded' || initial.result?.kind !== 'result_set' || (initial.result.rows?.length ?? 0) === 0) throw new Error('mysql_preflight_initial_explain_failed')
      const repaired = await this.scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, plan.referenceSolution.sql, `mysql-preflight-repair:${item.id}`)
      if (repaired.status !== 'succeeded') throw new Error('mysql_preflight_reference_failed')
      const verified = await this.scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, `EXPLAIN ${query}`, `mysql-preflight-verify:${item.id}`)
      if (verified.status !== 'succeeded' || verified.result?.kind !== 'result_set' || (verified.result.rows?.length ?? 0) === 0) throw new Error('mysql_preflight_reference_explain_failed')
      this.repository.db.prepare("UPDATE learning_cases SET preflight_status = 'passed', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(now, item.id, learnerId)
      this.repository.db.prepare("UPDATE case_materializations SET status = 'materialized', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(now, materialization.id, learnerId)
      this.repository.db.prepare('INSERT INTO case_materialization_events(id, learner_id, learning_case_id, materialization_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, item.id, materialization.id, 'preflight_passed', JSON.stringify({ queryTemplateKey: plan.request.queryTemplateKey }), now)
    } catch (error) {
      if (started?.kind === 'started') await this.scheduler.release(started.run.runId, started.accessToken).catch(() => undefined)
      const message = error instanceof Error ? error.message.slice(0, 500) : 'MySQL 动态案例预检失败'
      this.repository.db.prepare("UPDATE learning_cases SET status = 'failed', preflight_status = 'failed', failure_code = 'mysql_preflight_failed', failure_message = ?, updated_at = ? WHERE id = ? AND learner_id = ?").run(message, now, item.id, learnerId)
      this.repository.db.prepare("UPDATE case_materializations SET status = 'failed', failure_code = 'mysql_preflight_failed', failure_message = ?, updated_at = ? WHERE id = ? AND learner_id = ?").run(message, now, materialization.id, learnerId)
      this.repository.db.prepare('INSERT INTO case_materialization_events(id, learner_id, learning_case_id, materialization_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, item.id, materialization.id, 'preflight_failed', JSON.stringify({ message }), now)
      throw new LabError('mysql_case_preflight_failed', '动态 MySQL 案例预检失败，案例不可进入 Lab', 503, true)
    }
  }
}
