import { setTimeout as delay } from 'node:timers/promises'
import { environmentBuildAdapterEventSchema, environmentBuildTaskStatusSchema, OpenHandsBuildAdapterError, type OpenHandsBuildAdapter, type OpenHandsBuildTaskInput, type OpenHandsMySqlExecution, type OpenHandsMySqlRuntime, type OpenHandsMySqlRuntimeInput } from './environment-build.js'

type HttpAdapterOptions = { baseUrl: string; token: string; timeoutMs: number }

/** Internal-only client. Public product routes never receive this endpoint or token. */
export class HttpOpenHandsBuildAdapter implements OpenHandsBuildAdapter {
  constructor(private readonly options: HttpAdapterOptions) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs)
    try {
      const response = await fetch(`${this.options.baseUrl.replace(/\/$/, '')}${path}`, {
        ...init,
        headers: { 'content-type': 'application/json', 'x-case-builder-token': this.options.token, ...init.headers },
        signal: controller.signal,
      })
      const raw = await response.text()
      let payload: unknown = null
      try { payload = raw ? JSON.parse(raw) : null } catch { throw new OpenHandsBuildAdapterError('case_builder_non_json', 'Case Builder 返回了非 JSON 响应') }
      if (!response.ok) {
        const message = payload && typeof payload === 'object' && 'error' in payload ? String((payload as { error?: { message?: unknown } }).error?.message ?? 'Case Builder 请求失败') : 'Case Builder 请求失败'
        throw new OpenHandsBuildAdapterError('case_builder_http_error', message)
      }
      return payload as T
    } catch (error) {
      if (error instanceof OpenHandsBuildAdapterError) throw error
      const message = error instanceof Error && error.name === 'AbortError' ? 'Case Builder 请求超时' : error instanceof Error ? error.message : 'Case Builder 不可用'
      throw new OpenHandsBuildAdapterError('case_builder_unavailable', message)
    } finally { clearTimeout(timer) }
  }

  async createTask(input: OpenHandsBuildTaskInput): Promise<{ taskId: string }> {
    const payload = await this.request<{ taskId?: unknown }>('/internal/v1/environment-builds', { method: 'POST', body: JSON.stringify(input) })
    if (typeof payload.taskId !== 'string' || !payload.taskId) throw new OpenHandsBuildAdapterError('case_builder_invalid_task', 'Case Builder 未返回任务标识')
    return { taskId: payload.taskId }
  }

  async events(taskId: string, afterSequence: number): Promise<{ events: ReturnType<typeof environmentBuildAdapterEventSchema.parse>[]; nextSequence: number }> {
    const payload = await this.request<{ events?: unknown; nextSequence?: unknown }>(`/internal/v1/environment-builds/${encodeURIComponent(taskId)}/events?afterSequence=${afterSequence}`)
    if (!Array.isArray(payload.events) || !Number.isInteger(payload.nextSequence)) throw new OpenHandsBuildAdapterError('case_builder_invalid_events', 'Case Builder 事件格式无效')
    return { events: payload.events.map((event) => environmentBuildAdapterEventSchema.parse(event)), nextSequence: Number(payload.nextSequence) }
  }

  async status(taskId: string) {
    return environmentBuildTaskStatusSchema.parse(await this.request(`/internal/v1/environment-builds/${encodeURIComponent(taskId)}`))
  }

  async cancel(taskId: string): Promise<void> { await this.request(`/internal/v1/environment-builds/${encodeURIComponent(taskId)}/cancel`, { method: 'POST', body: '{}' }) }
  async cleanup(input: { buildId: string; attemptId?: string | null; retainRuntimeArtifact?: boolean }): Promise<void> { await this.request('/internal/v1/environment-builds/cleanup', { method: 'POST', body: JSON.stringify(input) }) }
  async startMySqlRuntime(input: OpenHandsMySqlRuntimeInput): Promise<OpenHandsMySqlRuntime> {
    const payload = await this.request<Partial<OpenHandsMySqlRuntime>>('/internal/v1/mysql-runtimes', { method: 'POST', body: JSON.stringify(input) })
    if (typeof payload.runtimeId !== 'string' || !payload.runtimeId || typeof payload.leaseExpiresAt !== 'string') throw new OpenHandsBuildAdapterError('case_builder_invalid_mysql_runtime', 'Case Builder 未返回有效 MySQL 运行时')
    return { runtimeId: payload.runtimeId, leaseExpiresAt: payload.leaseExpiresAt }
  }
  async resetMySqlRuntime(runtimeId: string): Promise<void> { await this.request(`/internal/v1/mysql-runtimes/${encodeURIComponent(runtimeId)}/reset`, { method: 'POST', body: '{}' }) }
  async createMySqlSession(runtimeId: string, name: string): Promise<{ sessionId: string }> {
    const payload = await this.request<{ sessionId?: unknown }>(`/internal/v1/mysql-runtimes/${encodeURIComponent(runtimeId)}/sessions`, { method: 'POST', body: JSON.stringify({ name }) })
    if (typeof payload.sessionId !== 'string' || !payload.sessionId) throw new OpenHandsBuildAdapterError('case_builder_invalid_mysql_session', 'Case Builder 未返回有效 MySQL 会话')
    return { sessionId: payload.sessionId }
  }
  async executeMySql(runtimeId: string, sessionId: string, statement: string): Promise<OpenHandsMySqlExecution> {
    const payload = await this.request<Partial<OpenHandsMySqlExecution>>(`/internal/v1/mysql-runtimes/${encodeURIComponent(runtimeId)}/sessions/${encodeURIComponent(sessionId)}/executions`, { method: 'POST', body: JSON.stringify({ statement }) })
    if ((payload.status !== 'succeeded' && payload.status !== 'failed' && payload.status !== 'timed_out') || typeof payload.stdout !== 'string' || typeof payload.stderr !== 'string' || (payload.exitCode !== null && typeof payload.exitCode !== 'number') || typeof payload.durationMs !== 'number') throw new OpenHandsBuildAdapterError('case_builder_invalid_mysql_execution', 'Case Builder MySQL 执行响应无效')
    return payload as OpenHandsMySqlExecution
  }
  async closeMySqlSession(runtimeId: string, sessionId: string): Promise<void> { await this.request(`/internal/v1/mysql-runtimes/${encodeURIComponent(runtimeId)}/sessions/${encodeURIComponent(sessionId)}/end`, { method: 'POST', body: '{}' }) }
  async endMySqlRuntime(runtimeId: string): Promise<void> { await this.request(`/internal/v1/mysql-runtimes/${encodeURIComponent(runtimeId)}/end`, { method: 'POST', body: '{}' }) }
}

/**
 * Used only when the feature flag is deliberately off. It fails closed rather
 * than silently reaching for a model or Docker socket from the API process.
 */
export class DisabledOpenHandsBuildAdapter implements OpenHandsBuildAdapter {
  async createTask(): Promise<{ taskId: string }> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async events(): Promise<{ events: []; nextSequence: number }> { return { events: [], nextSequence: 0 } }
  async status(_taskId: string): Promise<never> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async cancel(): Promise<void> { return undefined }
  async cleanup(): Promise<void> { return undefined }
  async startMySqlRuntime(): Promise<never> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async resetMySqlRuntime(): Promise<void> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async createMySqlSession(): Promise<never> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async executeMySql(): Promise<never> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async closeMySqlSession(): Promise<void> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
  async endMySqlRuntime(): Promise<void> { throw new OpenHandsBuildAdapterError('case_builder_disabled', 'OpenHands 环境构建器尚未启用') }
}

/** Poll helper keeps adapter event handling deterministic and testable. */
export async function waitForBuildTask(adapter: OpenHandsBuildAdapter, taskId: string, options: { afterSequence?: number; pollMs?: number; timeoutMs: number; onEvents: (events: Awaited<ReturnType<OpenHandsBuildAdapter['events']>>['events']) => Promise<void> | void }): Promise<Awaited<ReturnType<OpenHandsBuildAdapter['status']>>> {
  const deadline = Date.now() + options.timeoutMs
  let cursor = options.afterSequence ?? 0
  while (Date.now() < deadline) {
    const batch = await adapter.events(taskId, cursor)
    if (batch.events.length > 0) await options.onEvents(batch.events)
    cursor = Math.max(cursor, batch.nextSequence)
    const status = await adapter.status(taskId)
    if (status.status !== 'queued' && status.status !== 'running') return status
    await delay(options.pollMs ?? 250)
  }
  throw new OpenHandsBuildAdapterError('case_builder_task_timeout', 'OpenHands 构建任务超时')
}
