import sqlParser from 'node-sql-parser'
import { LabError } from './errors.js'
import type { CaseManifest } from './domain.js'

const parser = new sqlParser.Parser()
const transactionPattern = /^(BEGIN|START\s+TRANSACTION|COMMIT|ROLLBACK)\s*$/i
const maxStatementLength = 64 * 1024

export interface ValidatedStatement {
  statement: string
  kind: 'transaction' | 'query' | 'ddl' | 'dml'
}

function reject(message: string, details?: Record<string, unknown>): never {
  throw new LabError('sql_rejected', message, 422, false, details)
}

function statementType(ast: unknown): string {
  if (!ast || typeof ast !== 'object') return ''
  const type = (ast as { type?: unknown }).type
  return typeof type === 'string' ? type.toLowerCase() : ''
}

interface SqlAst {
  type?: string
  table?: { db?: string | null; table?: string | null }
  from?: Array<{ db?: string | null; table?: string | null }>
  name?: { column?: string }
  keyword?: string
  expr?: unknown
}

function normalizeTableName(table: { db?: string | null; table?: string | null } | undefined): string | undefined {
  if (!table?.table) return undefined
  return table.table.replaceAll('`', '').toLowerCase()
}

function tableNames(sql: string, ast: SqlAst, schema: string): string[] {
  const names = new Set<string>()
  try {
    for (const entry of parser.tableList(sql, { database: 'MySQL' })) {
      const parts = entry.split('::')
      const database = (parts[1] ?? '').replaceAll('`', '').toLowerCase()
      if (database && database !== 'null' && database !== schema.toLowerCase()) {
        reject('SQL 只能访问当前案例 schema', { schema: database })
      }
      const name = (parts[parts.length - 1] ?? '').replaceAll('`', '').toLowerCase()
      if (name && name !== 'null') names.add(name)
    }
  } catch (error) {
    // The parser may throw LabError for an explicitly qualified foreign schema.
    // Do not turn that security decision into an empty table list.
    if (error instanceof LabError) throw error
    // AST extraction below still handles CREATE/DROP INDEX, whose tableList
    // output is incomplete in node-sql-parser.
  }

  const add = (table: { db?: string | null; table?: string | null } | undefined) => {
    const database = table?.db?.replaceAll('`', '').toLowerCase()
    if (database && database !== schema.toLowerCase()) reject('SQL 只能访问当前案例 schema', { schema: database })
    const name = normalizeTableName(table)
    if (name) names.add(name)
  }
  add(ast.table)
  for (const table of ast.from ?? []) add(table)
  if (Array.isArray(ast.expr)) {
    for (const expression of ast.expr) {
      if (expression && typeof expression === 'object') add((expression as { table?: { db?: string | null; table?: string | null } }).table)
    }
  }
  return [...names]
}

export function validateStatement(rawStatement: string, manifest: CaseManifest): ValidatedStatement {
  const statement = rawStatement.trim()
  if (!statement) reject('SQL 不能为空')
  if (statement.length > maxStatementLength) reject('SQL 超过长度限制')
  if (statement.includes('\u0000')) reject('SQL 包含无效字符')

  if (transactionPattern.test(statement)) {
    return { statement, kind: 'transaction' }
  }

  let ast: unknown
  try {
    ast = parser.astify(statement, { database: 'MySQL' })
  } catch {
    reject('SQL 语法无法解析，请一次提交一条有效语句')
  }

  if (Array.isArray(ast)) reject('一次只能执行一条 SQL')
  const type = statementType(ast)
  const allowed: Record<string, ValidatedStatement['kind']> = {
    select: 'query',
    show: 'query',
    explain: 'query',
    create: 'ddl',
    alter: 'ddl',
    drop: 'ddl',
    insert: 'dml',
    update: 'dml',
    delete: 'dml',
  }
  const kind = allowed[type]
  if (!kind) reject(`不允许执行 ${type || '该类型'} SQL`)

  if (/\b(INTO\s+(OUT|DUMP)FILE|LOAD_FILE\s*\(|LOAD\s+DATA|INFILE|CREATE\s+PROCEDURE|CREATE\s+FUNCTION|GRANT|REVOKE|SET\s+GLOBAL|SET\s+PERSIST|USE\s+)/i.test(statement)) {
    reject('SQL 包含被禁止的实例、文件或跨库操作')
  }

  const sqlAst = ast as SqlAst
  const names = tableNames(statement, sqlAst, manifest.schema)
  if (names.length === 0 && type !== 'show') reject('无法确认 SQL 访问的案例表')
  const allowedTables = new Set(manifest.tables.map((table) => table.toLowerCase()))
  const invalidTable = names.find((name) => !allowedTables.has(name))
  if (invalidTable) reject('SQL 只能访问当前案例的受控表', { table: invalidTable })

  if (type === 'show') {
    const keyword = String(sqlAst.keyword ?? '').toLowerCase()
    if (keyword !== 'index' && keyword !== 'indexes') reject('只允许查看当前案例的索引')
    if (names.length === 0) reject('SHOW INDEX 必须指定当前案例的表')
  }

  if (type === 'create' || type === 'alter' || type === 'drop') {
    const keyword = String(sqlAst.keyword ?? '').toLowerCase()
    if (type === 'drop' && keyword !== 'index') reject('不允许执行 drop SQL')
    const alterExpressions = Array.isArray(sqlAst.expr) ? sqlAst.expr : []
    const alterOnlyIndexes = alterExpressions.length > 0 && alterExpressions.every((expression) => (
      expression && typeof expression === 'object' && (expression as { resource?: unknown }).resource === 'index'
    ))
    if ((type === 'create' && keyword !== 'index') || (type === 'drop' && keyword !== 'index') ||
      (type === 'alter' && !alterOnlyIndexes) ||
      /\b(TABLE|DATABASE|SCHEMA|VIEW|TRIGGER|PROCEDURE|FUNCTION|EVENT)\b/i.test(statement)) {
      reject('只允许创建或调整当前案例的索引')
    }
  }

  return { statement, kind }
}
