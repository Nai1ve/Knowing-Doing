import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { MySqlExerciseRequest, MySqlMaterializationPlan } from './product-types.js'

export const MYSQL_MATERIALIZATION_REGISTRY_VERSION = 'mysql-performance-materials-v1'

const requestSchema = z.object({
  capabilityKey: z.literal('mysql.slow-query'),
  environmentKey: z.literal('mysql-performance-v1'),
  environmentVersion: z.literal('1'),
  schemaTemplateKey: z.literal('orders-v1'),
  seedProfileKey: z.enum(['orders-100k-v1', 'orders-1m-v1']),
  faultKey: z.enum(['wrong_index', 'missing_index', 'non_sargable_query']),
  queryTemplateKey: z.literal('orders-by-user-created-v1'),
  parameters: z.object({ rowCount: z.number().int().min(1_000).max(1_000_000), distribution: z.enum(['uniform', 'skewed']) }),
})

const schemaTemplates = {
  'orders-v1': 'CREATE TABLE IF NOT EXISTS orders (id BIGINT PRIMARY KEY, user_id BIGINT NOT NULL, created_at DATETIME NOT NULL, total_cents INT NOT NULL)',
} as const

const seedProfiles = {
  'orders-100k-v1': { rowCount: 100_000, distribution: 'uniform' },
  'orders-1m-v1': { rowCount: 1_000_000, distribution: 'skewed' },
} as const

const queryTemplates = {
  'orders-by-user-created-v1': 'SELECT id, user_id, created_at, total_cents FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
} as const

function checksum(value: unknown): string {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex')
}

export function parseMySqlExerciseRequest(value: unknown): MySqlExerciseRequest {
  return requestSchema.parse(value) as MySqlExerciseRequest
}

export function materializeMySqlExercise(value: unknown): MySqlMaterializationPlan {
  const request = parseMySqlExerciseRequest(value)
  const seed = seedProfiles[request.seedProfileKey]
  if (request.parameters.rowCount > seed.rowCount) throw new Error('mysql_seed_row_count_exceeds_profile')
  const faultSql = request.faultKey === 'wrong_index'
    ? 'CREATE INDEX idx_orders_user_id_created ON orders(user_id, total_cents)'
    : request.faultKey === 'missing_index'
      ? '/* no secondary index: the learner must identify the missing index */'
      : '/* non-sargable query shape is supplied by the registered query template */'
  const referenceSql = request.faultKey === 'wrong_index'
    ? 'CREATE INDEX idx_orders_user_id_created_at ON orders(user_id, created_at DESC)'
    : request.faultKey === 'missing_index'
      ? 'CREATE INDEX idx_orders_user_id_created_at ON orders(user_id, created_at DESC)'
      : 'CREATE INDEX idx_orders_user_id_created_at ON orders(user_id, created_at DESC)'
  return {
    registryVersion: MYSQL_MATERIALIZATION_REGISTRY_VERSION,
    request,
    schemaSql: schemaTemplates[request.schemaTemplateKey],
    seedProfile: { key: request.seedProfileKey, rowCount: request.parameters.rowCount, distribution: request.parameters.distribution },
    faultSeed: { key: request.faultKey, sql: faultSql },
    query: { key: request.queryTemplateKey, sql: queryTemplates[request.queryTemplateKey] },
    verification: { explainSignals: ['key', 'rows'], benchmarkSignals: ['duration_ms', 'row_count'] },
    referenceSolution: { sql: referenceSql },
  }
}

export function mysqlMaterializationFingerprint(value: unknown): string {
  return checksum({ registryVersion: MYSQL_MATERIALIZATION_REGISTRY_VERSION, request: parseMySqlExerciseRequest(value) })
}

export function isRegisteredMySqlSql(value: string): boolean {
  return [schemaTemplates['orders-v1'], queryTemplates['orders-by-user-created-v1'], '/* no secondary index: the learner must identify the missing index */', '/* non-sargable query shape is supplied by the registered query template */'].includes(value as never) || /^CREATE INDEX idx_orders_user_id_created(?:_at)? ON orders\(user_id, (?:total_cents|created_at DESC)\)$/.test(value)
}
