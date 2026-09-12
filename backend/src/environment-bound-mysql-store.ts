import type Database from 'better-sqlite3'
import type { CaseId, CaseManifest, LabExecutionResult } from './domain.js'
import { LabError } from './errors.js'
import type { OpenHandsBuildAdapter, OpenHandsMySqlRuntime } from './environment-build.js'
import { OpenHandsBuildAdapterError } from './environment-build.js'
import type { ControlledMySqlConnection, DynamicMySqlMaterial, LabConnection, LabStore } from './mysql-store.js'
import { isControlledMySqlConnection } from './mysql-store.js'

type Row = Record<string, unknown>
type RuntimeBinding = { buildId: string; attemptId: string; learningCaseId: string; database: string; runtimeImageDigest: string; runtimeImageRef: string; mysqlContractFingerprint: string }
type ActiveRuntime = RuntimeBinding & { runtime: OpenHandsMySqlRuntime }

const text = (row: Row, key: string): string => String(row[key])
const json = <T>(value: unknown, fallback: T): T => {
  try { return typeof value === 'string' ? JSON.parse(value) as T : fallback } catch { return fallback }
}
const truncate = (value: string, max: number): string => value.length > max ? `${value.slice(0, max)}\n…[truncated]` : value

/**
 * Routes only verified, bound MySQL Gym cases through case-builder-agent. All
 * unbound historical cases retain the existing store, so rollout is additive
 * and the scheduler remains the sole owner of lease/queue semantics.
 */
export class EnvironmentBoundMySqlStore implements LabStore {
  private readonly bindings = new Map<CaseId, RuntimeBinding>()
  private readonly active = new Map<CaseId, ActiveRuntime>()

  constructor(private readonly fallback: LabStore, private readonly db: Database.Database, private readonly adapter: OpenHandsBuildAdapter, private readonly leaseMs: number) {}

  private bindingFor(caseId: CaseId): RuntimeBinding | null {
    const row = this.db.prepare(`SELECT b.gym_build_job_id, b.learning_case_id, b.runtime_image_digest, b.runtime_image_ref, b.resource_lease_json
      FROM environment_runtime_bindings b
      INNER JOIN gym_build_jobs j ON j.id = b.gym_build_job_id
      WHERE b.learning_case_id = ? AND b.runtime_kind = 'mysql_lab'
        AND b.status IN ('ready', 'active') AND j.status IN ('running', 'ready', 'cleanup_pending')
      ORDER BY b.updated_at DESC LIMIT 1`).get(caseId) as Row | undefined
    if (!row) return null
    const runtimeImageDigest = text(row, 'runtime_image_digest')
    const runtimeImageRef = text(row, 'runtime_image_ref')
    const lease = json<{ attemptId?: unknown; database?: unknown; mysqlContractFingerprint?: unknown }>(row.resource_lease_json, {})
    if (!/^sha256:[a-f0-9]{64}$/i.test(runtimeImageDigest) || !runtimeImageRef || (runtimeImageRef !== runtimeImageDigest && !runtimeImageRef.endsWith(`@${runtimeImageDigest}`))) throw new LabError('bound_mysql_runtime_binding_invalid', 'MySQL 运行时镜像绑定无效', 503, true)
    if (typeof lease.attemptId !== 'string' || !lease.attemptId || typeof lease.database !== 'string' || !/^zhixing_dynamic_[a-f0-9]{12,64}$/.test(lease.database) || typeof lease.mysqlContractFingerprint !== 'string' || !/^[a-f0-9]{64}$/i.test(lease.mysqlContractFingerprint)) throw new LabError('bound_mysql_runtime_binding_invalid', 'MySQL 运行时绑定缺少案例契约', 503, true)
    return { buildId: text(row, 'gym_build_job_id'), attemptId: lease.attemptId, learningCaseId: text(row, 'learning_case_id'), database: lease.database, runtimeImageDigest, runtimeImageRef, mysqlContractFingerprint: lease.mysqlContractFingerprint }
  }

  async registerDynamicCase(manifest: CaseManifest, material: DynamicMySqlMaterial): Promise<void> {
    const binding = this.bindingFor(manifest.id)
    if (!binding) {
      await this.endBoundRuntime(manifest.id)
      this.bindings.delete(manifest.id)
      await this.fallback.registerDynamicCase?.(manifest, material)
      return
    }
    if (binding.database !== manifest.schema) throw new LabError('bound_mysql_runtime_schema_mismatch', 'MySQL 运行时与案例 schema 不一致', 503, true)
    const previous = this.bindings.get(manifest.id)
    if (previous && (previous.buildId !== binding.buildId || previous.runtimeImageDigest !== binding.runtimeImageDigest)) await this.endBoundRuntime(manifest.id)
    this.bindings.set(manifest.id, binding)
  }

  private async ensureRuntime(caseId: CaseId, reset = false): Promise<ActiveRuntime> {
    const binding = this.bindings.get(caseId) ?? this.bindingFor(caseId)
    if (!binding) throw new LabError('bound_mysql_runtime_not_found', 'MySQL 运行时绑定不存在', 409, true)
    this.bindings.set(caseId, binding)
    let active = this.active.get(caseId)
    if (!active || active.buildId !== binding.buildId || active.attemptId !== binding.attemptId || active.database !== binding.database || active.runtimeImageDigest !== binding.runtimeImageDigest) {
      if (active) await this.endBoundRuntime(caseId)
      try {
        const runtime = await this.adapter.startMySqlRuntime({ ...binding, leaseMs: this.leaseMs })
        active = { ...binding, runtime }
        this.active.set(caseId, active)
      } catch (error) {
        throw this.adapterFailure(error, 'mysql_runtime_start_failed')
      }
    } else if (reset) {
      try { await this.adapter.resetMySqlRuntime(active.runtime.runtimeId) } catch (error) { throw this.adapterFailure(error, 'mysql_runtime_reset_failed') }
    }
    return active
  }

  async reset(caseId: CaseId): Promise<void> {
    if (!this.bindings.has(caseId) && !this.bindingFor(caseId)) return this.fallback.reset(caseId)
    await this.ensureRuntime(caseId, this.active.has(caseId))
  }

  async createSession(caseId: CaseId, sessionName: string): Promise<LabConnection> {
    if (!this.bindings.has(caseId) && !this.bindingFor(caseId)) return this.fallback.createSession(caseId, sessionName)
    const active = await this.ensureRuntime(caseId)
    try {
      const session = await this.adapter.createMySqlSession(active.runtime.runtimeId, sessionName)
      const connection: ControlledMySqlConnection = { kind: 'controlled_mysql', runtimeId: active.runtime.runtimeId, sessionId: session.sessionId }
      return connection
    } catch (error) {
      throw this.adapterFailure(error, 'mysql_runtime_session_failed')
    }
  }

  async execute(connection: LabConnection, statement: string, _timeoutMs: number, maxRows: number, maxOutputBytes: number): Promise<{ result: NonNullable<LabExecutionResult['result']>; elapsed: number }> {
    if (!isControlledMySqlConnection(connection)) return this.fallback.execute(connection, statement, _timeoutMs, maxRows, maxOutputBytes)
    try {
      const result = await this.adapter.executeMySql(connection.runtimeId, connection.sessionId, statement)
      if (result.status === 'timed_out') throw new LabError('execution_timeout', 'SQL 执行超时，会话已结束', 504, true)
      if (result.status !== 'succeeded' || result.exitCode !== 0) throw new LabError('execution_failed', 'SQL 执行失败', 422, false, { adapter: 'case-builder-agent' })
      return { result: this.parseOutput(result.stdout, maxRows, maxOutputBytes), elapsed: result.durationMs }
    } catch (error) {
      if (error instanceof LabError) throw error
      throw this.adapterFailure(error, 'mysql_runtime_execution_failed')
    }
  }

  async closeConnection(connection: LabConnection, options?: { destroy?: boolean }): Promise<void> {
    if (!isControlledMySqlConnection(connection)) return this.fallback.closeConnection(connection, options)
    try { await this.adapter.closeMySqlSession(connection.runtimeId, connection.sessionId) } catch (error) {
      if (!options?.destroy) throw this.adapterFailure(error, 'mysql_runtime_session_close_failed')
    }
  }

  async releaseCase(caseId: CaseId): Promise<void> {
    if (this.bindings.has(caseId) || this.active.has(caseId) || this.bindingFor(caseId)) return this.endBoundRuntime(caseId)
    await this.fallback.reset(caseId)
  }

  async close(): Promise<void> {
    await Promise.all([...this.active.keys()].map((caseId) => this.endBoundRuntime(caseId)))
    await this.fallback.close?.()
  }

  private async endBoundRuntime(caseId: CaseId): Promise<void> {
    const active = this.active.get(caseId)
    this.active.delete(caseId)
    if (!active) return
    try { await this.adapter.endMySqlRuntime(active.runtime.runtimeId) } catch (error) { throw this.adapterFailure(error, 'mysql_runtime_end_failed') }
  }

  private parseOutput(stdout: string, maxRows: number, maxOutputBytes: number): NonNullable<LabExecutionResult['result']> {
    const rawOutput = truncate(stdout.replace(/\r\n/g, '\n'), maxOutputBytes)
    const lines = rawOutput.split('\n').filter((line, index, list) => line || index < list.length - 1)
    if (lines.length === 0 || !lines[0]) return { kind: 'command', affectedRows: 0, warningCount: 0, truncated: stdout.length > rawOutput.length, rawOutput }
    const columns = lines[0].split('\t')
    const data = lines.slice(1)
    const rows = data.slice(0, maxRows).map((line) => line.split('\t').map((value) => value === 'NULL' ? null : value))
    const truncated = data.length > maxRows || stdout.length > rawOutput.length
    const display = truncated && rawOutput === stdout ? `${rawOutput}\n[output truncated after ${rows.length} rows]` : rawOutput
    return { kind: 'result_set', columns, rows, rowCount: data.length, truncated, rawOutput: display }
  }

  private adapterFailure(error: unknown, code: string): LabError {
    if (error instanceof OpenHandsBuildAdapterError) return new LabError(code, '受控 MySQL 运行时不可用', 503, true)
    return new LabError(code, '受控 MySQL 运行时不可用', 503, true)
  }
}
