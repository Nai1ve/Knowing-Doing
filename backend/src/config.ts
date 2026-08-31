import type { CaseId } from './domain.js'

function numberEnv(name: string, fallback: number): number {
  const value = process.env[name]
  if (!value) return fallback
  const parsed = Number(value)
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`)
  return parsed
}

export interface LabConfig {
  host: string
  port: number
  apiHost: string
  apiPort: number
  corsOrigin: string
  runnerUser: string
  runnerPassword: string
  adminUser: string
  adminPassword: string
  tokenSecret: string
  runLeaseMs: number
  runIdleTimeoutMs: number
  queueLeaseMs: number
  queryTimeoutMs: number
  maxRows: number
  maxOutputBytes: number
  runnerPoolSize: number
  productDbPath: string
  modelBaseUrl: string
  modelApiKey: string
  modelName: string
  modelTimeoutMs: number
  caseIds: CaseId[]
}

export function loadConfig(): LabConfig {
  const tokenSecret = process.env.LAB_TOKEN_SECRET ?? 'development-only-change-me'
  if (process.env.NODE_ENV === 'production' && tokenSecret === 'development-only-change-me') {
    throw new Error('LAB_TOKEN_SECRET is required in production')
  }

  return {
    host: process.env.LAB_MYSQL_HOST ?? '127.0.0.1',
    port: Number(process.env.LAB_MYSQL_PORT ?? 3306),
    apiHost: process.env.LAB_API_HOST ?? '127.0.0.1',
    apiPort: Number(process.env.LAB_API_PORT ?? 3000),
    corsOrigin: process.env.LAB_CORS_ORIGIN ?? 'http://localhost:4175',
    runnerUser: process.env.LAB_MYSQL_RUNNER_USER ?? 'zhixing_lab_runner',
    runnerPassword: process.env.LAB_MYSQL_RUNNER_PASSWORD ?? '',
    adminUser: process.env.LAB_MYSQL_ADMIN_USER ?? 'zhixing_lab_admin',
    adminPassword: process.env.LAB_MYSQL_ADMIN_PASSWORD ?? '',
    tokenSecret,
    runLeaseMs: numberEnv('LAB_RUN_LEASE_MS', 20 * 60 * 1000),
    runIdleTimeoutMs: numberEnv('LAB_RUN_IDLE_TIMEOUT_MS', 5 * 60 * 1000),
    queueLeaseMs: numberEnv('LAB_QUEUE_LEASE_MS', 30 * 60 * 1000),
    queryTimeoutMs: numberEnv('LAB_QUERY_TIMEOUT_MS', 10_000),
    maxRows: numberEnv('LAB_MAX_ROWS', 200),
    maxOutputBytes: numberEnv('LAB_MAX_OUTPUT_BYTES', 1024 * 1024),
    runnerPoolSize: numberEnv('LAB_RUNNER_POOL_SIZE', 6),
    productDbPath: process.env.ZHIXING_PRODUCT_DB_PATH ?? './data/zhixing-product.db',
    modelBaseUrl: process.env.ZHIXING_MODEL_BASE_URL ?? '',
    modelApiKey: process.env.ZHIXING_MODEL_API_KEY ?? '',
    modelName: process.env.ZHIXING_MODEL_NAME ?? 'default',
    modelTimeoutMs: numberEnv('ZHIXING_MODEL_TIMEOUT_MS', 5 * 60 * 1000),
    caseIds: [
      'mysql-order-list-index-001',
      'mysql-deadlock-lock-order-001',
      'mysql-deep-pagination-001',
    ],
  }
}
