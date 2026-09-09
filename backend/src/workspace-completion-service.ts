import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { PlanningService } from './planning.js'
import type { ProductRepository } from './product-repository.js'
import type { CaseSpec, WorkspaceCompletion } from './product-types.js'

type Row = Record<string, unknown>

const EVALUATOR_VERSION = 'workspace-signals-v1'

function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function json<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }
function checksum(value: string): string { return createHash('sha256').update(value).digest('hex') }

function completionFrom(row: Row): WorkspaceCompletion {
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), workspaceRunId: text(row, 'workspace_run_id'), practiceRunId: text(row, 'practice_run_id'), learningCaseId: text(row, 'learning_case_id'), executionId: text(row, 'execution_id'), inputFingerprint: text(row, 'input_fingerprint'), evaluatorVersion: text(row, 'evaluator_version'), status: text(row, 'status') as WorkspaceCompletion['status'], matchedSignals: json<string[]>(row.matched_signals_json, []), missingSignals: json<string[]>(row.missing_signals_json, []), artifactRefs: json<string[]>(row.artifact_refs_json, []), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'), verifiedAt: nullable(row, 'verified_at'),
  }
}

function insertArtifact(db: Database.Database, input: { learnerId: string; practiceRunId: string; kind: 'workspace_verification'; content: string; metadata: Record<string, unknown>; verificationStatus: 'verified_workspace' }): string {
  const id = randomUUID(); const now = new Date().toISOString(); const digest = checksum(input.content)
  db.prepare('INSERT INTO artifacts(id, learner_id, practice_run_id, kind, source_kind, verification_status, content, metadata_json, checksum, created_at) VALUES (?, ?, ?, ?, \'workspace\', ?, ?, ?, ?, ?)').run(id, input.learnerId, input.practiceRunId, input.kind, input.verificationStatus, input.content, JSON.stringify(input.metadata), digest, now)
  return id
}

function insertEvent(db: Database.Database, input: { learnerId: string; practiceRunId: string; type: 'workspace_completion_checked' | 'workspace_verified'; payload: Record<string, unknown>; artifactRefs: string[]; clientRequestId: string }): string {
  const existing = db.prepare('SELECT id FROM practice_events WHERE practice_run_id = ? AND client_request_id = ?').get(input.practiceRunId, input.clientRequestId) as Row | undefined
  if (existing) return text(existing, 'id')
  const next = db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM practice_events WHERE practice_run_id = ?').get(input.practiceRunId) as Row
  const id = randomUUID(); const now = new Date().toISOString()
  db.prepare('INSERT INTO practice_events(id, learner_id, practice_run_id, sequence, actor, type, stage, payload_json, artifact_refs_json, client_request_id, created_at) VALUES (?, ?, ?, ?, \'rule\', ?, \'verify\', ?, ?, ?, ?)').run(id, input.learnerId, input.practiceRunId, Number(next.sequence), input.type, JSON.stringify(input.payload), JSON.stringify(input.artifactRefs), input.clientRequestId, now)
  return id
}

export class WorkspaceCompletionService {
  constructor(private readonly repository: ProductRepository, private readonly planning: PlanningService, private readonly onResolved?: (practiceRunId: string) => void) {}

  private get db(): Database.Database { return this.repository.db }

  completionForWorkspace(learnerId: string, workspaceRunId: string): WorkspaceCompletion | null {
    const row = this.db.prepare('SELECT * FROM workspace_completion_evaluations WHERE learner_id = ? AND workspace_run_id = ? ORDER BY updated_at DESC LIMIT 1').get(learnerId, workspaceRunId) as Row | undefined
    return row ? completionFrom(row) : null
  }

  private candidate(learnerId: string, workspaceRunId: string, executionId?: string): { workspace: Row; execution: Row; spec: CaseSpec } | null {
    const row = this.db.prepare(`SELECT w.id AS workspace_id, w.practice_run_id, w.learning_case_id, w.learner_id, e.id AS execution_id, e.command, e.status AS execution_status, e.stdout, e.stderr, e.exit_code, c.case_spec_json
      FROM workspace_runs w INNER JOIN workspace_executions e ON e.workspace_run_id = w.id INNER JOIN learning_cases c ON c.id = w.learning_case_id
      WHERE w.id = ? AND w.learner_id = ? ${executionId ? 'AND e.id = ?' : ''} ${executionId ? '' : "AND e.status = 'succeeded'"}
      ORDER BY e.sequence DESC ${executionId ? '' : 'LIMIT 1'}`).get(...(executionId ? [workspaceRunId, learnerId, executionId] : [workspaceRunId, learnerId])) as Row | undefined
    if (!row || text(row, 'execution_status') !== 'succeeded' || Number(row.exit_code) !== 0) return null
    const spec = json<CaseSpec | null>(row.case_spec_json, null)
    if (!spec || !spec.verification.commands.includes(text(row, 'command'))) return null
    return { workspace: row, execution: row, spec }
  }

  private evaluate(learnerId: string, candidate: { workspace: Row; execution: Row; spec: CaseSpec }): WorkspaceCompletion {
    const verified = this.db.prepare("SELECT * FROM workspace_completion_evaluations WHERE practice_run_id = ? AND status = 'verified' ORDER BY verified_at DESC LIMIT 1").get(text(candidate.workspace, 'practice_run_id')) as Row | undefined
    if (verified) return completionFrom(verified)
    const output = `${text(candidate.execution, 'stdout')}\n${text(candidate.execution, 'stderr')}`.toLocaleLowerCase()
    const matchedSignals = candidate.spec.verification.successSignals.filter((signal) => output.includes(signal.toLocaleLowerCase()))
    const missingSignals = candidate.spec.verification.successSignals.filter((signal) => !matchedSignals.includes(signal))
    const fingerprint = checksum(JSON.stringify({ learningCaseId: text(candidate.workspace, 'learning_case_id'), executionId: text(candidate.execution, 'execution_id'), command: text(candidate.execution, 'command'), stdout: text(candidate.execution, 'stdout'), stderr: text(candidate.execution, 'stderr'), exitCode: candidate.execution.exit_code, successSignals: candidate.spec.verification.successSignals, evaluatorVersion: EVALUATOR_VERSION }))
    const now = new Date().toISOString(); let newlyResolved = false
    const result = this.db.transaction(() => {
      const existing = this.db.prepare('SELECT * FROM workspace_completion_evaluations WHERE workspace_run_id = ? AND input_fingerprint = ?').get(text(candidate.workspace, 'workspace_id'), fingerprint) as Row | undefined
      if (existing?.status === 'verified' || existing?.status === 'not_matched' || existing?.status === 'superseded') return completionFrom(existing)
      const evaluationId = existing ? text(existing, 'id') : randomUUID()
      if (!existing) this.db.prepare(`INSERT INTO workspace_completion_evaluations(id, learner_id, workspace_run_id, practice_run_id, learning_case_id, execution_id, input_fingerprint, evaluator_version, status, matched_signals_json, missing_signals_json, artifact_refs_json, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '[]', '[]', '[]', ?, ?)`).run(evaluationId, learnerId, text(candidate.workspace, 'workspace_id'), text(candidate.workspace, 'practice_run_id'), text(candidate.workspace, 'learning_case_id'), text(candidate.execution, 'execution_id'), fingerprint, EVALUATOR_VERSION, now, now)
      const refsRow = this.db.prepare("SELECT artifact_refs_json FROM practice_events WHERE practice_run_id = ? AND client_request_id = ?").get(text(candidate.workspace, 'practice_run_id'), `execution-finished:${text(candidate.execution, 'execution_id')}`) as Row | undefined
      const artifactRefs = refsRow ? json<string[]>(refsRow.artifact_refs_json, []) : []
      const status = missingSignals.length > 0 ? 'not_matched' : 'verified'
      if (status === 'not_matched') {
        this.db.prepare('UPDATE workspace_completion_evaluations SET status = ?, matched_signals_json = ?, missing_signals_json = ?, artifact_refs_json = ?, updated_at = ? WHERE id = ? AND status = \'pending\'').run(status, JSON.stringify(matchedSignals), JSON.stringify(missingSignals), JSON.stringify(artifactRefs), now, evaluationId)
        insertEvent(this.db, { learnerId, practiceRunId: text(candidate.workspace, 'practice_run_id'), type: 'workspace_completion_checked', payload: { evaluationId, executionId: text(candidate.execution, 'execution_id'), status, matchedSignals, missingSignals }, artifactRefs, clientRequestId: `completion-check:${evaluationId}` })
      } else {
        const before = this.db.prepare('SELECT status FROM practice_runs WHERE id = ? AND learner_id = ? AND practice_kind = \'code_workspace\'').get(text(candidate.workspace, 'practice_run_id'), learnerId) as Row | undefined
        const wasResolved = before?.status === 'resolved'
        const updated = this.db.prepare("UPDATE practice_runs SET stage = 'resolved', status = 'resolved', updated_at = ? WHERE id = ? AND learner_id = ? AND practice_kind = 'code_workspace' AND status IN ('active', 'ready_to_close')").run(now, text(candidate.workspace, 'practice_run_id'), learnerId)
        if (!wasResolved && updated.changes === 0) {
          this.db.prepare('UPDATE workspace_completion_evaluations SET status = \'not_matched\', matched_signals_json = ?, missing_signals_json = ?, artifact_refs_json = ?, updated_at = ? WHERE id = ? AND status = \'pending\'').run(JSON.stringify(matchedSignals), JSON.stringify(missingSignals), JSON.stringify(artifactRefs), now, evaluationId)
          return completionFrom(this.db.prepare('SELECT * FROM workspace_completion_evaluations WHERE id = ?').get(evaluationId) as Row)
        }
        const verificationArtifactId = insertArtifact(this.db, { learnerId, practiceRunId: text(candidate.workspace, 'practice_run_id'), kind: 'workspace_verification', verificationStatus: 'verified_workspace', content: `验证命令 ${text(candidate.execution, 'command')} 命中全部 ${candidate.spec.verification.successSignals.length} 个成功信号。`, metadata: { evaluationId, executionId: text(candidate.execution, 'execution_id'), matchedSignals, missingSignals, artifactRefs } })
        const allRefs = [...artifactRefs, verificationArtifactId]
        this.db.prepare("UPDATE workspace_completion_evaluations SET status = 'verified', matched_signals_json = ?, missing_signals_json = ?, artifact_refs_json = ?, updated_at = ?, verified_at = ? WHERE id = ? AND status = 'pending'").run(JSON.stringify(matchedSignals), JSON.stringify(missingSignals), JSON.stringify(allRefs), now, now, evaluationId)
        insertEvent(this.db, { learnerId, practiceRunId: text(candidate.workspace, 'practice_run_id'), type: 'workspace_completion_checked', payload: { evaluationId, executionId: text(candidate.execution, 'execution_id'), status: 'verified', matchedSignals, missingSignals }, artifactRefs: allRefs, clientRequestId: `completion-check:${evaluationId}` })
        insertEvent(this.db, { learnerId, practiceRunId: text(candidate.workspace, 'practice_run_id'), type: 'workspace_verified', payload: { evaluationId, executionId: text(candidate.execution, 'execution_id') }, artifactRefs: allRefs, clientRequestId: `workspace-verified:${text(candidate.workspace, 'practice_run_id')}` })
        this.planning.markWorkspaceVerifiedInTransaction(text(candidate.workspace, 'practice_run_id'))
        const profile = this.db.prepare("SELECT id FROM learner_profile_snapshots WHERE learner_id = ? AND status = 'current' ORDER BY version DESC LIMIT 1").get(learnerId) as Row | undefined
        if (profile) this.db.prepare('INSERT INTO learner_profile_evidence(id, snapshot_id, topic_key, source_type, source_id, excerpt, created_at) VALUES (?, ?, ?, \'workspace_verification\', ?, ?, ?)').run(randomUUID(), text(profile, 'id'), text(candidate.workspace, 'learning_case_id'), evaluationId, '通过真实 Python 工作区验证命令完成案例。', now)
        newlyResolved = !wasResolved && updated.changes > 0
      }
      return completionFrom(this.db.prepare('SELECT * FROM workspace_completion_evaluations WHERE id = ?').get(evaluationId) as Row)
    })()
    if (newlyResolved) {
      try { this.onResolved?.(result.practiceRunId) } catch (error) { console.error('[zhixing-workspace] resolved_callback_failed', { practiceRunId: result.practiceRunId, error: error instanceof Error ? error.message : String(error) }) }
    }
    return result
  }

  evaluateExecution(learnerId: string, workspaceRunId: string, executionId: string): WorkspaceCompletion | null {
    const candidate = this.candidate(learnerId, workspaceRunId, executionId)
    return candidate ? this.evaluate(learnerId, candidate) : this.completionForWorkspace(learnerId, workspaceRunId)
  }

  recheck(learnerId: string, workspaceRunId: string): WorkspaceCompletion | null {
    const candidate = this.candidate(learnerId, workspaceRunId)
    return candidate ? this.evaluate(learnerId, candidate) : this.completionForWorkspace(learnerId, workspaceRunId)
  }

  resumePending(): void {
    const rows = this.db.prepare("SELECT e.workspace_run_id, w.learner_id FROM workspace_completion_evaluations e INDEXED BY idx_workspace_completion_status_updated INNER JOIN workspace_runs w ON w.id = e.workspace_run_id WHERE e.status = 'pending' GROUP BY e.workspace_run_id, w.learner_id ORDER BY MIN(e.updated_at) ASC LIMIT 50").all() as Row[]
    for (const row of rows) this.recheck(text(row, 'learner_id'), text(row, 'workspace_run_id'))
  }
}
