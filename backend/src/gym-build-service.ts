import { createHash, randomUUID } from 'node:crypto'
import { LabError } from './errors.js'
import { PracticeEnvironmentCatalog, type AgentPracticeEnvironment } from './practice-environment-catalog.js'
import type { CaseGenerationJob, LearningCase, PracticeRun } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import { CaseWorkspaceService } from './case-workspace-service.js'
import { MySqlDynamicCaseService } from './mysql-dynamic-case-service.js'
import type { DynamicRuntimeStatus } from './planning-types.js'
import type { CaseDesignCard } from './case-design-agent.js'

type Row = Record<string, unknown>
type BuildStatus = 'queued' | 'building' | 'ready' | 'failed'

function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function json<T>(value: unknown, fallback: T): T { try { return typeof value === 'string' ? JSON.parse(value) as T : fallback } catch { return fallback } }
function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stable((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}
function fingerprint(value: unknown): string { return createHash('sha256').update(stable(value)).digest('hex') }

export interface GymBuildJob {
  id: string
  learnerId: string
  planId: string
  planUnitId: string
  roadmapNodeId: string | null
  clientRequestId: string
  inputFingerprint: string
  capabilityKey: string
  exerciseProfileKey: string | null
  environmentKey: string
  environmentVersion: string
  runtimeKind: 'mysql_lab' | 'docker_workspace'
  status: BuildStatus
  learningCaseId: string | null
  caseGenerationJobId: string | null
  attemptCount: number
  failureCode: string | null
  failureMessage: string | null
  startedAt: string | null
  completedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface GymBuildView {
  job: GymBuildJob
  environment: Pick<AgentPracticeEnvironment, 'planningKey' | 'capabilityKey' | 'displayName' | 'agentSummary' | 'runtimeKind' | 'environmentKey' | 'environmentVersion' | 'learningMode'>
  case: LearningCase | null
  caseGeneration: CaseGenerationJob | null
  runtime: { status: DynamicRuntimeStatus; practiceRunId: string | null }
}

export class GymBuildService {
  private readonly catalog: PracticeEnvironmentCatalog
  private readonly locks = new Map<string, Promise<void>>()

  constructor(private readonly repository: ProductRepository, private readonly workspace: CaseWorkspaceService, private readonly mysql: MySqlDynamicCaseService) {
    this.catalog = new PracticeEnvironmentCatalog(repository.db)
  }

  private get db() { return this.repository.db }

  private log(stage: string, details: Record<string, unknown>): void {
    console.info('[zhixing-gym]', stage, details)
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

  private planUnit(learnerId: string, planId: string, planUnitId: string): Row {
    const row = this.db.prepare(`SELECT p.id AS plan_id, p.learner_id, p.status AS plan_status, u.id AS plan_unit_id, u.status AS unit_status, u.availability,
      u.learning_mode, u.learning_case_id, u.case_id, u.exercise_profile_key AS unit_exercise_profile_key, n.id AS roadmap_node_id, n.node_key, n.title, n.summary, n.knowledge_card_json, n.completion_standard, n.capability_key, n.exercise_profile_key
      FROM learning_plans p INNER JOIN plan_units u ON u.plan_id = p.id LEFT JOIN roadmap_nodes n ON n.id = u.roadmap_node_id
      WHERE p.id = ? AND p.learner_id = ? AND u.id = ?`).get(planId, learnerId, planUnitId) as Row | undefined
    if (!row) throw new LabError('plan_unit_not_found', '当前学习单元不存在', 404)
    if (!['confirmed', 'active'].includes(text(row, 'plan_status'))) throw new LabError('plan_not_active', '只有进行中的计划可以构建 Gym', 409)
    if (text(row, 'unit_status') !== 'current' || text(row, 'availability') !== 'available') throw new LabError('unit_not_current', '只能为当前可用单元构建 Gym', 409)
    return row
  }

  private environmentFor(row: Row): AgentPracticeEnvironment {
    const capabilityKey = nullable(row, 'capability_key')
    const environment = capabilityKey ? this.catalog.byCapability(capabilityKey) : null
    if (!environment) throw new LabError('practice_capability_unavailable', '当前节点的实践环境尚未开放', 409)
    if (environment.learningMode !== 'lab' && environment.learningMode !== 'workspace') throw new LabError('practice_capability_invalid', '当前实践能力配置无效', 409)
    return environment
  }

  private jobFrom(row: Row): GymBuildJob {
    return {
      id: text(row, 'id'), learnerId: text(row, 'learner_id'), planId: text(row, 'plan_id'), planUnitId: text(row, 'plan_unit_id'), roadmapNodeId: nullable(row, 'roadmap_node_id'),
      clientRequestId: text(row, 'client_request_id'), inputFingerprint: text(row, 'input_fingerprint'), capabilityKey: text(row, 'capability_key'), exerciseProfileKey: nullable(row, 'exercise_profile_key'), environmentKey: text(row, 'environment_key'), environmentVersion: text(row, 'environment_version'), runtimeKind: text(row, 'runtime_kind') as GymBuildJob['runtimeKind'], status: text(row, 'status') as BuildStatus,
      learningCaseId: nullable(row, 'learning_case_id'), caseGenerationJobId: nullable(row, 'case_generation_job_id'), attemptCount: Number(row.attempt_count), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), startedAt: nullable(row, 'started_at'), completedAt: nullable(row, 'completed_at'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  private jobFor(learnerId: string, id: string): GymBuildJob {
    const row = this.db.prepare('SELECT * FROM gym_build_jobs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('gym_build_not_found', 'Gym 构建任务不存在', 404)
    return this.jobFrom(row)
  }

  private caseFor(learnerId: string, id: string | null): LearningCase | null {
    return id ? this.repository.getLearningCaseForLearner(id, learnerId) : null
  }

  private caseReady(learnerId: string, id: string, runtimeKind: GymBuildJob['runtimeKind']): boolean {
    const row = this.db.prepare('SELECT status, preflight_status FROM learning_cases WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row || text(row, 'status') !== 'ready') return false
    return runtimeKind !== 'mysql_lab' || text(row, 'preflight_status') === 'passed'
  }

  private view(learnerId: string, id: string): GymBuildView {
    const job = this.jobFor(learnerId, id)
    const environment = this.catalog.byCapability(job.capabilityKey)
    if (!environment) throw new LabError('practice_capability_unavailable', '构建任务绑定的实践能力已不可用', 409)
    const caseGeneration = job.caseGenerationJobId ? (() => {
      const row = this.db.prepare('SELECT * FROM case_generation_jobs WHERE id = ? AND learner_id = ?').get(job.caseGenerationJobId, learnerId) as Row | undefined
      if (!row) return null
      return this.caseGenerationFrom(row)
    })() : null
      const practice = this.repository.findActivePracticeForUnit(learnerId, job.planUnitId)
      const runtime: { status: DynamicRuntimeStatus; practiceRunId: string | null } = !practice?.learningCaseId
        ? { status: 'none', practiceRunId: practice?.id ?? null }
        : { status: this.mysql.runtimeStatusForPractice(practice), practiceRunId: practice.id }
      return { job, environment, case: this.caseFor(learnerId, job.learningCaseId), caseGeneration, runtime }
  }

  private caseGenerationFrom(row: Row): CaseGenerationJob {
    return {
      id: text(row, 'id'), learnerId: text(row, 'learner_id'), learningCaseId: text(row, 'learning_case_id'), clientRequestId: text(row, 'client_request_id'), inputFingerprint: text(row, 'input_fingerprint'), provider: text(row, 'provider') as CaseGenerationJob['provider'], status: text(row, 'status') as CaseGenerationJob['status'], attemptCount: Number(row.attempt_count), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), startedAt: nullable(row, 'started_at'), completedAt: nullable(row, 'completed_at'),
    }
  }

  create(learnerId: string, planId: string, planUnitId: string, clientRequestId: string): GymBuildView {
    this.repository.ensureLearner(learnerId)
    const row = this.planUnit(learnerId, planId, planUnitId)
    const environment = this.environmentFor(row)
    // Profiles are selected by CaseDesignAgent from the catalog, not locked by
    // the Planner or this coordinator before the card is evaluated.
    const exerciseProfileKey = null
    const cardSnapshot: CaseDesignCard = {
      nodeId: text(row, 'roadmap_node_id'), title: text(row, 'title'), summary: text(row, 'summary'), completionStandard: text(row, 'completion_standard'),
      knowledgeCard: json(row.knowledge_card_json, {}), evidence: [], learnerProfile: [],
    }
    const inputFingerprint = fingerprint({ protocol: 'case-design-v1', planId, planUnitId, roadmapNodeId: nullable(row, 'roadmap_node_id'), capabilityKey: environment.capabilityKey, cardSnapshot })
    const now = new Date().toISOString()
    const persisted = this.db.transaction(() => {
      const byRequest = this.db.prepare('SELECT id, input_fingerprint FROM gym_build_jobs WHERE learner_id = ? AND plan_unit_id = ? AND client_request_id = ?').get(learnerId, planUnitId, clientRequestId) as Row | undefined
      if (byRequest) {
        if (text(byRequest, 'input_fingerprint') !== inputFingerprint) throw new LabError('idempotency_conflict', 'clientRequestId 已对应另一份 Gym 构建请求', 409)
        return text(byRequest, 'id')
      }
      const byInput = this.db.prepare('SELECT id FROM gym_build_jobs WHERE learner_id = ? AND plan_unit_id = ? AND input_fingerprint = ? ORDER BY created_at DESC LIMIT 1').get(learnerId, planUnitId, inputFingerprint) as Row | undefined
      if (byInput) return text(byInput, 'id')
      const existingCaseId = nullable(row, 'learning_case_id')
      const caseReady = existingCaseId ? this.caseReady(learnerId, existingCaseId, environment.runtimeKind) : false
      const id = randomUUID()
      this.db.prepare(`INSERT INTO gym_build_jobs(id, learner_id, plan_id, plan_unit_id, roadmap_node_id, client_request_id, input_fingerprint, capability_key, exercise_profile_key, card_snapshot_json, environment_key, environment_version, runtime_kind, status, learning_case_id, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`).run(id, learnerId, planId, planUnitId, nullable(row, 'roadmap_node_id'), clientRequestId, inputFingerprint, environment.capabilityKey, exerciseProfileKey, JSON.stringify(cardSnapshot), environment.environmentKey, environment.environmentVersion, environment.runtimeKind, caseReady ? 'ready' : 'queued', caseReady ? existingCaseId : null, now, now)
      return id
    })()
    const result = this.view(learnerId, persisted)
      if (result.job.status === 'queued') void this.process(persisted, 'create').catch((error) => console.error('[zhixing-gym] build_unhandled', { buildId: persisted, error: error instanceof Error ? error.message : String(error) }))
    return result
  }

  get(learnerId: string, id: string): GymBuildView { return this.view(learnerId, id) }

  retry(learnerId: string, id: string): GymBuildView {
    const job = this.jobFor(learnerId, id)
    if (['queued', 'building'].includes(job.status)) return this.view(learnerId, id)
    if (job.status === 'ready') return this.view(learnerId, id)
    const now = new Date().toISOString()
    const changed = this.db.prepare("UPDATE gym_build_jobs SET status = 'queued', failure_code = NULL, failure_message = NULL, completed_at = NULL, worker_token = NULL, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'failed'").run(now, id, learnerId)
    if (changed.changes === 0) return this.view(learnerId, id)
      void this.process(id, 'retry').catch((error) => console.error('[zhixing-gym] retry_unhandled', { buildId: id, error: error instanceof Error ? error.message : String(error) }))
    return this.view(learnerId, id)
  }

  async start(learnerId: string, id: string): Promise<unknown> {
    return this.withLock(`start:${learnerId}:${id}`, async () => {
      const view = this.view(learnerId, id)
      if (view.job.status !== 'ready' || !view.job.learningCaseId || !view.case || view.case.status !== 'ready') throw new LabError('gym_build_not_ready', 'Gym 案例尚未准备完成', 409, true)
      this.planUnit(learnerId, view.job.planId, view.job.planUnitId)
      if (view.job.runtimeKind === 'mysql_lab') return { kind: 'mysql_lab', ...(await this.mysql.startPractice(learnerId, view.job.learningCaseId, view.job.planUnitId)) }
      const workspace = await this.workspace.startPractice(learnerId, view.job.learningCaseId, view.job.planUnitId)
      return { kind: 'docker_workspace', workspace }
    })
  }

  async resume(): Promise<void> {
    await this.supersedeEmptyLegacyGymRuns()
    const now = new Date().toISOString()
    const staleBefore = new Date(Date.now() - 10 * 60 * 1000).toISOString()
    this.db.transaction(() => {
      this.db.prepare("UPDATE gym_build_job_attempts SET status = 'interrupted', failure_code = 'worker_interrupted', failure_message = '服务重启回收超时构建任务', completed_at = ? WHERE status = 'running' AND gym_build_job_id IN (SELECT id FROM gym_build_jobs WHERE status = 'building' AND (started_at IS NULL OR started_at < ?))").run(now, staleBefore)
      this.db.prepare("UPDATE gym_build_jobs SET status = 'queued', worker_token = NULL, started_at = NULL, updated_at = ? WHERE status = 'building' AND (started_at IS NULL OR started_at < ?)").run(now, staleBefore)
    })()
    const rows = this.db.prepare("SELECT id FROM gym_build_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 20").all() as Row[]
    await Promise.all(rows.map((row) => this.process(text(row, 'id'), 'recovery')))
  }

  private async supersedeEmptyLegacyGymRuns(): Promise<void> {
    const rows = this.db.prepare(`SELECT r.*, u.learning_case_id, n.exercise_profile_key
      FROM practice_runs r
      INNER JOIN plan_units u ON u.id = r.plan_unit_id
      INNER JOIN roadmap_nodes n ON n.id = u.roadmap_node_id
      INNER JOIN learning_cases c ON c.id = u.learning_case_id
      WHERE r.practice_kind = 'mysql_lab' AND r.learning_case_id = u.learning_case_id
        AND r.status IN ('active', 'ready_to_close', 'resolved')
        AND n.exercise_profile_key IS NOT NULL
        AND (c.case_spec_json = '{}' OR c.input_snapshot_json LIKE '%mysql-direct-v1%')
        AND NOT EXISTS (SELECT 1 FROM artifacts a WHERE a.practice_run_id = r.id)
        AND NOT EXISTS (SELECT 1 FROM practice_events e WHERE e.practice_run_id = r.id AND e.actor IN ('user', 'tutor', 'lab', 'workspace'))`).all() as Row[]
    for (const row of rows) {
      const practice = this.repository.getPracticeRun(text(row, 'id'))
      const replacementId = `pending:${text(row, 'plan_unit_id')}`
      await this.mysql.supersedeEmptyPractice(practice, replacementId)
      this.db.prepare('UPDATE plan_units SET learning_case_id = NULL WHERE id = ? AND learning_case_id = ?').run(text(row, 'plan_unit_id'), text(row, 'learning_case_id'))
    }
  }

  private async waitForCase(learnerId: string, caseId: string, jobId: string): Promise<LearningCase> {
    const deadline = Date.now() + 120_000
    while (Date.now() < deadline) {
      const current = this.workspace.getCaseGenerationJob(learnerId, jobId)
      if (current.job.status === 'succeeded' && current.case.status === 'ready') return current.case
      if (['failed', 'interrupted'].includes(current.job.status)) throw new LabError('gym_case_generation_failed', current.job.failureMessage ?? current.case.failureMessage ?? '案例生成失败', 503, true)
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    throw new LabError('gym_case_generation_timeout', '案例生成超时，请稍后重试', 504, true)
  }

  private async process(id: string, trigger: 'create' | 'retry' | 'recovery'): Promise<void> {
    return this.withLock(`build:${id}`, async () => {
      const token = randomUUID(); const now = new Date().toISOString()
      const claimed = this.db.prepare("UPDATE gym_build_jobs SET status = 'building', attempt_count = attempt_count + 1, worker_token = ?, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(token, now, now, id)
      if (claimed.changes === 0) return
      const row = this.db.prepare('SELECT * FROM gym_build_jobs WHERE id = ? AND worker_token = ?').get(id, token) as Row | undefined
      if (!row) return
      const learnerId = text(row, 'learner_id'); const planId = text(row, 'plan_id'); const planUnitId = text(row, 'plan_unit_id'); const nodeId = nullable(row, 'roadmap_node_id'); const attemptCount = Number(row.attempt_count)
      let attemptRecorded = false
      try {
        this.db.prepare(`INSERT INTO gym_build_job_attempts(id, gym_build_job_id, attempt_no, status, worker_token, trigger, started_at, created_at)
          VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`).run(randomUUID(), id, attemptCount, token, trigger, now, now)
        attemptRecorded = true
        const environment = this.environmentFor(this.planUnit(learnerId, planId, planUnitId))
        this.log('build_started', { buildId: id, learnerId, planUnitId, runtimeKind: environment.runtimeKind, attempt: attemptCount })
        let learningCaseId: string; let caseGenerationJobId: string | null = null
        const existing = nullable(row, 'learning_case_id')
        if (existing && this.caseReady(learnerId, existing, environment.runtimeKind)) learningCaseId = existing
        else if (environment.runtimeKind === 'mysql_lab') {
          if (!nodeId) throw new LabError('roadmap_node_missing', '当前单元缺少路线节点', 409)
          const card = json<CaseDesignCard | null>(row.card_snapshot_json, null)
          if (!card) throw new LabError('gym_card_snapshot_missing', '当前 Gym 缺少冻结学习卡片，无法构建案例', 409)
          this.log('mysql_case_started', { buildId: id, learnerId, planUnitId })
          const result = await this.mysql.createCase(learnerId, { roadmapNodeId: nodeId, card, clientRequestId: `gym-case:${id}` })
          this.log('mysql_case_finished', { buildId: id, learnerId, learningCaseId: result.case.id, status: result.case.status })
          if (result.case.status !== 'ready' || result.case.preflightStatus !== 'passed') throw new LabError('gym_case_not_ready', '动态 Gym 案例未通过可用性校验', 503, true)
          learningCaseId = result.case.id
          const caseJob = this.db.prepare('SELECT id FROM case_generation_jobs WHERE learner_id = ? AND learning_case_id = ? ORDER BY created_at DESC LIMIT 1').get(learnerId, learningCaseId) as Row | undefined
          caseGenerationJobId = caseJob ? text(caseJob, 'id') : null
        } else {
          if (!nodeId) throw new LabError('roadmap_node_missing', '当前单元缺少路线节点', 409)
          const node = this.planUnit(learnerId, planId, planUnitId)
          const result = this.workspace.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: `${text(node, 'title')}：${text(node, 'summary')}` }, desiredOutcome: text(node, 'completion_standard'), difficulty: 'applied', clientRequestId: `gym-case:${id}` })
          this.log('workspace_case_finished', { buildId: id, learnerId, learningCaseId: result.case.id, status: result.case.status })
          learningCaseId = result.case.id; caseGenerationJobId = result.job.id
          if (result.case.status !== 'ready') await this.waitForCase(learnerId, learningCaseId, result.job.id)
        }
        const finished = new Date().toISOString()
        this.db.transaction(() => {
          const linked = this.db.prepare('UPDATE plan_units SET learning_case_id = ? WHERE id = ? AND plan_id = ? AND status = \'current\' AND (learning_case_id IS NULL OR learning_case_id = ?)').run(learningCaseId, planUnitId, planId, learningCaseId)
          if (linked.changes === 0) throw new Error('current_plan_unit_changed')
          const updated = this.db.prepare("UPDATE gym_build_jobs SET status = 'ready', learning_case_id = ?, case_generation_job_id = ?, failure_code = NULL, failure_message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'building' AND worker_token = ? AND attempt_count = ?").run(learningCaseId, caseGenerationJobId, finished, finished, id, token, attemptCount)
          if (updated.changes === 0) throw new Error('gym_build_claim_lost')
          const attempt = this.db.prepare("UPDATE gym_build_job_attempts SET status = 'succeeded', completed_at = ? WHERE gym_build_job_id = ? AND attempt_no = ? AND worker_token = ? AND status = 'running'").run(finished, id, attemptCount, token)
          if (attempt.changes === 0) throw new Error('gym_build_attempt_claim_lost')
        })()
        this.log('build_finished', { buildId: id, learnerId, learningCaseId, status: 'ready' })
      } catch (error) {
        const failedAt = new Date().toISOString(); const code = error instanceof LabError ? error.code : 'gym_build_failed'; const message = error instanceof Error ? error.message.slice(0, 500) : 'Gym 构建失败'
        this.db.prepare("UPDATE gym_build_jobs SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'building' AND worker_token = ? AND attempt_count = ?").run(code, message, failedAt, failedAt, id, token, attemptCount)
        if (attemptRecorded) this.db.prepare("UPDATE gym_build_job_attempts SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ? WHERE gym_build_job_id = ? AND attempt_no = ? AND worker_token = ? AND status = 'running'").run(code, message, failedAt, id, attemptCount, token)
        this.log('build_failed', { buildId: id, learnerId, code, message: message.slice(0, 160) })
      }
    })
  }
}
