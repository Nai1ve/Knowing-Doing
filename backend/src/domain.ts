export const CASE_IDS = [
  'mysql-order-list-index-001',
  'mysql-deadlock-lock-order-001',
  'mysql-deep-pagination-001',
] as const

export type CaseId = (typeof CASE_IDS)[number]
export type SessionName = 'default' | 'tx-a' | 'tx-b'

export type RunStatus = 'active' | 'expired' | 'released'
export type QueueStatus = 'waiting' | 'ready' | 'expired' | 'cancelled'

export interface CaseManifest {
  id: CaseId
  title: string
  schema: string
  allowedSessions: SessionName[]
  fixtureVersion: string
  tables: string[]
  baselineIndexes: Record<string, Record<string, string>>
}

export interface LabTokenPayload {
  sub: string
  caseId: CaseId
  revision: number
  scope: 'lab:execute'
  exp: number
}

export interface RunView {
  runId: string
  caseId: CaseId
  revision: number
  status: 'active'
  fixtureVersion: string
  expiresAt: string
  idleExpiresAt: string
  sessions: Array<{ id: string; name: SessionName; status: 'open' | 'closed' }>
}

export interface QueueTicketView {
  ticketId: string
  caseId: CaseId
  status: QueueStatus
  position?: number
  pollAfterMs?: number
  run?: RunView & { accessToken: string }
  expiresAt: string
}

export interface LabExecutionResult {
  executionId: string
  runId: string
  caseId: CaseId
  revision: number
  clientRequestId: string
  session: SessionName
  statement: string
  status: 'succeeded' | 'failed' | 'rejected' | 'timed_out'
  startedAt: string
  durationMs: number
  result?: {
    kind: 'result_set' | 'command'
    columns?: string[]
    rows?: unknown[][]
    rowCount?: number
    affectedRows?: number
    warningCount?: number
    truncated: boolean
    rawOutput: string
  }
  error?: {
    code: string
    message: string
    sqlState?: string
    retryable: boolean
  }
}
