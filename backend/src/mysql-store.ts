import mysql, { type FieldPacket, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import type { CaseId, CaseManifest } from './domain.js'
import { LabError } from './errors.js'

type Connection = PoolConnection
type QueryRows = RowDataPacket[] | ResultSetHeader

export interface ControlledMySqlConnection {
  kind: 'controlled_mysql'
  runtimeId: string
  sessionId: string
}

export type LabConnection = Connection | ControlledMySqlConnection
export function isControlledMySqlConnection(connection: LabConnection): connection is ControlledMySqlConnection { return 'kind' in connection && connection.kind === 'controlled_mysql' }

export interface SessionConnection {
  id: string
  name: 'default' | 'tx-a' | 'tx-b'
  connection: LabConnection
}

export interface LabStore {
  reset(caseId: CaseId): Promise<void>
  createSession(caseId: CaseId, sessionId: string): Promise<LabConnection>
  execute(connection: LabConnection, statement: string, timeoutMs: number, maxRows: number, maxOutputBytes: number): Promise<{
    result: NonNullable<import('./domain.js').LabExecutionResult['result']>
    elapsed: number
  }>
  closeConnection(connection: LabConnection, options?: { destroy?: boolean }): Promise<void>
  releaseCase?(caseId: CaseId): Promise<void>
  close?(): Promise<void>
  registerDynamicCase?(manifest: CaseManifest, plan: DynamicMySqlMaterial): Promise<void>
}

export interface DynamicMySqlMaterial {
  schemaSql: string
  rowCount: number
  distribution: 'uniform' | 'skewed'
  faultSql: string
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

function quoteString(value: string): string {
  return `'${value.replaceAll('\\', '\\\\').replaceAll("'", "''")}'`
}

function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (value instanceof Date) return value.toISOString()
  return value
}

function formatRawResult(columns: string[], rows: unknown[][], command?: { affectedRows?: number; warningCount?: number }, truncated = false): string {
  if (columns.length > 0) {
    const lines = [columns.join('\t')]
    lines.push(...rows.map((row) => row.map((value) => value === null ? 'NULL' : String(value)).join('\t')))
    if (truncated) lines.push(`[output truncated after ${rows.length} rows]`)
    return lines.join('\n')
  }
  return `affectedRows=${command?.affectedRows ?? 0} warningCount=${command?.warningCount ?? 0}`
}

export class MySqlLabStore implements LabStore {
  private readonly runnerPools = new Map<CaseId, Pool>()
  private readonly manifests = new Map<CaseId, CaseManifest>()
  private readonly dynamicMaterials = new Map<CaseId, DynamicMySqlMaterial>()
  private readonly adminPool: Pool

  constructor(private readonly options: {
    host: string
    port: number
    runnerUser: string
    runnerPassword: string
    adminUser: string
    adminPassword: string
    runnerPoolSize: number
  }) {
    this.adminPool = mysql.createPool({
      host: options.host,
      port: options.port,
      user: options.adminUser,
      password: options.adminPassword,
      waitForConnections: true,
      connectionLimit: 3,
    })
  }

  private manifestFor(caseId: CaseId): CaseManifest {
    const manifest = this.manifests.get(caseId) ?? null
    if (!manifest) throw new LabError('case_not_found', '案例不存在', 404)
    return manifest
  }

  async registerDynamicCase(manifest: CaseManifest, material: DynamicMySqlMaterial): Promise<void> {
    if (!/^zhixing_dynamic_[a-f0-9]{12,64}$/.test(manifest.schema)) throw new LabError('invalid_dynamic_schema', '动态案例 schema 不符合平台命名规则', 422)
    if (this.manifests.has(manifest.id)) return
    const connection = await this.adminPool.getConnection()
    try {
      await connection.query(`CREATE DATABASE IF NOT EXISTS ${quoteIdentifier(manifest.schema)}`)
      await connection.query(`GRANT SELECT, INSERT, UPDATE, DELETE, CREATE, ALTER, DROP, INDEX ON ${quoteIdentifier(manifest.schema)}.* TO ${quoteString(this.options.runnerUser)}@'%'`)
      this.manifests.set(manifest.id, manifest)
      this.dynamicMaterials.set(manifest.id, material)
      this.runnerPools.set(manifest.id, mysql.createPool({
        host: this.options.host,
        port: this.options.port,
        user: this.options.runnerUser,
        password: this.options.runnerPassword,
        database: manifest.schema,
        waitForConnections: true,
        connectionLimit: Math.max(1, Math.floor(this.options.runnerPoolSize / 3)),
        enableKeepAlive: true,
      }))
    } catch (error) {
      throw new LabError('dynamic_case_registration_failed', '动态 MySQL 案例环境注册失败', 503, true, { cause: error instanceof Error ? error.message : 'unknown' })
    } finally {
      connection.release()
    }
  }

  async reset(caseId: CaseId): Promise<void> {
    const manifest = this.manifestFor(caseId)
    const connection = await this.adminPool.getConnection()
    try {
      await connection.query(`USE ${quoteIdentifier(manifest.schema)}`)
      await connection.beginTransaction()
      const dynamic = this.dynamicMaterials.get(caseId)
      if (!dynamic) throw new LabError('dynamic_case_not_registered', '动态案例物料不存在', 409)
      for (const table of manifest.tables) await connection.query(`DROP TABLE IF EXISTS ${quoteIdentifier(manifest.schema)}.${quoteIdentifier(table)}`)
      await connection.query(dynamic.schemaSql)
      await this.seedDynamicOrders(connection, manifest.schema, dynamic.rowCount, dynamic.distribution, /\bstatus\b/i.test(dynamic.schemaSql))
      if (!/^\s*\/\*/.test(dynamic.faultSql)) await connection.query(dynamic.faultSql)
      await connection.commit()
    } catch (error) {
      await connection.rollback().catch(() => undefined)
      throw new LabError('fixture_reset_failed', '案例环境重置失败', 503, true, { caseId, cause: error instanceof Error ? error.message : 'unknown' })
    } finally {
      connection.release()
    }
  }

  async createSession(caseId: CaseId, _sessionId: string): Promise<Connection> {
    const pool = this.runnerPools.get(caseId)
    if (!pool) throw new LabError('lab_unavailable', '案例执行池不可用', 503, true)
    try {
      return await pool.getConnection()
    } catch (error) {
      throw new LabError('lab_unavailable', '无法建立 MySQL 会话', 503, true, { cause: error instanceof Error ? error.message : 'unknown' })
    }
  }

  async execute(connection: LabConnection, statement: string, timeoutMs: number, maxRows: number, maxOutputBytes: number) {
    if (isControlledMySqlConnection(connection)) throw new LabError('execution_failed', '受控 MySQL 会话必须通过环境适配器执行', 503, true)
    const startedAt = Date.now()
    let timer: NodeJS.Timeout | undefined
    const query = connection.query(statement) as Promise<[QueryRows, FieldPacket[]]>
    query.catch(() => undefined)
    try {
      const [rows, fields] = await Promise.race([
        query,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new LabError('execution_timeout', 'SQL 执行超时，会话已结束', 504, true)), timeoutMs)
        }),
      ])
      const elapsed = Date.now() - startedAt
      if (Array.isArray(rows)) {
        const columns = fields.map((field) => String(field.name))
        const serializedRows = rows.slice(0, maxRows).map((row) => columns.map((column) => serializeValue((row as RowDataPacket)[column])))
        let rawOutput = formatRawResult(columns, serializedRows, undefined, rows.length > maxRows)
        let truncated = rows.length > maxRows
        if (Buffer.byteLength(rawOutput, 'utf8') > maxOutputBytes) {
          rawOutput = Buffer.from(rawOutput, 'utf8').subarray(0, maxOutputBytes).toString('utf8')
          truncated = true
        }
        return {
          result: { kind: 'result_set' as const, columns, rows: serializedRows, rowCount: rows.length, truncated, rawOutput },
          elapsed,
        }
      }
      const rawOutput = formatRawResult([], [], rows, false)
      return {
        result: { kind: 'command' as const, affectedRows: rows.affectedRows, warningCount: rows.warningStatus, truncated: false, rawOutput },
        elapsed,
      }
    } catch (error) {
      if (error instanceof LabError) throw error
      const mysqlError = error as { code?: string; sqlState?: string; message?: string }
      throw new LabError('execution_failed', mysqlError.message ?? 'SQL 执行失败', 422, false, { sqlState: mysqlError.sqlState, mysqlCode: mysqlError.code })
    } finally {
      if (timer) clearTimeout(timer)
    }
  }

  async closeConnection(connection: LabConnection, options?: { destroy?: boolean }): Promise<void> {
    if (isControlledMySqlConnection(connection)) throw new LabError('lab_unavailable', '受控 MySQL 会话必须通过环境适配器关闭', 503, true)
    if (options?.destroy) {
      connection.destroy()
      return
    }
    await connection.rollback().catch(() => undefined)
    connection.release()
  }

  async close(): Promise<void> {
    await Promise.all([
      this.adminPool.end(),
      ...[...this.runnerPools.values()].map((pool) => pool.end()),
    ])
  }

  private async seedDynamicOrders(connection: Connection, schema: string, rowCount: number, distribution: 'uniform' | 'skewed', includeStatus: boolean): Promise<void> {
    const batchSize = 2_000
    // Explain-plan-v1 queries a single day in August 2026. Keep every
    // deterministic seed inside that window and vary status across batches so
    // any representative user id has paid rows to inspect.
    const explainWindowStart = Math.floor(Date.UTC(2026, 7, 1) / 1_000)
    for (let start = 1; start <= rowCount; start += batchSize) {
      const end = Math.min(start + batchSize, rowCount + 1)
      const values: Array<number | string> = []
      const placeholders: string[] = []
      for (let id = start; id < end; id += 1) {
        const userId = distribution === 'skewed' ? (id % 20) + 1 : (id % 10_000) + 1
        const createdAt = explainWindowStart + ((id - 1) % 86_400)
        if (includeStatus) {
          placeholders.push('(?, ?, ?, FROM_UNIXTIME(?), ?)')
          values.push(id, userId, Math.floor((id - 1) / 10_000) % 5 === 0 ? 'PAID' : 'PENDING', createdAt, (id % 10_000) + 100)
        } else {
          placeholders.push('(?, ?, FROM_UNIXTIME(?), ?)')
          values.push(id, userId, createdAt, (id % 10_000) + 100)
        }
      }
      const columns = includeStatus ? '(id, user_id, status, created_at, total_cents)' : '(id, user_id, created_at, total_cents)'
      await connection.query(`INSERT INTO ${quoteIdentifier(schema)}.${quoteIdentifier('orders')} ${columns} VALUES ${placeholders.join(',')}`, values)
    }
  }

}
