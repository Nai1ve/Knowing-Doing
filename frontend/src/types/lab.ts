export const PRIMARY_LAB_CASE = 'mysql-order-list-index-001' as const

export type LabCaseId =
  | 'mysql-order-list-index-001'
  | 'mysql-deadlock-lock-order-001'
  | 'mysql-deep-pagination-001'

export type LabSessionName = 'default' | 'tx-a' | 'tx-b'

export interface LabCaseSummary {
  id: LabCaseId
  title: string
  fixtureVersion: string
  allowedSessions: LabSessionName[]
}

export interface LabFixtureStatus {
  ready: boolean
  fixtureVersion: string
  error?: string
}

export interface LabHealth {
  ready: boolean
  fixtures: Record<LabCaseId, LabFixtureStatus>
  cases: Array<{ caseId: LabCaseId; activeRunId?: string; queueLength: number }>
}

export interface LabSession {
  id: string
  name: LabSessionName
  status: 'open' | 'closed'
}

export interface LabRun {
  runId: string
  caseId: LabCaseId
  revision: number
  status: 'active'
  fixtureVersion: string
  expiresAt: string
  idleExpiresAt: string
  sessions: LabSession[]
}

export interface LabQueueTicket {
  ticketId: string
  caseId: LabCaseId
  status: 'waiting' | 'ready' | 'expired' | 'cancelled'
  position?: number
  pollAfterMs?: number
  run?: LabRun & { accessToken: string }
  expiresAt: string
}

export interface LabExecutionResult {
  executionId: string
  runId: string
  caseId: LabCaseId
  revision: number
  clientRequestId: string
  session: LabSessionName
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

export interface LabRequestErrorResult {
  kind: 'request_error'
  status: 'rejected' | 'timed_out'
  statusCode: number
  error: {
    code: string
    message: string
    retryable: boolean
  }
}

export type LabExecutionResponse = LabExecutionResult | LabRequestErrorResult

export interface LabRunStartedResponse {
  run: LabRun
  accessToken: string
}

export interface LabRunQueuedResponse {
  ticket: LabQueueTicket
}
