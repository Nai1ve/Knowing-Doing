import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import mysql, { type FieldPacket, type Pool, type PoolConnection, type ResultSetHeader, type RowDataPacket } from 'mysql2/promise'
import type { CaseId, CaseManifest } from './domain.js'
import { getManifest, listManifests } from './fixtures.js'
import { LabError } from './errors.js'

type Connection = PoolConnection
type QueryRows = RowDataPacket[] | ResultSetHeader

export interface SessionConnection {
  id: string
  name: 'default' | 'tx-a' | 'tx-b'
  connection: Connection
}

export interface LabStore {
  health(): Promise<Record<CaseId, { ready: boolean; fixtureVersion: string; error?: string }>>
  reset(caseId: CaseId): Promise<void>
  createSession(caseId: CaseId, sessionId: string): Promise<Connection>
  execute(connection: Connection, statement: string, timeoutMs: number, maxRows: number, maxOutputBytes: number): Promise<{
    result: NonNullable<import('./domain.js').LabExecutionResult['result']>
    elapsed: number
  }>
  closeConnection(connection: Connection, options?: { destroy?: boolean }): Promise<void>
  close?(): Promise<void>
}

function quoteIdentifier(identifier: string): string {
  return `\`${identifier.replaceAll('`', '``')}\``
}

function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString()
  if (Buffer.isBuffer(value)) return value.toString('base64')
  if (value instanceof Date) return value.toISOString()
  return value
}

function splitSqlScript(script: string): string[] {
  return script
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)
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
    for (const manifest of listManifests()) {
      this.runnerPools.set(manifest.id, mysql.createPool({
        host: options.host,
        port: options.port,
        user: options.runnerUser,
        password: options.runnerPassword,
        database: manifest.schema,
        waitForConnections: true,
        connectionLimit: Math.max(1, Math.floor(options.runnerPoolSize / 3)),
        enableKeepAlive: true,
      }))
    }
  }

  async health(): Promise<Record<CaseId, { ready: boolean; fixtureVersion: string; error?: string }>> {
    const result = {} as Record<CaseId, { ready: boolean; fixtureVersion: string; error?: string }>
    for (const manifest of listManifests()) {
      try {
        const pool = this.runnerPools.get(manifest.id)
        if (!pool) throw new Error('runner pool missing')
        await pool.query('SELECT 1')
        const [rows] = await pool.query<RowDataPacket[]>('SELECT fixture_version FROM lab_fixture_meta LIMIT 1')
        const version = String(rows[0]?.fixture_version ?? '')
        result[manifest.id] = { ready: version === manifest.fixtureVersion, fixtureVersion: version, ...(version === manifest.fixtureVersion ? {} : { error: 'fixture version mismatch' }) }
      } catch (error) {
        result[manifest.id] = { ready: false, fixtureVersion: manifest.fixtureVersion, error: error instanceof Error ? error.message : 'MySQL unavailable' }
      }
    }
    return result
  }

  async reset(caseId: CaseId): Promise<void> {
    const manifest = getManifest(caseId)
    const connection = await this.adminPool.getConnection()
    try {
      await connection.query(`USE ${quoteIdentifier(manifest.schema)}`)
      await connection.beginTransaction()
      for (const table of manifest.tables) {
        await connection.query(`DELETE FROM ${quoteIdentifier(manifest.schema)}.${quoteIdentifier(table)}`)
      }
      const script = await this.readFixtureScript(caseId)
      for (const statement of splitSqlScript(script)) await connection.query(statement)
      await connection.commit()
      await this.restoreIndexes(connection, manifest)
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

  async execute(connection: Connection, statement: string, timeoutMs: number, maxRows: number, maxOutputBytes: number) {
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

  async closeConnection(connection: Connection, options?: { destroy?: boolean }): Promise<void> {
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

  private async readFixtureScript(caseId: CaseId): Promise<string> {
    const paths = [
      new URL(`../fixtures/${caseId}.reset.sql`, import.meta.url),
      new URL(`../../fixtures/${caseId}.reset.sql`, import.meta.url),
    ]
    let lastError: unknown
    for (const url of paths) {
      try {
        return await readFile(fileURLToPath(url), 'utf8')
      } catch (error) {
        lastError = error
      }
    }
    throw lastError instanceof Error ? lastError : new Error(`fixture not found: ${caseId}`)
  }

  private async restoreIndexes(connection: Connection, manifest: CaseManifest): Promise<void> {
    for (const [table, baseline] of Object.entries(manifest.baselineIndexes)) {
      const [rows] = await connection.query<RowDataPacket[]>(`SHOW INDEX FROM ${quoteIdentifier(manifest.schema)}.${quoteIdentifier(table)}`)
      const current = new Set(rows.map((row) => String(row.Key_name)))
      for (const indexName of current) {
        if (indexName === 'PRIMARY' || indexName in baseline) continue
        await connection.query(`ALTER TABLE ${quoteIdentifier(manifest.schema)}.${quoteIdentifier(table)} DROP INDEX ${quoteIdentifier(indexName)}`)
      }
      for (const [indexName, definition] of Object.entries(baseline)) {
        if (indexName === 'PRIMARY' || current.has(indexName) || !definition) continue
        await connection.query(`ALTER TABLE ${quoteIdentifier(manifest.schema)}.${quoteIdentifier(table)} ADD INDEX ${quoteIdentifier(indexName)} ${definition}`)
      }
    }
  }
}
