import type {
  LabCaseId,
  LabCaseSummary,
  LabExecutionResponse,
  LabExecutionResult,
  LabHealth,
  LabQueueTicket,
  LabRun,
  LabRunQueuedResponse,
  LabRunStartedResponse,
  LabSession,
  LabSessionName,
} from '@/types/lab'

const baseUrl = (import.meta.env.VITE_LAB_API_BASE_URL ?? '/api/lab').replace(/\/$/, '')

export class LabApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
    public readonly payload?: unknown,
  ) {
    super(message)
    this.name = 'LabApiError'
  }
}

function errorMessage(payload: unknown, status: number): string {
  if (payload && typeof payload === 'object' && 'error' in payload) {
    const error = (payload as { error?: { message?: unknown } }).error
    if (typeof error?.message === 'string') return error.message
  }
  return `Lab 请求失败（${status}）`
}

async function request<T>(path: string, init: RequestInit = {}, token?: string, acceptedErrorStatuses: number[] = []): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('Accept', 'application/json')
  if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
  if (token) headers.set('Authorization', `Bearer ${token}`)

  const response = await fetch(`${baseUrl}${path}`, { ...init, headers })
  const text = await response.text()
  let payload: unknown
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  if (!response.ok && !acceptedErrorStatuses.includes(response.status)) {
    throw new LabApiError(response.status, errorMessage(payload, response.status), payload)
  }
  return payload as T
}

export function getLabHealth(): Promise<LabHealth> {
  return request<LabHealth>('/health')
}

export function getLabCases(): Promise<LabCaseSummary[]> {
  return request<LabCaseSummary[]>('/cases')
}

export function createLabRun(caseId: LabCaseId): Promise<LabRunStartedResponse | LabRunQueuedResponse> {
  return request('/runs', { method: 'POST', body: JSON.stringify({ caseId }) })
}

export function getQueueTicket(ticketId: string): Promise<LabQueueTicket> {
  return request<LabQueueTicket>(`/queue-tickets/${ticketId}`)
}

export function cancelQueueTicket(ticketId: string): Promise<void> {
  return request<void>(`/queue-tickets/${ticketId}`, { method: 'DELETE' })
}

export function getLabRun(runId: string, token: string): Promise<LabRun> {
  return request<LabRun>(`/runs/${runId}`, {}, token)
}

export function deleteLabRun(runId: string, token: string): Promise<void> {
  return request<void>(`/runs/${runId}`, { method: 'DELETE' }, token)
}

export function createLabSession(runId: string, token: string, name: LabSessionName): Promise<LabSession> {
  return request<LabSession>(`/runs/${runId}/sessions`, { method: 'POST', body: JSON.stringify({ name }) }, token)
}

export function executeLabSql(
  runId: string,
  token: string,
  payload: { revision: number; sessionId: string; statement: string; clientRequestId: string },
): Promise<LabExecutionResponse> {
  return request<LabExecutionResult>(`/runs/${runId}/execute`, { method: 'POST', body: JSON.stringify(payload) }, token)
    .catch((error: unknown) => {
      if (!(error instanceof LabApiError) || ![422, 504].includes(error.status)) throw error

      if (error.payload && typeof error.payload === 'object' && 'executionId' in error.payload) {
        return error.payload as LabExecutionResult
      }

      const envelope = error.payload && typeof error.payload === 'object' && 'error' in error.payload
        ? (error.payload as { error?: { code?: unknown; message?: unknown; retryable?: unknown } }).error
        : undefined
      if (!envelope || typeof envelope.code !== 'string' || typeof envelope.message !== 'string') throw error
      return {
        kind: 'request_error' as const,
        status: error.status === 504 ? 'timed_out' as const : 'rejected' as const,
        statusCode: error.status,
        error: {
          code: envelope.code,
          message: envelope.message,
          retryable: envelope.retryable === true,
        },
      }
    })
}

export function resetLabRun(runId: string, token: string, revision: number): Promise<{ run: LabRun; accessToken: string }> {
  return request<{ run: LabRun; accessToken: string }>(`/runs/${runId}/reset`, { method: 'POST', body: JSON.stringify({ revision }) }, token)
}
