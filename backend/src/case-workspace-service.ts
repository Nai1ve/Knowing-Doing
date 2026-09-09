import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { getWorkspaceCapability } from './capability-registry.js'
import { MAX_WORKSPACE_FILE_BYTES, MAX_WORKSPACE_TOTAL_BYTES, parseCaseRequest, parseCaseSpec, isAllowedPythonCommand } from './case-schemas.js'
import { CaseBuilderError, type CaseBuilderAttemptEvent, type CaseBuilderContext, type CaseBuilderProvider } from './case-builder.js'
import { LabError } from './errors.js'
import type { CaseRequest, CaseSpec, LearningCase, CaseGenerationJob, PracticeRun, SourceItem, WorkspaceCompletion, WorkspaceExecution, WorkspaceFile, WorkspaceRun, WorkspaceTutorHistory } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import type { RunnerFileInput, WorkspaceRunnerClient } from './workspace-runner-client.js'
import { WorkspaceRunnerError } from './workspace-runner-client.js'

type Row = Record<string, unknown>

function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function number(row: Row, key: string): number { return Number(row[key]) }
function json<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }
function checksum(value: string): string { return createHash('sha256').update(value).digest('hex') }
function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`
  if (value && typeof value === 'object') return `{${Object.keys(value as Record<string, unknown>).sort().map((key) => `${JSON.stringify(key)}:${stableJson((value as Record<string, unknown>)[key])}`).join(',')}}`
  return JSON.stringify(value)
}

function sourceFrom(row: Row): SourceItem {
  return { id: text(row, 'id'), provider: text(row, 'provider') as SourceItem['provider'], externalId: nullable(row, 'external_id'), title: text(row, 'title'), author: nullable(row, 'author'), url: text(row, 'url'), excerpt: text(row, 'excerpt'), query: nullable(row, 'query'), retrievedAt: text(row, 'retrieved_at'), metadata: json<Record<string, unknown>>(row.metadata_json, {}) }
}

function learningCaseFrom(row: Row): LearningCase {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), roadmapNodeId: text(row, 'roadmap_node_id'), capabilityKey: text(row, 'capability_key'), templateKey: text(row, 'template_key'),
    inputKind: text(row, 'input_kind') as LearningCase['inputKind'], inputSnapshot: json<Record<string, unknown>>(row.input_snapshot_json, {}), inputFingerprint: text(row, 'input_fingerprint'),
    provider: text(row, 'provider') as LearningCase['provider'], version: number(row, 'version'), status: text(row, 'status') as LearningCase['status'], spec: row.case_spec_json === '{}' ? null : json<CaseSpec | null>(row.case_spec_json, null),
    failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

function jobFrom(row: Row): CaseGenerationJob {
  return { id: text(row, 'id'), learnerId: text(row, 'learner_id'), learningCaseId: text(row, 'learning_case_id'), clientRequestId: text(row, 'client_request_id'), inputFingerprint: text(row, 'input_fingerprint'), provider: text(row, 'provider') as CaseGenerationJob['provider'], status: text(row, 'status') as CaseGenerationJob['status'], attemptCount: number(row, 'attempt_count'), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), startedAt: nullable(row, 'started_at'), completedAt: nullable(row, 'completed_at') }
}

function workspaceRunFrom(row: Row): WorkspaceRun {
  return { id: text(row, 'id'), learnerId: text(row, 'learner_id'), practiceRunId: text(row, 'practice_run_id'), learningCaseId: text(row, 'learning_case_id'), runnerRunId: nullable(row, 'runner_run_id'), templateKey: text(row, 'template_key'), status: text(row, 'status') as WorkspaceRun['status'], revision: number(row, 'revision'), leaseExpiresAt: nullable(row, 'lease_expires_at'), lastHeartbeatAt: nullable(row, 'last_heartbeat_at'), endedReason: nullable(row, 'ended_reason'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), endedAt: nullable(row, 'ended_at') }
}

function fileFrom(row: Row): WorkspaceFile {
  return { id: text(row, 'id'), workspaceRunId: text(row, 'workspace_run_id'), path: text(row, 'path'), content: text(row, 'content'), checksum: text(row, 'checksum'), revision: number(row, 'revision'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
}

function executionFrom(row: Row): WorkspaceExecution {
  return { id: text(row, 'id'), workspaceRunId: text(row, 'workspace_run_id'), sequence: number(row, 'sequence'), clientRequestId: text(row, 'client_request_id'), runnerExecutionId: nullable(row, 'runner_execution_id'), command: text(row, 'command'), status: text(row, 'status') as WorkspaceExecution['status'], stdout: text(row, 'stdout'), stderr: text(row, 'stderr'), exitCode: row.exit_code == null ? null : number(row, 'exit_code'), durationMs: row.duration_ms == null ? null : number(row, 'duration_ms'), startedAt: nullable(row, 'started_at'), completedAt: nullable(row, 'completed_at'), createdAt: text(row, 'created_at') }
}

export interface WorkspaceSummary {
  workspace: WorkspaceRun
  practice: PracticeRun
  case: LearningCase
  files: WorkspaceFile[]
  executions: WorkspaceExecution[]
  completion: WorkspaceCompletion | null
}

export class CaseWorkspaceService {
  private readonly caseLocks = new Map<string, Promise<void>>()
  private readonly workspaceLocks = new Map<string, Promise<void>>()

  constructor(private readonly repository: ProductRepository, private readonly builder: CaseBuilderProvider, private readonly runner: WorkspaceRunnerClient, private readonly completionService?: { completionForWorkspace(learnerId: string, workspaceRunId: string): WorkspaceCompletion | null; evaluateExecution(learnerId: string, workspaceRunId: string, executionId: string): WorkspaceCompletion | null; recheck(learnerId: string, workspaceRunId: string): WorkspaceCompletion | null }) {}

  private get db(): Database.Database { return this.repository.db }

  private async withLock<T>(locks: Map<string, Promise<void>>, key: string, action: () => Promise<T>): Promise<T> {
    const previous = locks.get(key) ?? Promise.resolve(); let release!: () => void
    const current = new Promise<void>((resolve) => { release = resolve }); const queued = previous.then(() => current); locks.set(key, queued); await previous
    try { return await action() } finally { release(); if (locks.get(key) === queued) locks.delete(key) }
  }

  private caseForLearner(learnerId: string, caseId: string): LearningCase {
    const row = this.db.prepare('SELECT * FROM learning_cases WHERE id = ? AND learner_id = ?').get(caseId, learnerId) as Row | undefined
    if (!row) throw new LabError('case_not_found', '案例不存在', 404)
    return learningCaseFrom(row)
  }

  private jobForLearner(learnerId: string, jobId: string): CaseGenerationJob {
    const row = this.db.prepare('SELECT * FROM case_generation_jobs WHERE id = ? AND learner_id = ?').get(jobId, learnerId) as Row | undefined
    if (!row) throw new LabError('case_generation_not_found', '案例生成任务不存在', 404)
    return jobFrom(row)
  }

  private workspaceRow(learnerId: string, workspaceId: string): Row {
    const row = this.db.prepare(`SELECT w.*, r.id AS practice_id, r.plan_unit_id, r.case_id, r.practice_kind, r.learning_case_id AS practice_learning_case_id, r.stage, r.hint_level, r.no_progress_count, r.status AS practice_status, r.created_at AS practice_created_at, r.updated_at AS practice_updated_at
      FROM workspace_runs w INNER JOIN practice_runs r ON r.id = w.practice_run_id INNER JOIN learning_cases c ON c.id = w.learning_case_id
      WHERE w.id = ? AND w.learner_id = ? AND r.learner_id = ? AND c.learner_id = ?`).get(workspaceId, learnerId, learnerId, learnerId) as Row | undefined
    if (!row) throw new LabError('workspace_not_found', '工作区不存在', 404)
    return row
  }

  private summaryFrom(row: Row): WorkspaceSummary {
    const workspace = workspaceRunFrom(row)
    const practice: PracticeRun = { id: text(row, 'practice_id'), learnerId: text(row, 'learner_id'), planUnitId: nullable(row, 'plan_unit_id'), caseId: text(row, 'case_id'), practiceKind: 'code_workspace', learningCaseId: text(row, 'practice_learning_case_id'), labRunId: null, stage: text(row, 'stage') as PracticeRun['stage'], hintLevel: number(row, 'hint_level'), noProgressCount: number(row, 'no_progress_count'), status: text(row, 'practice_status') as PracticeRun['status'], createdAt: text(row, 'practice_created_at'), updatedAt: text(row, 'practice_updated_at') }
    const learningCase = this.caseForLearner(text(row, 'learner_id'), workspace.learningCaseId)
    const files = (this.db.prepare('SELECT * FROM workspace_files WHERE workspace_run_id = ? ORDER BY path ASC').all(workspace.id) as Row[]).map(fileFrom)
    const executions = (this.db.prepare('SELECT * FROM workspace_executions WHERE workspace_run_id = ? ORDER BY sequence DESC LIMIT 20').all(workspace.id) as Row[]).map(executionFrom)
      return { workspace, practice, case: learningCase, files, executions, completion: this.completionService?.completionForWorkspace(text(row, 'learner_id'), workspace.id) ?? null }
  }

  createCaseRequest(learnerId: string, input: unknown): { case: LearningCase; job: CaseGenerationJob } {
    this.repository.ensureLearner(learnerId)
    let request: CaseRequest
    try { request = parseCaseRequest(input) } catch (error) { throw new LabError('invalid_case_request', error instanceof Error ? error.message : '案例请求无效', 400) }
    const node = this.db.prepare(`SELECT n.id, n.roadmap_id, n.learning_mode, n.capability_key, n.title, n.summary, n.completion_standard, r.learner_id, r.status
      FROM roadmap_nodes n INNER JOIN learning_roadmaps r ON r.id = n.roadmap_id
      WHERE n.id = ? AND r.learner_id = ? AND r.status IN ('draft', 'active')`).get(request.roadmapNodeId, learnerId) as Row | undefined
    if (!node) throw new LabError('roadmap_node_not_found', '路线节点不存在', 404)
    if (text(node, 'learning_mode') !== 'workspace') throw new LabError('workspace_not_available', '当前路线节点没有可用代码工作区', 409)
    const capability = getWorkspaceCapability(nullable(node, 'capability_key') ?? 'python.testing')
    if (!capability || capability.status !== 'available') throw new LabError('workspace_capability_unavailable', '当前工作区能力尚未开放', 409)
    const source = request.input.kind === 'zhihu_article' ? this.visibleSource(learnerId, request.input.sourceItemId!) : null
    const inputSnapshot = request.input.kind === 'brief' ? { ...request.input, desiredOutcome: request.desiredOutcome ?? null, difficulty: request.difficulty ?? null } : { ...request.input, desiredOutcome: request.desiredOutcome ?? null, difficulty: request.difficulty ?? null, source: source ? { id: source.id, title: source.title, author: source.author, url: source.url, excerpt: source.excerpt, retrievedAt: source.retrievedAt } : null }
    const rationale = (this.db.prepare('SELECT source_type, source_id, excerpt FROM roadmap_node_evidence WHERE roadmap_id = ? AND node_id = ? ORDER BY position ASC LIMIT 12').all(text(node, 'roadmap_id'), request.roadmapNodeId) as Row[]).map((item) => ({ sourceType: text(item, 'source_type'), sourceId: text(item, 'source_id'), excerpt: text(item, 'excerpt').slice(0, 1200) }))
    const profile = this.db.prepare("SELECT id FROM learner_profile_snapshots WHERE learner_id = ? AND status = 'current' ORDER BY version DESC LIMIT 1").get(learnerId) as Row | undefined
    const profileDimensions = profile ? (this.db.prepare('SELECT dimension_key, level, confidence, summary FROM learner_profile_dimensions WHERE snapshot_id = ? ORDER BY dimension_key').all(text(profile, 'id')) as Row[]).map((item) => ({ key: text(item, 'dimension_key'), level: text(item, 'level'), confidence: number(item, 'confidence'), summary: text(item, 'summary').slice(0, 600) })) : []
    const contextSnapshot = { roadmapNode: { id: text(node, 'id'), title: text(node, 'title'), summary: text(node, 'summary'), completionStandard: text(node, 'completion_standard'), capabilityKey: capability.capabilityKey }, roadmapRationale: rationale, learnerProfile: { snapshotId: profile ? text(profile, 'id') : null, dimensions: profileDimensions } }
    const frozenSnapshot = { ...inputSnapshot, context: contextSnapshot }
    const fingerprint = checksum(stableJson({ roadmapNodeId: request.roadmapNodeId, input: inputSnapshot, capabilityKey: capability.capabilityKey, templateKey: capability.templateKey }))
    const now = new Date().toISOString()
    const persist = this.db.transaction(() => {
      const requestJob = this.db.prepare('SELECT * FROM case_generation_jobs WHERE learner_id = ? AND client_request_id = ?').get(learnerId, request.clientRequestId) as Row | undefined
      if (requestJob) {
        if (text(requestJob, 'input_fingerprint') !== fingerprint) throw new LabError('idempotency_conflict', 'clientRequestId 已对应另一份案例请求', 409)
        return { caseId: text(requestJob, 'learning_case_id'), jobId: text(requestJob, 'id'), created: false }
      }
        const existingCase = this.db.prepare('SELECT id FROM learning_cases WHERE learner_id = ? AND input_fingerprint = ?').get(learnerId, fingerprint) as Row | undefined
      const caseId = existingCase ? text(existingCase, 'id') : randomUUID()
      if (!existingCase) this.db.prepare(`INSERT INTO learning_cases(id, learner_id, roadmap_node_id, capability_key, template_key, input_kind, input_snapshot_json, input_fingerprint, provider, version, status, case_spec_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 'generating', '{}', ?, ?)`).run(caseId, learnerId, request.roadmapNodeId, capability.capabilityKey, capability.templateKey, request.input.kind, JSON.stringify(frozenSnapshot), fingerprint, this.builder.providerName, now, now)
      const existingCaseJob = this.db.prepare('SELECT id FROM case_generation_jobs WHERE learner_id = ? AND learning_case_id = ? AND input_fingerprint = ? ORDER BY created_at ASC LIMIT 1').get(learnerId, caseId, fingerprint) as Row | undefined
      if (existingCaseJob) return { caseId, jobId: text(existingCaseJob, 'id'), created: false }
      const jobId = randomUUID()
      this.db.prepare(`INSERT INTO case_generation_jobs(id, learner_id, learning_case_id, client_request_id, input_fingerprint, provider, status, attempt_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`).run(jobId, learnerId, caseId, request.clientRequestId, fingerprint, this.builder.providerName, now, now)
      return { caseId, jobId, created: true }
    })
    let persisted: { caseId: string; jobId: string; created: boolean }
    try {
      persisted = persist.immediate()
    } catch (error) {
      if (!(error instanceof Error) || !/unique constraint|unique failed/i.test(error.message)) throw error
      const existing = this.db.prepare(`SELECT j.id AS job_id, j.learning_case_id AS case_id
        FROM case_generation_jobs j WHERE j.learner_id = ? AND j.input_fingerprint = ? ORDER BY j.created_at ASC LIMIT 1`).get(learnerId, fingerprint) as Row | undefined
      if (!existing) throw error
      persisted = { caseId: text(existing, 'case_id'), jobId: text(existing, 'job_id'), created: false }
    }
    const job = this.jobForLearner(learnerId, persisted.jobId); const savedCase = this.caseForLearner(learnerId, persisted.caseId)
    if (persisted.created) void this.processCaseJob(persisted.jobId).catch((error) => { console.error('[zhixing-case] generation_unhandled', { jobId: persisted.jobId, error: error instanceof Error ? error.message : String(error) }) })
    return { case: savedCase, job }
  }

  private visibleSource(learnerId: string, sourceId: string): SourceItem {
    const row = this.db.prepare(`SELECT s.* FROM source_items s WHERE s.id = ? AND EXISTS (
      SELECT 1 FROM knowledge_route_items i INNER JOIN knowledge_route_sets r ON r.id = i.route_set_id
      WHERE i.source_item_id = s.id AND r.learner_id = ?
    )`).get(sourceId, learnerId) as Row | undefined
    if (!row) throw new LabError('source_not_found', '知乎材料不存在或当前 learner 不可见', 404)
    return sourceFrom(row)
  }

  private requestFromCase(item: LearningCase): CaseRequest {
    const snapshot = item.inputSnapshot
    if (item.inputKind === 'brief') return { roadmapNodeId: item.roadmapNodeId, input: { kind: 'brief', brief: typeof snapshot.brief === 'string' ? snapshot.brief : '' }, desiredOutcome: typeof snapshot.desiredOutcome === 'string' ? snapshot.desiredOutcome : undefined, difficulty: snapshot.difficulty as CaseRequest['difficulty'], clientRequestId: item.inputFingerprint }
    return { roadmapNodeId: item.roadmapNodeId, input: { kind: 'zhihu_article', sourceItemId: typeof snapshot.sourceItemId === 'string' ? snapshot.sourceItemId : '' }, desiredOutcome: typeof snapshot.desiredOutcome === 'string' ? snapshot.desiredOutcome : undefined, difficulty: snapshot.difficulty as CaseRequest['difficulty'], clientRequestId: item.inputFingerprint }
  }

  private saveCaseAttempt(jobId: string, attemptNumber: number, phase: 'generate' | 'repair', status: 'running' | 'succeeded' | 'failed', contextFingerprint: string, event: Partial<CaseBuilderAttemptEvent> = {}): void {
    const now = new Date().toISOString(); const diagnostics = event.diagnostics ?? {}
    this.db.prepare(`INSERT INTO case_generation_attempts(id, case_generation_job_id, attempt_number, phase, provider, model_name, prompt_version, context_fingerprint, response_fingerprint, status, diagnostics_json, started_at, completed_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(case_generation_job_id, attempt_number, phase) DO UPDATE SET response_fingerprint = excluded.response_fingerprint, status = excluded.status, diagnostics_json = excluded.diagnostics_json, completed_at = excluded.completed_at`).run(
      randomUUID(), jobId, attemptNumber, phase, this.builder.providerName, this.builder.modelName ?? null, event.promptVersion ?? null, contextFingerprint, event.responseFingerprint ?? null, status, JSON.stringify(diagnostics), now, status === 'running' ? null : now, now,
    )
  }

  private async processCaseJob(jobId: string): Promise<void> {
    const token = randomUUID(); const now = new Date().toISOString(); const claimed = this.db.prepare("UPDATE case_generation_jobs SET status = 'running', attempt_count = attempt_count + 1, worker_token = ?, started_at = ?, updated_at = ? WHERE id = ? AND status = 'queued'").run(token, now, now, jobId)
    if (claimed.changes === 0) return
    const row = this.db.prepare('SELECT j.*, c.* FROM case_generation_jobs j INNER JOIN learning_cases c ON c.id = j.learning_case_id WHERE j.id = ?').get(jobId) as Row | undefined
    if (!row) return
    const item = learningCaseFrom(row); const snapshot = item.inputSnapshot; const sourceData = snapshot.source
    const source = sourceData && typeof sourceData === 'object' ? sourceData as SourceItem : null
    const context = snapshot.context && typeof snapshot.context === 'object' ? snapshot.context as { roadmapNode?: CaseBuilderContext['roadmapNode']; roadmapRationale?: CaseBuilderContext['roadmapRationale']; learnerProfile?: CaseBuilderContext['learnerProfile'] } : undefined
    const contextFingerprint = checksum(stableJson(snapshot.context ?? {})); const attemptNumber = number(row, 'attempt_count')
    this.saveCaseAttempt(jobId, attemptNumber, 'generate', 'running', contextFingerprint)
    try {
      const spec = parseCaseSpec(await this.builder.build({ request: this.requestFromCase(item), source, context: context?.roadmapNode ? { roadmapNode: context.roadmapNode, roadmapRationale: context.roadmapRationale ?? [], learnerProfile: context.learnerProfile ?? { snapshotId: null, dimensions: [] } } : undefined, onAttempt: (event) => this.saveCaseAttempt(jobId, attemptNumber, event.phase, event.status, event.contextFingerprint ?? contextFingerprint, event) }))
      this.saveCaseAttempt(jobId, attemptNumber, 'generate', 'succeeded', contextFingerprint)
      const completed = new Date().toISOString()
      const committed = this.db.transaction(() => {
        const updatedCase = this.db.prepare("UPDATE learning_cases SET status = 'ready', case_spec_json = ?, failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND status = 'generating'").run(JSON.stringify(spec), completed, item.id)
        if (updatedCase.changes === 0) return false
        const updatedJob = this.db.prepare("UPDATE case_generation_jobs SET status = 'succeeded', failure_code = NULL, failure_message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND worker_token = ?").run(completed, completed, jobId, token)
        if (updatedJob.changes === 0) throw new Error('case_generation_claim_lost')
        return true
      })()
      if (!committed) return
    } catch (error) {
      const code = error instanceof CaseBuilderError ? error.code : error instanceof Error && error.message.startsWith('unsupported_command:') ? 'unsupported_command' : 'case_generation_failed'; const message = error instanceof Error ? error.message.slice(0, 500) : '案例生成失败'; const failedAt = new Date().toISOString()
      this.saveCaseAttempt(jobId, attemptNumber, 'generate', 'failed', contextFingerprint, { diagnostics: { code, message } })
      this.db.transaction(() => {
        const updatedJob = this.db.prepare("UPDATE case_generation_jobs SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'running' AND worker_token = ?").run(code, message, failedAt, failedAt, jobId, token)
        if (updatedJob.changes > 0) this.db.prepare("UPDATE learning_cases SET status = 'failed', failure_code = ?, failure_message = ?, updated_at = ? WHERE id = ? AND status = 'generating'").run(code, message, failedAt, item.id)
      })()
    }
  }

  getCaseGenerationJob(learnerId: string, jobId: string): { case: LearningCase; job: CaseGenerationJob } {
    const job = this.jobForLearner(learnerId, jobId); return { case: this.caseForLearner(learnerId, job.learningCaseId), job }
  }

  getLearningCase(learnerId: string, caseId: string): LearningCase {
    return this.caseForLearner(learnerId, caseId)
  }

  retryCaseGeneration(learnerId: string, jobId: string): { case: LearningCase; job: CaseGenerationJob } {
    const job = this.jobForLearner(learnerId, jobId)
    if (!['failed', 'interrupted'].includes(job.status)) { if (['queued', 'running'].includes(job.status)) return this.getCaseGenerationJob(learnerId, jobId); throw new LabError('case_generation_not_retryable', '当前案例生成任务不能重试', 409) }
    const now = new Date().toISOString(); const updated = this.db.transaction(() => {
      const changed = this.db.prepare("UPDATE case_generation_jobs SET status = 'queued', failure_code = NULL, failure_message = NULL, completed_at = NULL, updated_at = ? WHERE id = ? AND learner_id = ? AND status IN ('failed', 'interrupted')").run(now, jobId, learnerId)
      if (changed.changes === 0) return false
      this.db.prepare("UPDATE learning_cases SET status = 'generating', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(now, job.learningCaseId, learnerId)
      return true
    })()
    if (!updated) return this.getCaseGenerationJob(learnerId, jobId)
    void this.processCaseJob(jobId).catch((error) => console.error('[zhixing-case] retry_unhandled', { jobId, error: error instanceof Error ? error.message : String(error) }))
    return this.getCaseGenerationJob(learnerId, jobId)
  }

  resumeCaseJobs(): void {
    const cutoff = new Date(Date.now() - 30_000).toISOString(); const interruptedAt = new Date().toISOString()
    this.db.prepare("UPDATE case_generation_jobs SET status = 'interrupted', failure_code = 'service_restarted', failure_message = '服务在案例生成完成前重启', completed_at = ?, updated_at = ? WHERE status = 'running' AND updated_at < ?").run(interruptedAt, interruptedAt, cutoff)
    this.db.prepare("UPDATE case_generation_jobs SET status = 'queued', worker_token = NULL, completed_at = NULL, updated_at = ? WHERE status = 'interrupted' AND failure_code = 'service_restarted'").run(new Date().toISOString())
    const jobs = this.db.prepare("SELECT id FROM case_generation_jobs WHERE status = 'queued' ORDER BY created_at ASC LIMIT 20").all() as Row[]
    for (const row of jobs) void this.processCaseJob(text(row, 'id'))
  }

  async resumeWorkspaces(): Promise<void> {
    const rows = this.db.prepare("SELECT id, runner_run_id, status FROM workspace_runs WHERE status IN ('provisioning', 'active', 'executing') ORDER BY updated_at ASC LIMIT 100").all() as Row[]
    for (const row of rows) {
      const workspaceId = text(row, 'id'); const runnerRunId = nullable(row, 'runner_run_id'); const now = new Date().toISOString()
      if (!runnerRunId) {
        this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = 'service_restarted', ended_at = ?, updated_at = ? WHERE id = ? AND status IN ('provisioning', 'active', 'executing')").run(now, now, workspaceId)
        continue
      }
      try {
        const state = await this.runner.status(runnerRunId)
        if (state.status !== 'active') {
          this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = 'runner_unavailable', ended_at = ?, updated_at = ? WHERE id = ? AND status IN ('provisioning', 'active', 'executing')").run(now, now, workspaceId)
        } else if (text(row, 'status') === 'executing') {
          this.db.prepare("UPDATE workspace_executions SET status = 'failed', stderr = '服务在执行完成前重启', completed_at = ? WHERE workspace_run_id = ? AND status = 'running'").run(now, workspaceId)
          this.db.prepare("UPDATE workspace_runs SET status = 'active', last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'executing'").run(now, now, workspaceId)
        }
      } catch {
        this.db.prepare("UPDATE workspace_executions SET status = 'failed', stderr = 'Runner 不可用', completed_at = ? WHERE workspace_run_id = ? AND status = 'running'").run(now, workspaceId)
        this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = 'runner_unavailable', ended_at = ?, updated_at = ? WHERE id = ? AND status IN ('provisioning', 'active', 'executing')").run(now, now, workspaceId)
      }
    }
  }

  async startPractice(learnerId: string, caseId: string): Promise<WorkspaceSummary> {
    return this.withLock(this.caseLocks, `${learnerId}:${caseId}`, async () => {
      const item = this.caseForLearner(learnerId, caseId); if (item.status !== 'ready' || !item.spec) throw new LabError('case_not_ready', '案例尚未生成完成', 409, true)
      const existing = this.db.prepare('SELECT id FROM workspace_runs WHERE learning_case_id = ? AND learner_id = ? AND status IN (\'provisioning\', \'active\', \'executing\') ORDER BY updated_at DESC LIMIT 1').get(caseId, learnerId) as Row | undefined
      if (existing) return this.getWorkspace(learnerId, text(existing, 'id'))
      const now = new Date().toISOString(); const practiceId = randomUUID(); const workspaceId = randomUUID(); const caseRunId = `workspace:${caseId}`
      this.db.transaction(() => {
        this.db.prepare(`INSERT INTO practice_runs(id, learner_id, plan_unit_id, case_id, lab_run_id, practice_kind, learning_case_id, stage, status, created_at, updated_at)
          VALUES (?, ?, NULL, ?, NULL, 'code_workspace', ?, 'observe', 'active', ?, ?)`).run(practiceId, learnerId, caseRunId, caseId, now, now)
        this.db.prepare(`INSERT INTO workspace_runs(id, learner_id, practice_run_id, learning_case_id, template_key, status, revision, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'provisioning', 1, ?, ?)`).run(workspaceId, learnerId, practiceId, caseId, item.templateKey, now, now)
      })()
      try {
        const runner = await this.runner.create({ templateKey: item.templateKey, files: item.spec.starterFiles, commands: [...item.spec.verification.commands, ...item.spec.tasks.flatMap((task) => task.recommendedCommands)] })
        const activatedAt = new Date().toISOString(); this.db.transaction(() => {
          this.db.prepare("UPDATE workspace_runs SET runner_run_id = ?, status = 'active', lease_expires_at = ?, last_heartbeat_at = ?, updated_at = ? WHERE id = ? AND status = 'provisioning'").run(runner.runnerRunId, runner.leaseExpiresAt, activatedAt, activatedAt, workspaceId)
          const insertFile = this.db.prepare(`INSERT INTO workspace_files(id, workspace_run_id, path, content, checksum, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
          for (const file of item.spec!.starterFiles) insertFile.run(randomUUID(), workspaceId, file.path, file.content, checksum(file.content), activatedAt, activatedAt)
        })()
        this.repository.appendEvent({ learnerId, practiceRunId: practiceId, actor: 'workspace', type: 'workspace_created', stage: 'observe', payload: { learningCaseId: caseId, templateKey: item.templateKey, provider: item.provider }, artifactRefs: [], clientRequestId: `workspace-created:${workspaceId}` })
        this.repository.createArtifact({ learnerId, practiceRunId: practiceId, kind: 'external_text', sourceKind: 'workspace', verificationStatus: 'not_applicable', content: item.spec.scenario, metadata: { learningCaseId: caseId, provider: item.provider, ...(item.provider === 'fixture' ? { fixtureVersion: 'python-order-summary-v1' } : {}) } })
      } catch (error) {
        const failedAt = new Date().toISOString(); this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = ?, updated_at = ?, ended_at = ? WHERE id = ? AND status = 'provisioning'").run(error instanceof WorkspaceRunnerError ? error.code : 'runner_unavailable', failedAt, failedAt, workspaceId)
        throw new LabError('workspace_provision_failed', '代码工作区启动失败', 503, true)
      }
      return this.getWorkspace(learnerId, workspaceId)
    })
  }

  getWorkspace(learnerId: string, workspaceId: string): WorkspaceSummary { return this.summaryFrom(this.workspaceRow(learnerId, workspaceId)) }

  getCompletion(learnerId: string, workspaceId: string): WorkspaceCompletion | null {
    this.workspaceRow(learnerId, workspaceId)
    return this.completionService?.completionForWorkspace(learnerId, workspaceId) ?? null
  }

  recheckCompletion(learnerId: string, workspaceId: string): WorkspaceCompletion | null {
    this.workspaceRow(learnerId, workspaceId)
    return this.completionService?.recheck(learnerId, workspaceId) ?? null
  }

  getTutorHistory(learnerId: string, workspaceId: string): WorkspaceTutorHistory {
    const row = this.workspaceRow(learnerId, workspaceId)
    return this.repository.workspaceTutorHistory(text(row, 'practice_id'))
  }

  getFile(learnerId: string, workspaceId: string, path: string): WorkspaceFile {
    this.workspaceRow(learnerId, workspaceId)
    const row = this.db.prepare('SELECT * FROM workspace_files WHERE workspace_run_id = ? AND path = ?').get(workspaceId, path) as Row | undefined
    if (!row) throw new LabError('file_not_found', '工作区文件不存在', 404)
    return fileFrom(row)
  }

  async saveFile(learnerId: string, workspaceId: string, path: string, content: string, expectedRevision: number): Promise<WorkspaceSummary> {
    return this.withLock(this.workspaceLocks, workspaceId, async () => {
      if (path.startsWith('/') || path.includes('..') || path.includes('\\') || !/\.(py|json|md|txt)$/.test(path)) throw new LabError('invalid_file_path', '文件路径不受支持', 400)
      if (Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_FILE_BYTES) throw new LabError('file_too_large', '文件不能超过 256KB', 422)
      const row = this.workspaceRow(learnerId, workspaceId); const workspace = workspaceRunFrom(row)
      if (workspace.status !== 'active') throw new LabError('workspace_not_active', '当前工作区不可写入', 409)
      if (!workspace.runnerRunId) throw new LabError('runner_unavailable', '工作区 Runner 不可用', 503, true)
      const current = this.db.prepare('SELECT * FROM workspace_files WHERE workspace_run_id = ? AND path = ?').get(workspaceId, path) as Row | undefined
      if (!current || number(current, 'revision') !== expectedRevision) throw new LabError('file_revision_conflict', '文件已被其他请求更新，请刷新后重试', 409)
      const otherBytes = this.db.prepare('SELECT COALESCE(SUM(length(CAST(content AS BLOB))), 0) AS total_bytes FROM workspace_files WHERE workspace_run_id = ? AND path <> ?').get(workspaceId, path) as Row
      if (Number(otherBytes.total_bytes) + Buffer.byteLength(content, 'utf8') > MAX_WORKSPACE_TOTAL_BYTES) throw new LabError('workspace_total_too_large', '工作区文件总大小不能超过 2MB', 422)
      try {
        const result = await this.runner.writeFile(workspace.runnerRunId, { path, content }, expectedRevision)
        if (result.revision !== expectedRevision + 1) throw new WorkspaceRunnerError('runner_revision_mismatch', 'Runner 文件版本未按预期推进', false)
      } catch (error) {
        const code = error instanceof WorkspaceRunnerError ? error.code : 'runner_unavailable'; const failedAt = new Date().toISOString()
        this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(code, failedAt, failedAt, workspaceId)
        throw new LabError(code, '文件同步到工作区失败', 503, true)
      }
      const now = new Date().toISOString(); const changed = this.db.prepare('UPDATE workspace_files SET content = ?, checksum = ?, revision = revision + 1, updated_at = ? WHERE workspace_run_id = ? AND path = ? AND revision = ?').run(content, checksum(content), now, workspaceId, path, expectedRevision)
      if (changed.changes === 0) {
        this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = 'needs_reconcile', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(now, now, workspaceId)
        throw new LabError('file_revision_conflict', '文件已被其他请求更新，请刷新后重试', 409)
      }
      this.repository.appendEvent({ learnerId, practiceRunId: workspace.practiceRunId, actor: 'workspace', type: 'workspace_file_saved', stage: 'attempt', payload: { path, revision: expectedRevision + 1 }, artifactRefs: [], clientRequestId: `file:${workspaceId}:${path}:${expectedRevision + 1}` })
      this.repository.createArtifact({ learnerId, practiceRunId: workspace.practiceRunId, kind: 'workspace_file', sourceKind: 'workspace', verificationStatus: 'not_applicable', content, metadata: { path, revision: expectedRevision + 1 } })
      return this.getWorkspace(learnerId, workspaceId)
    })
  }

  async execute(learnerId: string, workspaceId: string, command: string, clientRequestId: string): Promise<{ execution: WorkspaceExecution; workspace: WorkspaceSummary }> {
    return this.withLock(this.workspaceLocks, workspaceId, async () => {
      const row = this.workspaceRow(learnerId, workspaceId); const workspace = workspaceRunFrom(row); const item = this.caseForLearner(learnerId, workspace.learningCaseId)
      if (workspace.status !== 'active' || !workspace.runnerRunId) throw new LabError('workspace_not_active', '当前工作区不可执行', 409)
      if (!isAllowedPythonCommand(command) || !item.spec || ![...item.spec.verification.commands, ...item.spec.tasks.flatMap((task) => task.recommendedCommands), 'pytest -q'].includes(command)) throw new LabError('unsupported_command', '当前命令不在案例允许范围内', 400)
      const existing = this.db.prepare('SELECT * FROM workspace_executions WHERE workspace_run_id = ? AND client_request_id = ?').get(workspaceId, clientRequestId) as Row | undefined
      if (existing) return { execution: executionFrom(existing), workspace: this.getWorkspace(learnerId, workspaceId) }
      const now = new Date().toISOString(); const executionId = randomUUID()
      const sequence = this.db.transaction(() => {
        const changed = this.db.prepare("UPDATE workspace_runs SET status = 'executing', updated_at = ? WHERE id = ? AND status = 'active'").run(now, workspaceId)
        if (changed.changes === 0) throw new LabError('workspace_not_active', '当前工作区不可执行', 409)
        const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM workspace_executions WHERE workspace_run_id = ?').get(workspaceId) as Row
        const nextSequence = number(next, 'sequence')
        this.db.prepare(`INSERT INTO workspace_executions(id, workspace_run_id, sequence, client_request_id, command, status, created_at, started_at) VALUES (?, ?, ?, ?, ?, 'running', ?, ?)`)
          .run(executionId, workspaceId, nextSequence, clientRequestId, command, now, now)
        return nextSequence
      })()
      this.repository.appendEvent({ learnerId, practiceRunId: workspace.practiceRunId, actor: 'workspace', type: 'workspace_execution_started', stage: 'attempt', payload: { executionId, command, sequence }, artifactRefs: [], clientRequestId: `execution-start:${executionId}` })
      try {
        const result = await this.runner.execute(workspace.runnerRunId, command, clientRequestId); const completed = new Date().toISOString()
        this.db.prepare("UPDATE workspace_executions SET runner_execution_id = ?, status = ?, stdout = ?, stderr = ?, exit_code = ?, duration_ms = ?, completed_at = ? WHERE id = ? AND status = 'running'").run(result.runnerExecutionId, result.status, result.stdout, result.stderr, result.exitCode, result.durationMs, completed, executionId)
        if (result.status === 'timed_out') {
          this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = 'execution_timeout', ended_at = ?, updated_at = ? WHERE id = ? AND status = 'executing'").run(completed, completed, workspaceId)
        } else {
          this.db.prepare("UPDATE workspace_runs SET status = 'active', revision = revision + 1, last_heartbeat_at = ?, lease_expires_at = ?, updated_at = ? WHERE id = ? AND status = 'executing'").run(completed, new Date(Date.now() + 30 * 60_000).toISOString(), completed, workspaceId)
        }
        const execution = executionFrom(this.db.prepare('SELECT * FROM workspace_executions WHERE id = ?').get(executionId) as Row); const artifactKind = execution.status === 'succeeded' ? 'workspace_output' : 'workspace_error'
        const commandArtifact = this.repository.createArtifact({ learnerId, practiceRunId: workspace.practiceRunId, kind: 'workspace_command', sourceKind: 'workspace', verificationStatus: 'not_applicable', content: command, metadata: { executionId } })
        const outputArtifact = this.repository.createArtifact({ learnerId, practiceRunId: workspace.practiceRunId, kind: artifactKind, sourceKind: 'workspace', verificationStatus: 'not_applicable', content: `${execution.stdout}${execution.stderr ? `\n${execution.stderr}` : ''}`, metadata: { executionId, status: execution.status, exitCode: execution.exitCode, durationMs: execution.durationMs } })
        this.repository.appendEvent({ learnerId, practiceRunId: workspace.practiceRunId, actor: 'workspace', type: 'workspace_execution_finished', stage: 'verify', payload: { executionId, command, status: execution.status, exitCode: execution.exitCode }, artifactRefs: [commandArtifact.id, outputArtifact.id], clientRequestId: `execution-finished:${executionId}` })
        try { this.completionService?.evaluateExecution(learnerId, workspaceId, execution.id) } catch (error) { console.error('[zhixing-workspace] completion_evaluation_failed', { workspaceRunId: workspaceId, executionId: execution.id, error: error instanceof Error ? error.message : String(error) }) }
        return { execution, workspace: this.getWorkspace(learnerId, workspaceId) }
      } catch (error) {
        const failure = error instanceof WorkspaceRunnerError ? error.code : 'runner_unavailable'; const completed = new Date().toISOString()
        this.db.prepare("UPDATE workspace_executions SET status = 'failed', stderr = ?, completed_at = ? WHERE id = ? AND status = 'running'").run(failure, completed, executionId)
        this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = ?, updated_at = ?, ended_at = ? WHERE id = ? AND status = 'executing'").run(failure, completed, completed, workspaceId)
        const commandArtifact = this.repository.createArtifact({ learnerId, practiceRunId: workspace.practiceRunId, kind: 'workspace_command', sourceKind: 'workspace', verificationStatus: 'not_applicable', content: command, metadata: { executionId } })
        const errorArtifact = this.repository.createArtifact({ learnerId, practiceRunId: workspace.practiceRunId, kind: 'workspace_error', sourceKind: 'workspace', verificationStatus: 'not_applicable', content: failure, metadata: { executionId, command } })
        this.repository.appendEvent({ learnerId, practiceRunId: workspace.practiceRunId, actor: 'workspace', type: 'workspace_execution_finished', stage: 'verify', payload: { executionId, command, status: 'failed', failureCode: failure }, artifactRefs: [commandArtifact.id, errorArtifact.id], clientRequestId: `execution-finished:${executionId}` })
        throw new LabError(failure, '工作区执行失败', 503, true)
      }
    })
  }

  async reset(learnerId: string, workspaceId: string): Promise<WorkspaceSummary> {
    return this.withLock(this.workspaceLocks, workspaceId, async () => {
      const row = this.workspaceRow(learnerId, workspaceId); const workspace = workspaceRunFrom(row); const item = this.caseForLearner(learnerId, workspace.learningCaseId)
      if (workspace.status !== 'active' || !workspace.runnerRunId || !item.spec) throw new LabError('workspace_not_active', '当前工作区不可重置', 409)
      try { await this.runner.reset(workspace.runnerRunId, item.spec.starterFiles) } catch (error) {
        const code = error instanceof WorkspaceRunnerError ? error.code : 'runner_unavailable'; const failedAt = new Date().toISOString()
        this.db.prepare("UPDATE workspace_runs SET status = 'failed', ended_reason = ?, ended_at = ?, updated_at = ? WHERE id = ? AND status = 'active'").run(code, failedAt, failedAt, workspaceId)
        throw new LabError(code, '工作区重置失败', 503, true)
      }
      const now = new Date().toISOString(); this.db.transaction(() => {
        this.db.prepare('DELETE FROM workspace_files WHERE workspace_run_id = ?').run(workspaceId)
        const insert = this.db.prepare(`INSERT INTO workspace_files(id, workspace_run_id, path, content, checksum, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)`)
        for (const file of item.spec!.starterFiles) insert.run(randomUUID(), workspaceId, file.path, file.content, checksum(file.content), now, now)
        this.db.prepare("UPDATE workspace_runs SET revision = revision + 1, updated_at = ? WHERE id = ? AND status = 'active'").run(now, workspaceId)
      })()
      this.repository.appendEvent({ learnerId, practiceRunId: workspace.practiceRunId, actor: 'workspace', type: 'workspace_reset', stage: 'attempt', payload: { workspaceRunId: workspaceId }, artifactRefs: [], clientRequestId: `reset:${workspaceId}:${workspace.revision + 1}` })
      return this.getWorkspace(learnerId, workspaceId)
    })
  }

  async end(learnerId: string, workspaceId: string): Promise<WorkspaceSummary> {
    return this.withLock(this.workspaceLocks, workspaceId, async () => {
      const row = this.workspaceRow(learnerId, workspaceId); const workspace = workspaceRunFrom(row)
      if (workspace.runnerRunId) await this.runner.end(workspace.runnerRunId).catch(() => undefined)
      const now = new Date().toISOString(); this.db.prepare("UPDATE workspace_runs SET status = 'ended', ended_reason = 'user_ended', ended_at = ?, updated_at = ? WHERE id = ? AND status IN ('provisioning', 'active', 'executing')").run(now, now, workspaceId)
      this.repository.appendEvent({ learnerId, practiceRunId: workspace.practiceRunId, actor: 'workspace', type: 'workspace_ended', stage: 'attempt', payload: { reason: 'user_ended' }, artifactRefs: [], clientRequestId: `end:${workspaceId}` })
      return this.getWorkspace(learnerId, workspaceId)
    })
  }
}
