import { randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import type { CasePreflightStatus, CaseSpec, ReferenceSolution } from './product-types.js'
import type { ProductRepository } from './product-repository.js'
import type { RuntimeAdapter } from './runtime-adapter.js'
import type { RunnerExecutionResult, RunnerFileInput } from './workspace-runner-client.js'
import { WorkspaceRunnerError } from './workspace-runner-client.js'

type Row = Record<string, unknown>

function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function truncate(value: string, max = 12_000): string { return value.length > max ? `${value.slice(0, max)}\n...[truncated]` : value }

export class CasePreflightError extends Error {
  constructor(public readonly code: string, message = code, public readonly details: Record<string, unknown> = {}) { super(message); this.name = 'CasePreflightError' }
}

export interface CasePreflightInput {
  learnerId: string
  jobId: string
  learningCaseId: string
  jobAttemptNumber: number
  preflightAttemptNumber: number
  workerToken: string
  environmentKey: string
  environmentVersion: string
  runtimeKind: string
  spec: CaseSpec
  referenceSolution: ReferenceSolution | null
}

export interface CasePreflightReport {
  id: string
  status: 'passed'
  starterExecution: RunnerExecutionResult[]
  referenceExecution: RunnerExecutionResult[]
}

function safeExecution(result: RunnerExecutionResult): Record<string, unknown> {
  return { status: result.status, stdout: truncate(result.stdout), stderr: truncate(result.stderr), exitCode: result.exitCode, durationMs: result.durationMs }
}

export class CasePreflightService {
  constructor(private readonly repository: ProductRepository, private readonly runtime: RuntimeAdapter) {}

  private get db(): Database.Database { return this.repository.db }

  private updatePhase(id: string, status: CasePreflightStatus, runnerRunId: string | null = null): void {
    const now = new Date().toISOString()
    this.db.prepare('UPDATE case_preflight_runs SET status = ?, runner_run_id = COALESCE(?, runner_run_id), started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?').run(status, runnerRunId, now, now, id)
  }

  private async executeVerification(runnerRunId: string, commands: string[], prefix: string): Promise<RunnerExecutionResult[]> {
    const results: RunnerExecutionResult[] = []
    for (const [index, command] of commands.entries()) {
      results.push(await this.runtime.execute(runnerRunId, command, `preflight:${prefix}:${index}:${randomUUID()}`))
    }
    return results
  }

  private executionOutput(results: RunnerExecutionResult[]): string { return results.map((result) => `${result.stdout}\n${result.stderr}`).join('\n') }

  private starterFailed(results: RunnerExecutionResult[]): boolean {
    return results.length > 0 && results.some((result) => result.status !== 'succeeded' || result.exitCode !== 0)
  }

  private referenceSucceeded(results: RunnerExecutionResult[], signals: string[]): boolean {
    const output = this.executionOutput(results)
    return results.length > 0 && results.every((result) => result.status === 'succeeded' && result.exitCode === 0) && signals.every((signal) => output.includes(signal))
  }

  async run(input: CasePreflightInput): Promise<CasePreflightReport> {
    const now = new Date().toISOString()
    const preflightId = randomUUID()
    this.db.transaction(() => {
      this.db.prepare(`INSERT INTO case_preflight_runs(id, learning_case_id, case_generation_job_id, attempt_number, environment_key, environment_version, runtime_kind, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', ?, ?)`).run(preflightId, input.learningCaseId, input.jobId, input.preflightAttemptNumber, input.environmentKey, input.environmentVersion, input.runtimeKind, now, now)
      const job = this.db.prepare("UPDATE case_generation_jobs SET status = 'preflighting', updated_at = ? WHERE id = ? AND status IN ('running', 'preflighting') AND worker_token = ? AND attempt_count = ?").run(now, input.jobId, input.workerToken, input.jobAttemptNumber)
      if (job.changes === 0) throw new CasePreflightError('case_generation_claim_lost', '案例生成任务已被其他尝试接管')
      this.db.prepare("UPDATE learning_cases SET preflight_status = 'queued', updated_at = ? WHERE id = ? AND status = 'generating'").run(now, input.learningCaseId)
    })()

    let runnerRunId: string | null = null
    try {
      this.updatePhase(preflightId, 'provisioning')
      const runner = await this.runtime.provision({ environmentKey: input.environmentKey, environmentVersion: input.environmentVersion, files: input.spec.starterFiles, commands: [...new Set(input.spec.verification.commands)] })
      runnerRunId = runner.runnerRunId
      this.updatePhase(preflightId, 'verifying_starter', runnerRunId)
      const starterExecution = await this.executeVerification(runnerRunId, input.spec.verification.commands, 'starter')
      const starterJson = JSON.stringify(starterExecution.map(safeExecution))
      this.db.prepare('UPDATE case_preflight_runs SET starter_execution_json = ?, updated_at = ? WHERE id = ?').run(starterJson, new Date().toISOString(), preflightId)
      if (!this.starterFailed(starterExecution)) throw new CasePreflightError('starter_did_not_fail', '案例初始状态未产生预期失败', { starterExecution: starterExecution.map(safeExecution) })
      if (!input.referenceSolution) throw new CasePreflightError('reference_solution_missing', '案例没有可用于预检的私有参考解', { starterExecution: starterExecution.map(safeExecution) })

      const referenceByPath = new Map(input.spec.starterFiles.map((file) => [file.path, file]))
      for (const file of input.referenceSolution.files) referenceByPath.set(file.path, file)
      this.updatePhase(preflightId, 'verifying_reference')
      await this.runtime.reset(runnerRunId, [...referenceByPath.values()])
      const referenceExecution = await this.executeVerification(runnerRunId, input.spec.verification.commands, 'reference')
      const referenceJson = JSON.stringify(referenceExecution.map(safeExecution))
      const completedAt = new Date().toISOString()
      if (!this.referenceSucceeded(referenceExecution, input.spec.verification.successSignals)) throw new CasePreflightError('reference_solution_failed', '私有参考解未通过真实运行验证', { starterExecution: starterExecution.map(safeExecution), referenceExecution: referenceExecution.map(safeExecution) })
      this.db.transaction(() => {
        this.db.prepare("UPDATE case_preflight_runs SET status = 'passed', reference_execution_json = ?, failure_code = NULL, failure_message = NULL, completed_at = ?, updated_at = ? WHERE id = ? AND status = 'verifying_reference'").run(referenceJson, completedAt, completedAt, preflightId)
        this.db.prepare("UPDATE learning_cases SET preflight_status = 'passed', updated_at = ? WHERE id = ? AND status = 'generating'").run(completedAt, input.learningCaseId)
      })()
      return { id: preflightId, status: 'passed', starterExecution, referenceExecution }
    } catch (error) {
      const code = error instanceof CasePreflightError ? error.code : error instanceof WorkspaceRunnerError ? error.code : 'preflight_failed'
      const message = error instanceof Error ? error.message.slice(0, 500) : '案例预检失败'
      const failedAt = new Date().toISOString()
      this.db.transaction(() => {
        this.db.prepare("UPDATE case_preflight_runs SET status = 'failed', failure_code = ?, failure_message = ?, completed_at = ?, updated_at = ? WHERE id = ? AND status NOT IN ('passed', 'failed')").run(code, message, failedAt, failedAt, preflightId)
        this.db.prepare("UPDATE learning_cases SET preflight_status = 'failed', updated_at = ? WHERE id = ? AND status = 'generating'").run(failedAt, input.learningCaseId)
      })()
      throw new CasePreflightError(code, message)
    } finally {
      if (runnerRunId) {
        try { await this.runtime.end(runnerRunId) } catch { /* cleanup failure is retained in the preflight record */ }
      }
    }
  }

  async recover(): Promise<void> {
    const now = new Date().toISOString()
    const rows = this.db.prepare("SELECT id, runner_run_id, case_generation_job_id, learning_case_id FROM case_preflight_runs WHERE status IN ('queued', 'provisioning', 'verifying_starter', 'verifying_reference')").all() as Row[]
    this.db.transaction(() => {
      for (const row of rows) {
        this.db.prepare("UPDATE case_preflight_runs SET status = 'interrupted', failure_code = 'service_restarted', failure_message = '服务在案例预检完成前重启', completed_at = ?, updated_at = ? WHERE id = ? AND status IN ('queued', 'provisioning', 'verifying_starter', 'verifying_reference')").run(now, now, text(row, 'id'))
        this.db.prepare("UPDATE case_generation_jobs SET status = 'interrupted', failure_code = 'service_restarted', failure_message = '服务在案例预检完成前重启', completed_at = ?, updated_at = ? WHERE id = ? AND status = 'preflighting'").run(now, now, text(row, 'case_generation_job_id'))
        this.db.prepare("UPDATE learning_cases SET preflight_status = 'failed', status = 'failed', failure_code = 'service_restarted', failure_message = '服务在案例预检完成前重启', updated_at = ? WHERE id = ? AND status = 'generating'").run(now, text(row, 'learning_case_id'))
      }
    })()
    for (const row of rows) {
      const runnerRunId = nullable(row, 'runner_run_id')
      if (runnerRunId) { try { await this.runtime.end(runnerRunId) } catch { /* runner may already be gone */ } }
    }
  }
}
