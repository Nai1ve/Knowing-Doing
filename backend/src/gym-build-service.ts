import { createHash, randomUUID } from 'node:crypto'
import { LabError } from './errors.js'
import { PracticeEnvironmentCatalog, type AgentPracticeEnvironment } from './practice-environment-catalog.js'
import type { CaseGenerationJob, CaseSpec, LearningCase, PracticeRun } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import { CaseWorkspaceService } from './case-workspace-service.js'
import { MySqlDynamicCaseService } from './mysql-dynamic-case-service.js'
import type { DynamicRuntimeStatus } from './planning-types.js'
import type { CaseDesignCard } from './case-design-agent.js'
import { ENVIRONMENT_BUILD_PROTOCOL_VERSION, type EnvironmentBuildAdapterEvent, type EnvironmentBuildFailureCategory, type EnvironmentBuildManifest, type EnvironmentBuildPhase, type EnvironmentBuildStatus, manifestFingerprint, OpenHandsBuildAdapterError, safeBuildDiagnostic, safeBuildText, type OpenHandsBuildAdapter, type OpenHandsMySqlBuildContract } from './environment-build.js'
import { waitForBuildTask } from './openhands-build-adapter.js'
import { resolveEnvironmentCommand } from './environment-registry.js'

type Row = Record<string, unknown>
type BuildStatus = EnvironmentBuildStatus

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
  protocolVersion: number
  currentPhase: EnvironmentBuildPhase | null
  repairRound: number
  failureCategory: EnvironmentBuildFailureCategory | null
  adapterTaskId: string | null
  adapterEventSequence: number
  cleanupDueAt: string | null
  lastCleanupError: string | null
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

export interface GymBuildEvent {
  id: string
  sequence: number
  attemptNo: number
  phase: EnvironmentBuildPhase | 'ready' | 'failed' | 'cleanup_pending' | null
  type: 'phase' | 'tool' | 'docker' | 'diagnostic' | 'status'
  summary: string
  command: string | null
  diagnostic: { code: string; message: string } | null
  resource: { kind: string; id: string; action: string } | null
  createdAt: string
}

export interface GymBuildEventsPage { events: GymBuildEvent[]; nextSequence: number }

export interface GymBuildFailure {
  code: string
  message: string
  category: EnvironmentBuildFailureCategory | null
  source: 'case_preflight' | 'case_generation' | 'build' | 'cleanup'
  canEnterLab: false
}

export interface GymBuildView {
  job: GymBuildJob
  environment: Pick<AgentPracticeEnvironment, 'planningKey' | 'capabilityKey' | 'displayName' | 'agentSummary' | 'runtimeKind' | 'environmentKey' | 'environmentVersion' | 'learningMode'>
  case: LearningCase | null
  caseGeneration: CaseGenerationJob | null
  failure: GymBuildFailure | null
  runtime: { status: DynamicRuntimeStatus; practiceRunId: string | null }
}

export interface EnvironmentBuildOrchestratorOptions {
  adapter?: OpenHandsBuildAdapter | null
  enabled?: boolean
  taskTimeoutMs?: number
  maxRepairRounds?: number
  maxLogBytes?: number
  failureRetentionHours?: number
  workerLeaseMs?: number
  maintenanceIntervalMs?: number
  maxConcurrent?: number
}

export class EnvironmentBuildOrchestrator {
  private readonly catalog: PracticeEnvironmentCatalog
  private readonly locks = new Map<string, Promise<void>>()
  private readonly adapter: OpenHandsBuildAdapter | null
  private readonly enabled: boolean
  private readonly taskTimeoutMs: number
  private readonly maxRepairRounds: number
  private readonly maxLogBytes: number
  private readonly failureRetentionHours: number
  private readonly workerLeaseMs: number
  private readonly maintenanceIntervalMs: number
  private readonly maxConcurrent: number
  private maintenanceTimer: ReturnType<typeof setInterval> | null = null
  private maintenanceRunning = false
  private queueKickScheduled = false

  constructor(private readonly repository: ProductRepository, private readonly workspace: CaseWorkspaceService, private readonly mysql: MySqlDynamicCaseService, options: EnvironmentBuildOrchestratorOptions = {}) {
    this.catalog = new PracticeEnvironmentCatalog(repository.db)
    this.adapter = options.adapter ?? null
    this.enabled = Boolean(options.enabled && this.adapter)
    this.taskTimeoutMs = options.taskTimeoutMs ?? 20 * 60_000
    this.maxRepairRounds = Math.min(3, Math.max(0, options.maxRepairRounds ?? 3))
    this.maxLogBytes = options.maxLogBytes ?? 64 * 1024
    this.failureRetentionHours = options.failureRetentionHours ?? 24
    this.workerLeaseMs = options.workerLeaseMs ?? 10 * 60_000
    this.maintenanceIntervalMs = options.maintenanceIntervalMs ?? 60_000
    // The schema currently has one global lease slot. Keep the explicit
    // option so raising concurrency later requires a deliberate migration.
    this.maxConcurrent = Math.min(1, Math.max(1, options.maxConcurrent ?? 1))
    this.startMaintenance()
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

  /**
   * A build can take minutes and may outlive a web request.  Keep queue draining
   * and failed-resource sweeping independent of request traffic; the timer is
   * unref'd so it never prevents a clean process exit in tests or short jobs.
   */
  private startMaintenance(): void {
    if (this.maintenanceTimer) return
    this.maintenanceTimer = setInterval(() => { void this.maintain() }, this.maintenanceIntervalMs)
    this.maintenanceTimer.unref?.()
  }

  private async maintain(): Promise<void> {
    if (this.maintenanceRunning) return
    this.maintenanceRunning = true
    try {
      this.requeueExpiredWorkers()
      await this.sweepCleanup()
      this.scheduleNextQueuedBuild()
    } catch (error) {
      this.log('maintenance_failed', { error: safeBuildText(error instanceof Error ? error.message : String(error)) })
    } finally {
      this.maintenanceRunning = false
    }
  }

  /** The v1 global build limit is one, enforced by a database lease. */
  private scheduleNextQueuedBuild(): void {
    if (this.maxConcurrent !== 1) return
    if (this.queueKickScheduled) return
    const now = new Date().toISOString()
    const global = this.db.prepare("SELECT gym_build_job_id FROM gym_build_global_locks WHERE lock_name = 'environment-build-v1' AND lease_expires_at > ?").get(now) as Row | undefined
    if (global) return
    const candidate = this.db.prepare(`SELECT j.id
      FROM gym_build_jobs j
      LEFT JOIN gym_build_unit_locks u ON u.plan_unit_id = j.plan_unit_id AND u.lease_expires_at > ?
      WHERE j.status = 'queued' AND (u.plan_unit_id IS NULL OR u.gym_build_job_id = j.id)
      ORDER BY j.created_at ASC LIMIT 1`).get(now) as Row | undefined
    if (!candidate) return
    this.queueKickScheduled = true
    queueMicrotask(() => {
      this.queueKickScheduled = false
      void this.process(text(candidate, 'id'), 'recovery').catch((error) => {
        this.log('queue_drain_failed', { buildId: text(candidate, 'id'), error: safeBuildText(error instanceof Error ? error.message : String(error)) })
      })
    })
  }

  private requeueExpiredWorkers(): void {
    const now = new Date().toISOString()
    const legacyStaleBefore = new Date(Date.now() - this.workerLeaseMs).toISOString()
    this.db.transaction(() => {
      this.db.prepare(`UPDATE gym_build_job_attempts
        SET status = 'interrupted', failure_code = 'worker_lease_expired', failure_message = '构建工作租约已过期，已等待恢复', completed_at = ?
        WHERE status = 'running' AND gym_build_job_id IN (
          SELECT id FROM gym_build_jobs WHERE status = 'running' AND (
            (worker_lease_expires_at IS NOT NULL AND worker_lease_expires_at <= ?)
            OR (worker_lease_expires_at IS NULL AND (started_at IS NULL OR started_at <= ?))
          )
        )`).run(now, now, legacyStaleBefore)
      this.db.prepare(`UPDATE gym_build_jobs
        SET status = 'queued', current_phase = NULL, worker_token = NULL, worker_lease_expires_at = NULL, started_at = NULL, updated_at = ?
        WHERE status = 'running' AND (
          (worker_lease_expires_at IS NOT NULL AND worker_lease_expires_at <= ?)
          OR (worker_lease_expires_at IS NULL AND (started_at IS NULL OR started_at <= ?))
        )`).run(now, now, legacyStaleBefore)
      this.db.prepare('DELETE FROM gym_build_unit_locks WHERE lease_expires_at <= ? OR gym_build_job_id IN (SELECT id FROM gym_build_jobs WHERE status <> \'running\')').run(now)
      this.db.prepare('DELETE FROM gym_build_global_locks WHERE lease_expires_at <= ? OR gym_build_job_id IN (SELECT id FROM gym_build_jobs WHERE status <> \'running\')').run(now)
    })()
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
      protocolVersion: Number(row.protocol_version ?? 0), currentPhase: nullable(row, 'current_phase') as EnvironmentBuildPhase | null, repairRound: Number(row.repair_round ?? 0), failureCategory: nullable(row, 'failure_category') as EnvironmentBuildFailureCategory | null, adapterTaskId: nullable(row, 'adapter_task_id'), adapterEventSequence: Number(row.adapter_event_sequence ?? 0), cleanupDueAt: nullable(row, 'cleanup_due_at'), lastCleanupError: nullable(row, 'last_cleanup_error'),
      learningCaseId: nullable(row, 'learning_case_id'), caseGenerationJobId: nullable(row, 'case_generation_job_id'), attemptCount: Number(row.attempt_count), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), startedAt: nullable(row, 'started_at'), completedAt: nullable(row, 'completed_at'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
    }
  }

  private eventFrom(row: Row): GymBuildEvent {
    return {
      id: text(row, 'id'), sequence: Number(row.sequence), attemptNo: Number(row.attempt_no), phase: nullable(row, 'phase') as GymBuildEvent['phase'], type: text(row, 'type') as GymBuildEvent['type'], summary: text(row, 'summary'), command: nullable(row, 'command_summary'), diagnostic: json<{ code: string; message: string } | null>(row.diagnostic_json, null), resource: json<{ kind: string; id: string; action: string } | null>(row.resource_json, null), createdAt: text(row, 'created_at'),
    }
  }

  private appendEvent(input: { jobId: string; attemptNo: number; phase?: GymBuildEvent['phase']; type: GymBuildEvent['type']; summary: unknown; command?: unknown; diagnostic?: { code: string; message: unknown } | null; resource?: { kind: string; id: string; action: string } | null; adapterEventId?: string | null; createdAt?: string }): void {
    const now = input.createdAt ?? new Date().toISOString()
    const diagnostic = input.diagnostic ? { code: safeBuildText(input.diagnostic.code, 120), message: safeBuildText(input.diagnostic.message) } : null
    const command = input.command == null ? null : safeBuildText(input.command, 600)
    this.db.transaction(() => {
      if (input.adapterEventId) {
        const exists = this.db.prepare('SELECT 1 FROM gym_build_events WHERE gym_build_job_id = ? AND adapter_event_id = ?').get(input.jobId, input.adapterEventId)
        if (exists) return
      }
      const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM gym_build_events WHERE gym_build_job_id = ?').get(input.jobId) as Row
      this.db.prepare(`INSERT INTO gym_build_events(id, gym_build_job_id, attempt_no, sequence, adapter_event_id, phase, type, summary, command_summary, diagnostic_json, resource_json, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        randomUUID(), input.jobId, input.attemptNo, Number(next.sequence), input.adapterEventId ?? null, input.phase ?? null, input.type,
        safeBuildText(input.summary), command, diagnostic ? JSON.stringify(diagnostic) : null, input.resource ? JSON.stringify(input.resource) : null, now,
      )
    })()
  }

  private transition(input: { jobId: string; attemptNo: number; phase: EnvironmentBuildPhase | 'ready' | 'failed' | 'cleanup_pending'; summary: string; workerToken?: string; status?: EnvironmentBuildStatus }): void {
    const terminal = input.phase === 'ready' || input.phase === 'failed' || input.phase === 'cleanup_pending'
    const status = input.status ?? (terminal ? input.phase : 'running')
    const now = new Date().toISOString()
    const where = input.workerToken ? ' AND worker_token = ?' : ''
    const values: unknown[] = [status, terminal ? null : input.phase, now, input.jobId]
    if (input.workerToken) values.push(input.workerToken)
    this.db.prepare(`UPDATE gym_build_jobs SET status = ?, current_phase = ?, updated_at = ? WHERE id = ?${where}`).run(...values)
    this.appendEvent({ jobId: input.jobId, attemptNo: input.attemptNo, phase: input.phase, type: 'phase', summary: input.summary, createdAt: now })
  }

  private appendAdapterEvents(jobId: string, attemptNo: number, events: EnvironmentBuildAdapterEvent[]): void {
    for (const event of events) {
      this.appendEvent({ jobId, attemptNo, phase: event.phase ?? null, type: event.type, summary: event.summary, command: event.command ?? null, diagnostic: event.diagnostic ?? null, resource: event.resource ?? null, adapterEventId: event.id, createdAt: event.createdAt })
    }
  }

  private jobFor(learnerId: string, id: string): GymBuildJob {
    const row = this.db.prepare('SELECT * FROM gym_build_jobs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('gym_build_not_found', 'Gym 构建任务不存在', 404)
    return this.jobFrom(row)
  }

  events(learnerId: string, id: string, afterSequence = 0): GymBuildEventsPage {
    this.jobFor(learnerId, id)
    const cursor = Number.isInteger(afterSequence) && afterSequence >= 0 ? afterSequence : 0
    const rows = this.db.prepare('SELECT * FROM gym_build_events WHERE gym_build_job_id = ? AND sequence > ? ORDER BY sequence ASC LIMIT 100').all(id, cursor) as Row[]
    const events = rows.map((row) => this.eventFrom(row))
    return { events, nextSequence: events.length > 0 ? events[events.length - 1].sequence : cursor }
  }

  private caseFor(learnerId: string, id: string | null): LearningCase | null {
    return id ? this.repository.getLearningCaseForLearner(id, learnerId) : null
  }

  private caseReady(learnerId: string, id: string, runtimeKind: GymBuildJob['runtimeKind']): boolean {
    const row = this.db.prepare('SELECT status, preflight_status FROM learning_cases WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row || text(row, 'status') !== 'ready') return false
    return runtimeKind !== 'mysql_lab' || text(row, 'preflight_status') === 'passed'
  }

  private failureFor(job: GymBuildJob, item: LearningCase | null, caseGeneration: CaseGenerationJob | null): GymBuildFailure | null {
    if (item?.failureMessage) {
      const source = item.preflightStatus === 'failed' || item.failureCode === 'mysql_preflight_failed' || item.failureCode === 'mysql_case_preflight_failed' ? 'case_preflight' : 'case_generation'
      return { code: item.failureCode ?? 'case_build_failed', message: safeBuildText(item.failureMessage, 500), category: job.failureCategory, source, canEnterLab: false }
    }
    if (caseGeneration?.failureMessage) return { code: caseGeneration.failureCode ?? 'case_generation_failed', message: safeBuildText(caseGeneration.failureMessage, 500), category: job.failureCategory, source: 'case_generation', canEnterLab: false }
    if (job.failureMessage) return { code: job.failureCode ?? 'gym_build_failed', message: safeBuildText(job.failureMessage, 500), category: job.failureCategory, source: 'build', canEnterLab: false }
    if (job.lastCleanupError) return { code: 'cleanup_failed', message: safeBuildText(job.lastCleanupError, 500), category: job.failureCategory, source: 'cleanup', canEnterLab: false }
    return null
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
    const item = this.caseFor(learnerId, job.learningCaseId)
    const failure = this.failureFor(job, item, caseGeneration)
    const practice = this.repository.findActivePracticeForUnit(learnerId, job.planUnitId)
    // A MySQL scheduler must never be asked to inspect a Docker workspace.
    const runtime: { status: DynamicRuntimeStatus; practiceRunId: string | null } = !practice?.learningCaseId
      ? { status: 'none', practiceRunId: practice?.id ?? null }
      : job.runtimeKind === 'mysql_lab'
        ? { status: this.mysql.runtimeStatusForPractice(practice), practiceRunId: practice.id }
        : { status: 'none', practiceRunId: practice.id }
      return { job, environment, case: item, caseGeneration, failure, runtime }
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
    const inputFingerprint = fingerprint({ protocol: `environment-build-v${ENVIRONMENT_BUILD_PROTOCOL_VERSION}`, planId, planUnitId, roadmapNodeId: nullable(row, 'roadmap_node_id'), capabilityKey: environment.capabilityKey, cardSnapshot })
    const now = new Date().toISOString()
    const persisted = this.db.transaction(() => {
      const byRequest = this.db.prepare('SELECT id, input_fingerprint FROM gym_build_jobs WHERE learner_id = ? AND plan_unit_id = ? AND client_request_id = ?').get(learnerId, planUnitId, clientRequestId) as Row | undefined
      if (byRequest) {
        if (text(byRequest, 'input_fingerprint') !== inputFingerprint) throw new LabError('idempotency_conflict', 'clientRequestId 已对应另一份 Gym 构建请求', 409)
        return { id: text(byRequest, 'id'), created: false }
      }
      const byInput = this.db.prepare('SELECT id FROM gym_build_jobs WHERE learner_id = ? AND plan_unit_id = ? AND input_fingerprint = ? ORDER BY created_at DESC LIMIT 1').get(learnerId, planUnitId, inputFingerprint) as Row | undefined
      if (byInput) return { id: text(byInput, 'id'), created: false }
      const existingCaseId = nullable(row, 'learning_case_id')
      const caseReady = existingCaseId ? this.caseReady(learnerId, existingCaseId, environment.runtimeKind) : false
      const id = randomUUID()
      this.db.prepare(`INSERT INTO gym_build_jobs(id, learner_id, plan_id, plan_unit_id, roadmap_node_id, client_request_id, input_fingerprint, capability_key, exercise_profile_key, card_snapshot_json, environment_key, environment_version, runtime_kind, status, protocol_version, current_phase, learning_case_id, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 0, ?, ?)`).run(id, learnerId, planId, planUnitId, nullable(row, 'roadmap_node_id'), clientRequestId, inputFingerprint, environment.capabilityKey, exerciseProfileKey, JSON.stringify(cardSnapshot), environment.environmentKey, environment.environmentVersion, environment.runtimeKind, caseReady ? 'ready' : 'queued', ENVIRONMENT_BUILD_PROTOCOL_VERSION, caseReady ? existingCaseId : null, now, now)
      return { id, created: true }
    })()
    if (persisted.created) this.appendEvent({ jobId: persisted.id, attemptNo: 0, type: 'status', summary: 'Gym 环境构建已进入队列' })
    const result = this.view(learnerId, persisted.id)
    if (result.job.status === 'queued') void this.process(persisted.id, 'create').catch((error) => console.error('[zhixing-gym] build_unhandled', { buildId: persisted.id, error: error instanceof Error ? error.message : String(error) }))
    return result
  }

  get(learnerId: string, id: string): GymBuildView { return this.view(learnerId, id) }

  retry(learnerId: string, id: string): GymBuildView {
    const job = this.jobFor(learnerId, id)
    if (['queued', 'running', 'cleanup_pending'].includes(job.status)) return this.view(learnerId, id)
    if (job.status === 'ready') return this.view(learnerId, id)
    const now = new Date().toISOString()
    const changed = this.db.prepare("UPDATE gym_build_jobs SET status = 'queued', current_phase = NULL, repair_round = 0, failure_code = NULL, failure_message = NULL, failure_category = NULL, adapter_task_id = NULL, adapter_event_sequence = 0, completed_at = NULL, worker_token = NULL, worker_lease_expires_at = NULL, cleanup_due_at = NULL, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'failed'").run(now, id, learnerId)
    if (changed.changes === 0) return this.view(learnerId, id)
      void this.process(id, 'retry').catch((error) => console.error('[zhixing-gym] retry_unhandled', { buildId: id, error: error instanceof Error ? error.message : String(error) }))
    return this.view(learnerId, id)
  }

  async start(learnerId: string, id: string): Promise<unknown> {
    return this.withLock(`start:${learnerId}:${id}`, async () => {
      const view = this.view(learnerId, id)
      const mysqlPreflightPassed = view.job.runtimeKind !== 'mysql_lab' || view.case?.preflightStatus === 'passed'
      if (view.job.status !== 'ready' || !view.job.learningCaseId || !view.case || view.case.status !== 'ready' || !mysqlPreflightPassed) {
        if (view.failure) throw new LabError(view.failure.code, view.failure.message, 409, true)
        throw new LabError('gym_build_not_ready', 'Gym 案例尚未准备完成', 409, true)
      }
      this.planUnit(learnerId, view.job.planId, view.job.planUnitId)
      if (view.job.runtimeKind === 'mysql_lab') return { kind: 'mysql_lab', ...(await this.mysql.startPractice(learnerId, view.job.learningCaseId, view.job.planUnitId)) }
      const workspace = await this.workspace.startPractice(learnerId, view.job.learningCaseId, view.job.planUnitId)
      return { kind: 'docker_workspace', workspace }
    })
  }

  async resume(): Promise<void> {
    await this.supersedeEmptyLegacyGymRuns()
    await this.supersedeLegacyFailedExplainCases()
    await this.recoverAdapterTasks()
    this.requeueExpiredWorkers()
    await this.sweepCleanup()
    this.scheduleNextQueuedBuild()
  }

  /**
   * A product-process restart must not assume an OpenHands task disappeared.
   * We first consume its persisted cursor, then hand the same task back to the
   * queue. `buildWithAdapter` attaches to it instead of creating a duplicate.
   */
  private async recoverAdapterTasks(): Promise<void> {
    if (!this.adapter) return
    const rows = this.db.prepare("SELECT * FROM gym_build_jobs WHERE status = 'running' AND adapter_task_id IS NOT NULL ORDER BY updated_at ASC LIMIT 20").all() as Row[]
    for (const row of rows) {
      const job = this.jobFrom(row)
      if (!job.adapterTaskId) continue
      try {
        const batch = await this.adapter.events(job.adapterTaskId, job.adapterEventSequence)
        this.appendAdapterEvents(job.id, job.attemptCount, batch.events)
        if (batch.nextSequence > job.adapterEventSequence) this.db.prepare('UPDATE gym_build_jobs SET adapter_event_sequence = ?, updated_at = ? WHERE id = ? AND adapter_task_id = ?').run(batch.nextSequence, new Date().toISOString(), job.id, job.adapterTaskId)
        const remote = await this.adapter.status(job.adapterTaskId)
        const now = new Date().toISOString()
        const keepTask = remote.status === 'queued' || remote.status === 'running' || remote.status === 'succeeded'
        this.db.transaction(() => {
          this.db.prepare("UPDATE gym_build_job_attempts SET status = 'interrupted', failure_code = 'service_restarted', failure_message = '产品服务重启，构建由恢复工作者接续', completed_at = ? WHERE gym_build_job_id = ? AND status = 'running'").run(now, job.id)
          this.db.prepare(`UPDATE gym_build_jobs
            SET status = 'queued', current_phase = NULL, worker_token = NULL, worker_lease_expires_at = NULL, started_at = NULL,
              adapter_task_id = CASE WHEN ? THEN adapter_task_id ELSE NULL END,
              adapter_event_sequence = CASE WHEN ? THEN adapter_event_sequence ELSE 0 END,
              updated_at = ?
            WHERE id = ? AND status = 'running' AND adapter_task_id = ?`).run(keepTask ? 1 : 0, keepTask ? 1 : 0, now, job.id, job.adapterTaskId)
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE gym_build_job_id = ?').run(job.id)
          this.db.prepare('DELETE FROM gym_build_global_locks WHERE gym_build_job_id = ?').run(job.id)
        })()
        this.appendEvent({
          jobId: job.id,
          attemptNo: job.attemptCount,
          type: keepTask ? 'status' : 'diagnostic',
          summary: keepTask ? '服务恢复：已接续已有 OpenHands 构建任务' : '服务恢复：前一 OpenHands 任务未完成，已安排新的构建任务',
          diagnostic: keepTask ? null : { code: remote.failure?.code ?? 'case_builder_task_interrupted', message: remote.failure?.message ?? 'OpenHands 任务已取消或失败' },
        })
      } catch (error) {
        const now = new Date().toISOString()
        const code = error instanceof OpenHandsBuildAdapterError ? error.code : 'case_builder_recovery_failed'
        const message = safeBuildText(error instanceof Error ? error.message : 'Case Builder 恢复失败', 500)
        const lease = json<{ attemptId?: string }>(row.resource_lease_json, {})
        this.db.transaction(() => {
          this.db.prepare("UPDATE gym_build_jobs SET status = 'failed', current_phase = NULL, failure_code = ?, failure_message = ?, failure_category = 'platform_fault', completed_at = ?, worker_token = NULL, worker_lease_expires_at = NULL, cleanup_due_at = ?, resource_lease_json = ?, updated_at = ? WHERE id = ? AND status = 'running' AND adapter_task_id = ?").run(code, message, now, this.adapter ? new Date(Date.now() + this.failureRetentionHours * 60 * 60_000).toISOString() : null, JSON.stringify({ attemptId: lease.attemptId ?? null, terminalStatus: 'failed' }), now, job.id, job.adapterTaskId)
          this.db.prepare("UPDATE gym_build_job_attempts SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ? WHERE gym_build_job_id = ? AND status = 'running'").run(code, message, now, job.id)
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE gym_build_job_id = ?').run(job.id)
          this.db.prepare('DELETE FROM gym_build_global_locks WHERE gym_build_job_id = ?').run(job.id)
        })()
        this.appendEvent({ jobId: job.id, attemptNo: job.attemptCount, phase: 'failed', type: 'diagnostic', summary: '构建恢复失败', diagnostic: { code, message } })
      }
    }
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

  /** Old failed explain cases never reached user interaction and are safe to replace. */
  private async supersedeLegacyFailedExplainCases(): Promise<void> {
    const rows = this.db.prepare(`SELECT u.id AS plan_unit_id, p.id AS plan_id, p.learner_id, c.id AS learning_case_id
      FROM plan_units u
      INNER JOIN learning_plans p ON p.id = u.plan_id
      INNER JOIN roadmap_nodes n ON n.id = u.roadmap_node_id
      INNER JOIN learning_cases c ON c.id = u.learning_case_id
      WHERE p.status IN ('confirmed', 'active') AND u.status = 'current' AND u.availability = 'available'
        AND n.capability_key = 'mysql.explain-plan' AND c.status = 'failed'
        AND (c.case_spec_json = '{}' OR c.input_snapshot_json LIKE '%mysql-direct-v1%')
        AND NOT EXISTS (SELECT 1 FROM practice_runs r INNER JOIN artifacts a ON a.practice_run_id = r.id WHERE r.learning_case_id = c.id)
        AND NOT EXISTS (SELECT 1 FROM practice_runs r INNER JOIN practice_events e ON e.practice_run_id = r.id WHERE r.learning_case_id = c.id AND e.actor IN ('user', 'tutor', 'lab', 'workspace'))
        AND NOT EXISTS (SELECT 1 FROM gym_build_jobs j WHERE j.plan_unit_id = u.id AND j.protocol_version = ?)
      ORDER BY c.updated_at ASC LIMIT 1`).all(ENVIRONMENT_BUILD_PROTOCOL_VERSION) as Row[]
    for (const row of rows) {
      const now = new Date().toISOString()
      this.db.transaction(() => {
        this.db.prepare("UPDATE learning_cases SET status = 'superseded', failure_code = 'legacy_gym_superseded', failure_message = '旧 EXPLAIN Gym 已由环境构建协议替代', updated_at = ? WHERE id = ? AND status = 'failed'").run(now, text(row, 'learning_case_id'))
        this.db.prepare('UPDATE plan_units SET learning_case_id = NULL WHERE id = ? AND learning_case_id = ?').run(text(row, 'plan_unit_id'), text(row, 'learning_case_id'))
      })()
      this.create(text(row, 'learner_id'), text(row, 'plan_id'), text(row, 'plan_unit_id'), `legacy-rebuild:${text(row, 'learning_case_id')}`)
    }
  }

  private async sweepCleanup(): Promise<void> {
    if (!this.adapter) return
    const now = new Date().toISOString()
    const rows = this.db.prepare("SELECT * FROM gym_build_jobs WHERE cleanup_due_at IS NOT NULL AND cleanup_due_at <= ? AND status IN ('failed', 'cleanup_pending') ORDER BY cleanup_due_at ASC LIMIT 20").all(now) as Row[]
    for (const row of rows) {
      const job = this.jobFrom(row)
      const lease = json<{ attemptId?: string; terminalStatus?: 'ready' | 'failed' }>(row.resource_lease_json, {})
      try {
        await this.adapter.cleanup({ buildId: job.id, attemptId: lease.attemptId ?? null, retainRuntimeArtifact: lease.terminalStatus === 'ready' })
        const restored = lease.terminalStatus ?? 'failed'
        this.db.prepare('UPDATE gym_build_jobs SET status = ?, current_phase = NULL, cleanup_due_at = NULL, last_cleanup_error = NULL, resource_lease_json = ?, updated_at = ? WHERE id = ?').run(restored, JSON.stringify({}), new Date().toISOString(), job.id)
        this.appendEvent({ jobId: job.id, attemptNo: job.attemptCount, phase: restored, type: 'docker', summary: '保留期已到，构建临时资源已清理' })
      } catch (error) {
        const message = safeBuildText(error instanceof Error ? error.message : '构建资源清理失败')
        const retryAt = new Date(Date.now() + 5 * 60_000).toISOString()
        this.db.prepare("UPDATE gym_build_jobs SET status = 'cleanup_pending', current_phase = NULL, last_cleanup_error = ?, cleanup_due_at = ?, updated_at = ? WHERE id = ?").run(message, retryAt, new Date().toISOString(), job.id)
        this.appendEvent({ jobId: job.id, attemptNo: job.attemptCount, phase: 'cleanup_pending', type: 'diagnostic', summary: '构建资源清理待重试', diagnostic: { code: 'cleanup_failed', message } })
      }
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

  private linkLearningCase(input: { jobId: string; learnerId: string; planId: string; planUnitId: string; learningCaseId: string; caseGenerationJobId?: string | null }): void {
    const now = new Date().toISOString()
    this.db.transaction(() => {
      const linked = this.db.prepare("UPDATE plan_units SET learning_case_id = ? WHERE id = ? AND plan_id = ? AND status = 'current' AND (learning_case_id IS NULL OR learning_case_id = ?)").run(input.learningCaseId, input.planUnitId, input.planId, input.learningCaseId)
      if (linked.changes === 0) throw new LabError('current_plan_unit_changed', '当前学习单元已切换，不能关联新的 Gym 案例', 409)
      this.db.prepare('UPDATE gym_build_jobs SET learning_case_id = ?, case_generation_job_id = COALESCE(?, case_generation_job_id), updated_at = ? WHERE id = ? AND learner_id = ?').run(input.learningCaseId, input.caseGenerationJobId ?? null, now, input.jobId, input.learnerId)
    })()
  }

  private failureCategory(error: unknown): EnvironmentBuildFailureCategory {
    if (error instanceof OpenHandsBuildAdapterError) return error.category
    const code = error instanceof LabError ? error.code : error instanceof Error ? error.message : 'unknown'
    if (/case_builder|runner_|docker_|socket|credential|authentication|state_machine|claim_lost|service_restarted/i.test(code)) return 'platform_fault'
    if (/case_design|model|agent/i.test(code)) return 'agent_failure'
    return 'preflight_failure'
  }

  private assertManifest(job: GymBuildJob, manifest: EnvironmentBuildManifest, attemptId: string, mysqlContract: OpenHandsMySqlBuildContract | null): void {
    if (manifest.runtimeKind !== job.runtimeKind || manifest.environment.key !== job.environmentKey || manifest.environment.version !== job.environmentVersion) throw new OpenHandsBuildAdapterError('manifest_environment_mismatch', 'OpenHands Manifest 与当前 Gym 环境不一致', 'agent_failure')
    if (manifest.verification.commandKeys.some((key) => !resolveEnvironmentCommand(job.environmentKey, job.environmentVersion, key))) throw new OpenHandsBuildAdapterError('manifest_command_not_allowed', 'OpenHands Manifest 包含未授权验证命令', 'agent_failure')
    if (new Set(manifest.starterFiles.map((file) => file.path)).size !== manifest.starterFiles.length || new Set(manifest.referenceFiles.map((file) => file.path)).size !== manifest.referenceFiles.length) throw new OpenHandsBuildAdapterError('manifest_duplicate_files', 'OpenHands Manifest 包含重复文件路径', 'agent_failure')
    const manifestFiles = [...manifest.starterFiles, ...manifest.referenceFiles]
    const fileBytes = manifestFiles.reduce((total, file) => total + Buffer.byteLength(file.content, 'utf8'), 0)
    if (fileBytes > 2 * 1024 * 1024 || manifestFiles.some((file) => file.path.startsWith('/') || file.path.includes('..') || file.path.includes('\\') || Buffer.byteLength(file.content, 'utf8') > 256 * 1024 || (manifest.runtimeKind === 'docker_workspace' && !/\.(py|json|md|txt)$/.test(file.path)))) throw new OpenHandsBuildAdapterError('manifest_asset_boundary_invalid', 'OpenHands Manifest 包含越界的环境资产', 'agent_failure')
    for (const resource of manifest.resources) {
      if (resource.labels['zhixing.case-build'] !== job.id) throw new OpenHandsBuildAdapterError('manifest_resource_label_missing', 'OpenHands 资源缺少当前构建标签', 'agent_failure')
      if (resource.labels['zhixing.case-attempt'] !== attemptId || resource.labels['zhixing.protocol-version'] !== String(ENVIRONMENT_BUILD_PROTOCOL_VERSION) || resource.labels['zhixing.resource-role'] !== resource.role) throw new OpenHandsBuildAdapterError('manifest_resource_label_invalid', 'OpenHands 资源标签与当前构建不一致', 'agent_failure')
    }
    const runtimeImage = manifest.resources.find((resource) => resource.kind === 'image' && resource.role === 'runtime_artifact')
    if (!runtimeImage || runtimeImage.labels['zhixing.runtime-kind'] !== job.runtimeKind || runtimeImage.labels['zhixing.runtime-image-digest'] !== manifest.environment.runtimeImageDigest || runtimeImage.labels['zhixing.environment-key'] !== job.environmentKey || runtimeImage.labels['zhixing.environment-version'] !== job.environmentVersion) throw new OpenHandsBuildAdapterError('manifest_runtime_artifact_missing', 'OpenHands Manifest 缺少已标记的运行时镜像产物', 'agent_failure')
    if (job.runtimeKind === 'mysql_lab') {
      if (!mysqlContract || !manifest.mysql) throw new OpenHandsBuildAdapterError('manifest_mysql_contract_missing', 'MySQL Manifest 缺少服务端冻结的案例契约', 'agent_failure')
      if (manifest.mysql.contractFingerprint !== mysqlContract.materializationFingerprint || manifest.mysql.starterExplain !== mysqlContract.starterExplain || manifest.mysql.referenceSql.length !== 1 || manifest.mysql.referenceSql[0] !== mysqlContract.referenceSql || !manifest.mysql.initializationSql.includes(mysqlContract.schemaSql) || !manifest.mysql.initializationSql.includes(mysqlContract.faultSql)) throw new OpenHandsBuildAdapterError('manifest_mysql_contract_mismatch', 'MySQL Manifest 与当前案例物料不一致', 'agent_failure')
      if (runtimeImage.labels['zhixing.mysql-contract-fingerprint'] !== mysqlContract.materializationFingerprint) throw new OpenHandsBuildAdapterError('manifest_mysql_artifact_contract_missing', 'MySQL 运行时镜像缺少案例物料标签', 'agent_failure')
    }
  }

  private async buildWithAdapter(input: { job: GymBuildJob; card: CaseDesignCard; environment: AgentPracticeEnvironment; attemptId: string; mysqlContract: OpenHandsMySqlBuildContract | null; diagnostic: ReturnType<typeof safeBuildDiagnostic> | null }): Promise<EnvironmentBuildManifest | null> {
    if (!this.enabled || !this.adapter) return null
    const current = this.jobFor(input.job.learnerId, input.job.id)
    let taskId = current.adapterTaskId
    const afterSequence = current.adapterEventSequence
    if (!taskId) {
      const task = await this.adapter.createTask({
        buildId: input.job.id,
        attemptId: input.attemptId,
        protocolVersion: ENVIRONMENT_BUILD_PROTOCOL_VERSION,
        runtimeKind: input.job.runtimeKind,
        card: input.card as unknown as Record<string, unknown>,
        learnerProfile: input.card.learnerProfile.map((item) => ({ ...item })),
        environment: { capabilityKey: input.environment.capabilityKey, environmentKey: input.environment.environmentKey, environmentVersion: input.environment.environmentVersion, displayName: input.environment.displayName, agentSummary: input.environment.agentSummary },
        successCriteria: { commandKeys: input.environment.runtimeKind === 'docker_workspace' ? ['pytest_quiet'] : ['explain'], successSignals: input.environment.runtimeKind === 'docker_workspace' ? ['pytest'] : ['key', 'rows'] },
        mysqlContract: input.mysqlContract,
        repairDiagnostic: input.diagnostic,
        limits: { maxRepairRounds: this.maxRepairRounds, timeoutMs: this.taskTimeoutMs, maxLogBytes: this.maxLogBytes },
      })
      taskId = task.taskId
      this.db.prepare('UPDATE gym_build_jobs SET adapter_task_id = ?, adapter_event_sequence = 0, updated_at = ? WHERE id = ?').run(taskId, new Date().toISOString(), input.job.id)
      this.appendEvent({ jobId: input.job.id, attemptNo: input.job.attemptCount, phase: 'designing', type: 'tool', summary: input.diagnostic ? `OpenHands 开始第 ${input.diagnostic.repairRound} 轮修复` : 'OpenHands 开始设计与构建环境', command: 'openhands environment-build' })
    } else {
      this.appendEvent({ jobId: input.job.id, attemptNo: input.job.attemptCount, phase: 'designing', type: 'status', summary: '已接续服务重启前的 OpenHands 构建任务' })
    }
    const result = await waitForBuildTask(this.adapter, taskId, {
      timeoutMs: this.taskTimeoutMs,
      afterSequence,
      onEvents: async (events) => {
        this.appendAdapterEvents(input.job.id, input.job.attemptCount, events)
        const sequence = events.length > 0 ? events[events.length - 1].sequence : 0
        if (sequence > 0) this.db.prepare('UPDATE gym_build_jobs SET adapter_event_sequence = MAX(adapter_event_sequence, ?), updated_at = ? WHERE id = ?').run(sequence, new Date().toISOString(), input.job.id)
      },
    })
    if (result.status !== 'succeeded' || !result.manifest) {
      const failure = result.failure ?? { code: 'openhands_build_failed', message: 'OpenHands 未生成可用环境' }
      throw new OpenHandsBuildAdapterError(failure.code, failure.message, failure.category ?? 'agent_failure')
    }
    this.assertManifest(input.job, result.manifest, input.attemptId, input.mysqlContract)
    this.db.prepare('UPDATE gym_build_jobs SET manifest_json = ?, manifest_fingerprint = ?, resource_lease_json = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(result.manifest), manifestFingerprint(result.manifest), JSON.stringify({ attemptId: input.attemptId, terminalStatus: 'failed' }), new Date().toISOString(), input.job.id)
    return result.manifest
  }

  private async runRuntimeDriver(input: { job: GymBuildJob; environment: AgentPracticeEnvironment; card: CaseDesignCard; deferMySqlPreflight?: boolean }): Promise<{ learningCaseId: string; caseGenerationJobId: string | null }> {
    const existing = this.jobFor(input.job.learnerId, input.job.id)
    if (existing.learningCaseId && this.caseReady(input.job.learnerId, existing.learningCaseId, input.environment.runtimeKind)) return { learningCaseId: existing.learningCaseId, caseGenerationJobId: existing.caseGenerationJobId }
    if (!input.job.roadmapNodeId) throw new LabError('roadmap_node_missing', '当前单元缺少路线节点', 409)
    if (input.environment.runtimeKind === 'mysql_lab') {
      const result = await this.mysql.createCase(input.job.learnerId, {
        roadmapNodeId: input.job.roadmapNodeId,
        card: input.card,
        clientRequestId: `gym-case:${input.job.id}`,
        deferPreflight: input.deferMySqlPreflight,
        gymBuildLink: { gymBuildJobId: input.job.id, planId: input.job.planId, planUnitId: input.job.planUnitId },
      })
      if (!input.deferMySqlPreflight && (result.case.status !== 'ready' || result.case.preflightStatus !== 'passed')) throw new LabError('gym_case_not_ready', '动态 MySQL Gym 未通过独立预检', 503, true)
      const caseJob = this.db.prepare('SELECT id FROM case_generation_jobs WHERE learner_id = ? AND learning_case_id = ? ORDER BY created_at DESC LIMIT 1').get(input.job.learnerId, result.case.id) as Row | undefined
      this.linkLearningCase({ jobId: input.job.id, learnerId: input.job.learnerId, planId: input.job.planId, planUnitId: input.job.planUnitId, learningCaseId: result.case.id, caseGenerationJobId: caseJob ? text(caseJob, 'id') : null })
      return { learningCaseId: result.case.id, caseGenerationJobId: caseJob ? text(caseJob, 'id') : null }
    }
    if (existing.learningCaseId && existing.caseGenerationJobId) {
      const retry = this.workspace.retryCaseGeneration(input.job.learnerId, existing.caseGenerationJobId)
      const ready = retry.case.status === 'ready' ? retry.case : await this.waitForCase(input.job.learnerId, retry.case.id, retry.job.id)
      return { learningCaseId: ready.id, caseGenerationJobId: retry.job.id }
    }
    const node = this.planUnit(input.job.learnerId, input.job.planId, input.job.planUnitId)
    const created = this.workspace.createCaseRequest(input.job.learnerId, { roadmapNodeId: input.job.roadmapNodeId, input: { kind: 'brief', brief: `${text(node, 'title')}：${text(node, 'summary')}` }, desiredOutcome: text(node, 'completion_standard'), difficulty: 'applied', clientRequestId: `gym-case:${input.job.id}` }, { gymBuildLink: { gymBuildJobId: input.job.id, planId: input.job.planId, planUnitId: input.job.planUnitId } })
    this.linkLearningCase({ jobId: input.job.id, learnerId: input.job.learnerId, planId: input.job.planId, planUnitId: input.job.planUnitId, learningCaseId: created.case.id, caseGenerationJobId: created.job.id })
    const ready = created.case.status === 'ready' ? created.case : await this.waitForCase(input.job.learnerId, created.case.id, created.job.id)
    return { learningCaseId: ready.id, caseGenerationJobId: created.job.id }
  }

  private bindRuntime(job: GymBuildJob, learningCaseId: string, manifest: EnvironmentBuildManifest | null, attemptId: string, mysqlContract: OpenHandsMySqlBuildContract | null): void {
    if (!manifest) return
    const now = new Date().toISOString()
    this.db.prepare(`INSERT INTO environment_runtime_bindings(id, learner_id, learning_case_id, gym_build_job_id, runtime_kind, runtime_image_digest, runtime_image_ref, manifest_fingerprint, resource_lease_json, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', ?, ?)
      ON CONFLICT(learning_case_id) DO UPDATE SET gym_build_job_id = excluded.gym_build_job_id, runtime_kind = excluded.runtime_kind, runtime_image_digest = excluded.runtime_image_digest, runtime_image_ref = excluded.runtime_image_ref, manifest_fingerprint = excluded.manifest_fingerprint, resource_lease_json = excluded.resource_lease_json, status = 'ready', updated_at = excluded.updated_at`).run(
      randomUUID(), job.learnerId, learningCaseId, job.id, job.runtimeKind, manifest.environment.runtimeImageDigest, manifest.environment.runtimeImageRef ?? manifest.environment.runtimeImageDigest, manifestFingerprint(manifest), JSON.stringify({ attemptId, ...(mysqlContract ? { database: mysqlContract.database, mysqlContractFingerprint: mysqlContract.materializationFingerprint } : {}) }), now, now,
    )
  }

  /**
   * The user-visible workspace must be the exact starter/reference pair that
   * was independently preflighted in the bound image.  This is intentionally
   * server-side: the browser never receives the private reference assets.
   */
  private applyWorkspaceManifestAssets(job: GymBuildJob, learningCaseId: string, manifest: EnvironmentBuildManifest): void {
    if (manifest.runtimeKind !== 'docker_workspace') return
    const row = this.db.prepare('SELECT case_spec_json FROM learning_cases WHERE id = ? AND learner_id = ? AND status = \'ready\'').get(learningCaseId, job.learnerId) as Row | undefined
    const current = row ? json<CaseSpec | null>(row.case_spec_json, null) : null
    if (!current) throw new OpenHandsBuildAdapterError('workspace_case_assets_missing', 'Python Gym 案例缺少可替换的服务端资产', 'platform_fault')
    const commands = [...new Set(manifest.verification.commandKeys.map((key) => resolveEnvironmentCommand(manifest.environment.key, manifest.environment.version, key)))]
    if (commands.some((command): command is null => command === null)) throw new OpenHandsBuildAdapterError('manifest_command_not_allowed', 'OpenHands Manifest 包含未授权验证命令', 'agent_failure')
    const updated: CaseSpec = {
      ...current,
      starterFiles: manifest.starterFiles.map((file) => ({ ...file })),
      verification: { commands: commands as string[], successSignals: [...manifest.verification.successSignals] },
    }
    const reference = { files: manifest.referenceFiles.map((file) => ({ ...file })), verificationCommands: commands as string[] }
    this.db.prepare('UPDATE learning_cases SET case_spec_json = ?, reference_solution_json = ?, updated_at = ? WHERE id = ? AND learner_id = ? AND status = \'ready\'').run(JSON.stringify(updated), JSON.stringify(reference), new Date().toISOString(), learningCaseId, job.learnerId)
  }

  private async process(id: string, trigger: 'create' | 'retry' | 'recovery' | 'legacy_rebuild'): Promise<void> {
    try {
      await this.withLock(`build:${id}`, async () => {
      const token = randomUUID()
      const now = new Date().toISOString()
      const leaseExpiresAt = new Date(Date.now() + Math.max(this.workerLeaseMs, this.taskTimeoutMs + 60_000)).toISOString()
      const claimed = this.db.transaction(() => {
        const candidate = this.db.prepare("SELECT id, plan_unit_id FROM gym_build_jobs WHERE id = ? AND status = 'queued'").get(id) as Row | undefined
        if (!candidate) return false
        const existing = this.db.prepare('SELECT gym_build_job_id, lease_expires_at FROM gym_build_unit_locks WHERE plan_unit_id = ?').get(text(candidate, 'plan_unit_id')) as Row | undefined
        if (existing && text(existing, 'gym_build_job_id') !== id && text(existing, 'lease_expires_at') > now) return false
        this.db.prepare('INSERT INTO gym_build_unit_locks(plan_unit_id, gym_build_job_id, worker_token, lease_expires_at, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(plan_unit_id) DO UPDATE SET gym_build_job_id = excluded.gym_build_job_id, worker_token = excluded.worker_token, lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at').run(text(candidate, 'plan_unit_id'), id, token, leaseExpiresAt, now)
        const global = this.db.prepare("SELECT gym_build_job_id, lease_expires_at FROM gym_build_global_locks WHERE lock_name = 'environment-build-v1'").get() as Row | undefined
        if (global && text(global, 'gym_build_job_id') !== id && text(global, 'lease_expires_at') > now) {
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE plan_unit_id = ? AND gym_build_job_id = ? AND worker_token = ?').run(text(candidate, 'plan_unit_id'), id, token)
          return false
        }
        const globalClaim = this.db.prepare(`INSERT INTO gym_build_global_locks(lock_name, gym_build_job_id, worker_token, lease_expires_at, updated_at)
          VALUES ('environment-build-v1', ?, ?, ?, ?)
          ON CONFLICT(lock_name) DO UPDATE SET gym_build_job_id = excluded.gym_build_job_id, worker_token = excluded.worker_token, lease_expires_at = excluded.lease_expires_at, updated_at = excluded.updated_at
          WHERE gym_build_global_locks.lease_expires_at <= excluded.updated_at OR gym_build_global_locks.gym_build_job_id = excluded.gym_build_job_id`).run(id, token, leaseExpiresAt, now)
        if (globalClaim.changes === 0) {
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE plan_unit_id = ? AND gym_build_job_id = ? AND worker_token = ?').run(text(candidate, 'plan_unit_id'), id, token)
          return false
        }
        const update = this.db.prepare("UPDATE gym_build_jobs SET status = 'running', current_phase = 'designing', attempt_count = attempt_count + 1, worker_token = ?, worker_lease_expires_at = ?, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(token, leaseExpiresAt, now, now, id)
        if (update.changes === 0) {
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE plan_unit_id = ? AND gym_build_job_id = ? AND worker_token = ?').run(text(candidate, 'plan_unit_id'), id, token)
          this.db.prepare('DELETE FROM gym_build_global_locks WHERE lock_name = ? AND gym_build_job_id = ? AND worker_token = ?').run('environment-build-v1', id, token)
          return false
        }
        return true
      })()
      if (!claimed) return
      const row = this.db.prepare('SELECT * FROM gym_build_jobs WHERE id = ? AND worker_token = ?').get(id, token) as Row | undefined
      if (!row) {
        this.db.prepare('DELETE FROM gym_build_unit_locks WHERE gym_build_job_id = ? AND worker_token = ?').run(id, token)
        this.db.prepare('DELETE FROM gym_build_global_locks WHERE lock_name = ? AND gym_build_job_id = ? AND worker_token = ?').run('environment-build-v1', id, token)
        return
      }
      const job = this.jobFrom(row)
      const persistedLease = json<{ attemptId?: string }>(row.resource_lease_json, {})
      // A resumed worker must validate the remote task against the labels used
      // by the original worker, rather than inventing a new attempt id.
      const attemptId = job.adapterTaskId && persistedLease.attemptId ? persistedLease.attemptId : randomUUID()
      this.db.prepare('UPDATE gym_build_jobs SET resource_lease_json = ?, updated_at = ? WHERE id = ? AND worker_token = ?').run(JSON.stringify({ ...persistedLease, attemptId, terminalStatus: 'failed' }), new Date().toISOString(), id, token)
      let attemptRecorded = false
      let manifest: EnvironmentBuildManifest | null = null
      let deferredMysqlCaseId: string | null = null
      try {
        this.db.prepare(`INSERT INTO gym_build_job_attempts(id, gym_build_job_id, attempt_no, status, worker_token, trigger, started_at, created_at)
          VALUES (?, ?, ?, 'running', ?, ?, ?, ?)`).run(randomUUID(), id, job.attemptCount, token, trigger, now, now)
        attemptRecorded = true
        this.transition({ jobId: id, attemptNo: job.attemptCount, phase: 'designing', summary: '已冻结学习卡片，开始设计环境', workerToken: token })
        const environment = this.environmentFor(this.planUnit(job.learnerId, job.planId, job.planUnitId))
        if (environment.runtimeKind !== job.runtimeKind) throw new LabError('runtime_dispatch_mismatch', 'Gym 运行时与环境目录不一致', 409)
        const card = json<CaseDesignCard | null>(row.card_snapshot_json, null)
        if (!card) throw new LabError('gym_card_snapshot_missing', '当前 Gym 缺少冻结学习卡片，无法构建案例', 409)
        let diagnostic: ReturnType<typeof safeBuildDiagnostic> | null = null
        let result: { learningCaseId: string; caseGenerationJobId: string | null } | null = null
        let candidate: { learningCaseId: string; caseGenerationJobId: string | null } | null = null
        let mysqlContract: OpenHandsMySqlBuildContract | null = null
        if (environment.runtimeKind === 'mysql_lab') {
          // The immutable MySQL image is case-specific, so materialize and
          // transactionally link the case before delegating its build.  The
          // bound image, not the legacy store, performs the final preflight.
          candidate = await this.runRuntimeDriver({ job, environment, card, deferMySqlPreflight: this.enabled })
          if (this.enabled) {
            deferredMysqlCaseId = candidate.learningCaseId
            mysqlContract = this.mysql.runtimeBuildContractFor(job.learnerId, candidate.learningCaseId)
            this.appendEvent({ jobId: id, attemptNo: job.attemptCount, phase: 'designing', type: 'status', summary: '已冻结 MySQL 案例物料与案例专属初始化契约' })
          }
        }
        for (let repairRound = 0; repairRound <= this.maxRepairRounds; repairRound += 1) {
          manifest = null
          if (repairRound > 0) {
            this.db.prepare('UPDATE gym_build_jobs SET repair_round = ?, updated_at = ? WHERE id = ? AND worker_token = ?').run(repairRound, new Date().toISOString(), id, token)
            this.transition({ jobId: id, attemptNo: job.attemptCount, phase: 'repairing', summary: `开始第 ${repairRound} 轮诊断修复`, workerToken: token })
            if (environment.runtimeKind === 'mysql_lab' && candidate) {
              const currentCase = this.caseFor(job.learnerId, candidate.learningCaseId)
              if (currentCase?.status === 'failed') {
                candidate = await this.runRuntimeDriver({ job, environment, card, deferMySqlPreflight: true })
                deferredMysqlCaseId = candidate.learningCaseId
                mysqlContract = this.mysql.runtimeBuildContractFor(job.learnerId, candidate.learningCaseId)
              }
            }
          }
          try {
            manifest = await this.buildWithAdapter({ job: { ...this.jobFor(job.learnerId, id), attemptCount: job.attemptCount }, card, environment, attemptId, mysqlContract, diagnostic })
            this.transition({ jobId: id, attemptNo: job.attemptCount, phase: 'provisioning', summary: manifest ? '已接收 OpenHands 环境清单，开始服务端资源校验' : '使用兼容构建驱动准备受控环境', workerToken: token })
            this.transition({ jobId: id, attemptNo: job.attemptCount, phase: 'initializing', summary: '正在初始化案例资产', workerToken: token })
            this.transition({ jobId: id, attemptNo: job.attemptCount, phase: 'preflighting', summary: '正在独立重放健康检查与预检', workerToken: token })
            candidate ??= await this.runRuntimeDriver({ job, environment, card })
            if (manifest) {
              this.applyWorkspaceManifestAssets(job, candidate.learningCaseId, manifest)
              this.bindRuntime(job, candidate.learningCaseId, manifest, attemptId, mysqlContract)
              if (manifest.runtimeKind === 'docker_workspace') {
                await this.workspace.verifyBoundEnvironment(job.learnerId, candidate.learningCaseId, manifest)
              } else {
                await this.mysql.verifyBoundRuntime(job.learnerId, candidate.learningCaseId)
              }
            }
            result = candidate
            break
          } catch (error) {
            const category = this.failureCategory(error)
            const code = error instanceof LabError || error instanceof OpenHandsBuildAdapterError ? error.code : 'gym_build_failed'
            const message = safeBuildText(error instanceof Error ? error.message : 'Gym 构建失败')
            if (manifest) this.db.prepare("UPDATE environment_runtime_bindings SET status = 'superseded', updated_at = ? WHERE gym_build_job_id = ? AND status IN ('ready', 'active')").run(new Date().toISOString(), id)
            if (category === 'platform_fault' || repairRound >= this.maxRepairRounds) throw new OpenHandsBuildAdapterError(code, message, category)
            // A completed/failed remote task is never reused for a repair.
            // The next round receives only the server-produced safe diagnostic.
            this.db.prepare('UPDATE gym_build_jobs SET adapter_task_id = NULL, adapter_event_sequence = 0, updated_at = ? WHERE id = ? AND worker_token = ?').run(new Date().toISOString(), id, token)
            diagnostic = safeBuildDiagnostic({ code, message, phase: 'preflighting', repairRound: repairRound + 1 })
            this.appendEvent({ jobId: id, attemptNo: job.attemptCount, phase: 'repairing', type: 'diagnostic', summary: `预检失败，准备第 ${repairRound + 1} 轮修复`, diagnostic })
          }
        }
        if (!result) throw new OpenHandsBuildAdapterError('gym_build_no_result', 'Gym 构建未产生可用案例', 'preflight_failure')
        // Adapter-backed environments are bound and independently verified
        // inside the loop above. Legacy drivers intentionally have no image
        // binding and retain their existing preflight behavior.
        const finished = new Date().toISOString()
        this.db.transaction(() => {
          const updated = this.db.prepare("UPDATE gym_build_jobs SET status = 'ready', current_phase = NULL, learning_case_id = ?, case_generation_job_id = ?, failure_code = NULL, failure_message = NULL, failure_category = NULL, completed_at = ?, worker_lease_expires_at = NULL, resource_lease_json = ?, updated_at = ? WHERE id = ? AND status = 'running' AND worker_token = ? AND attempt_count = ?").run(result.learningCaseId, result.caseGenerationJobId, finished, JSON.stringify({ attemptId, terminalStatus: 'ready' }), finished, id, token, job.attemptCount)
          if (updated.changes === 0) throw new Error('gym_build_claim_lost')
          const attempt = this.db.prepare("UPDATE gym_build_job_attempts SET status = 'succeeded', completed_at = ? WHERE gym_build_job_id = ? AND attempt_no = ? AND worker_token = ? AND status = 'running'").run(finished, id, job.attemptCount, token)
          if (attempt.changes === 0) throw new Error('gym_build_attempt_claim_lost')
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE plan_unit_id = ? AND gym_build_job_id = ? AND worker_token = ?').run(job.planUnitId, id, token)
          this.db.prepare('DELETE FROM gym_build_global_locks WHERE lock_name = ? AND gym_build_job_id = ? AND worker_token = ?').run('environment-build-v1', id, token)
        })()
        this.appendEvent({ jobId: id, attemptNo: job.attemptCount, phase: 'ready', type: 'status', summary: '环境已通过独立预检，可以开始学习' })
        if (this.adapter && manifest) {
          try {
            await this.adapter.cleanup({ buildId: id, attemptId, retainRuntimeArtifact: true })
            this.appendEvent({ jobId: id, attemptNo: job.attemptCount, phase: 'ready', type: 'docker', summary: 'Builder 临时资源已清理，已保留运行时产物' })
          } catch (error) {
            const message = safeBuildText(error instanceof Error ? error.message : 'Builder 临时资源清理失败')
            this.db.prepare("UPDATE gym_build_jobs SET status = 'cleanup_pending', cleanup_due_at = ?, last_cleanup_error = ?, resource_lease_json = ?, updated_at = ? WHERE id = ? AND status = 'ready'").run(new Date(Date.now() + 5 * 60_000).toISOString(), message, JSON.stringify({ attemptId, terminalStatus: 'ready' }), new Date().toISOString(), id)
            this.appendEvent({ jobId: id, attemptNo: job.attemptCount, phase: 'cleanup_pending', type: 'diagnostic', summary: '构建完成，但临时资源清理待重试', diagnostic: { code: 'cleanup_failed', message } })
          }
        }
      } catch (error) {
        const failedAt = new Date().toISOString()
        const code = error instanceof LabError || error instanceof OpenHandsBuildAdapterError ? error.code : 'gym_build_failed'
        const category = this.failureCategory(error)
        const message = safeBuildText(error instanceof Error ? error.message : 'Gym 构建失败', 500)
        const cleanupDueAt = this.adapter ? new Date(Date.now() + this.failureRetentionHours * 60 * 60_000).toISOString() : null
        if (deferredMysqlCaseId) this.mysql.markDeferredBuildFailure(job.learnerId, deferredMysqlCaseId, code, message)
        this.db.transaction(() => {
          this.db.prepare("UPDATE gym_build_jobs SET status = 'failed', current_phase = NULL, failure_code = ?, failure_message = ?, failure_category = ?, cleanup_due_at = ?, worker_lease_expires_at = NULL, resource_lease_json = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND worker_token = ? AND attempt_count = ?").run(code, message, category, cleanupDueAt, JSON.stringify({ attemptId, terminalStatus: 'failed' }), failedAt, failedAt, id, token, job.attemptCount)
          if (attemptRecorded) this.db.prepare("UPDATE gym_build_job_attempts SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ? WHERE gym_build_job_id = ? AND attempt_no = ? AND worker_token = ? AND status = 'running'").run(code, message, failedAt, id, job.attemptCount, token)
          this.db.prepare('DELETE FROM gym_build_unit_locks WHERE plan_unit_id = ? AND gym_build_job_id = ? AND worker_token = ?').run(job.planUnitId, id, token)
          this.db.prepare('DELETE FROM gym_build_global_locks WHERE lock_name = ? AND gym_build_job_id = ? AND worker_token = ?').run('environment-build-v1', id, token)
        })()
        this.appendEvent({ jobId: id, attemptNo: job.attemptCount, phase: 'failed', type: 'diagnostic', summary: '环境构建失败', diagnostic: { code, message } })
        this.log('build_failed', { buildId: id, learnerId: job.learnerId, code, category })
      }
      })
    } finally {
      this.scheduleNextQueuedBuild()
    }
  }
}

/** Compatibility export for existing API wiring; new code should use the explicit name. */
export { EnvironmentBuildOrchestrator as GymBuildService }
