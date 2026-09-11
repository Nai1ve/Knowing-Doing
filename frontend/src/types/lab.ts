export type LabSessionName = string

export interface LabSession {
  id: string
  name: LabSessionName
  status: 'open' | 'closed'
}

export interface LabRun {
  runId: string
  caseId: string
  revision: number
  status: 'active'
  fixtureVersion: string
  expiresAt: string
  idleExpiresAt: string
  sessions: LabSession[]
}

export interface LabQueueTicket {
  ticketId: string
  caseId: string
  status: 'waiting' | 'ready' | 'expired' | 'cancelled'
  position?: number
  pollAfterMs?: number
  run?: LabRun & { accessToken: string }
  expiresAt: string
}

export interface LabExecutionResult {
  executionId: string
  runId: string
  caseId: string
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
