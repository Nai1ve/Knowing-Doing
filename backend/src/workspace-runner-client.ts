import type { CaseSpec, WorkspaceFile, WorkspaceRun } from './product-types.js'

export interface RunnerFileInput { path: string; content: string }

export interface RunnerCreateResult { runnerRunId: string; leaseExpiresAt: string }
export interface RunnerExecutionResult { runnerExecutionId: string; status: 'succeeded' | 'failed' | 'timed_out' | 'rejected'; stdout: string; stderr: string; exitCode: number | null; durationMs: number }

export interface WorkspaceRunnerClient {
  create(input: { templateKey: string; files: RunnerFileInput[]; commands: string[] }): Promise<RunnerCreateResult>
  status(runnerRunId: string): Promise<{ status: 'active' | 'ended' | 'missing'; leaseExpiresAt: string | null }>
  writeFile(runnerRunId: string, file: RunnerFileInput, expectedRevision: number): Promise<{ revision: number }>
  execute(runnerRunId: string, command: string, clientRequestId: string): Promise<RunnerExecutionResult>
  reset(runnerRunId: string, files: RunnerFileInput[]): Promise<void>
  end(runnerRunId: string): Promise<void>
}

export class WorkspaceRunnerError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true) { super(message); this.name = 'WorkspaceRunnerError' }
}

export class HttpWorkspaceRunnerClient implements WorkspaceRunnerClient {
  constructor(private readonly baseUrl: string, private readonly token: string, private readonly timeoutMs = 35_000) {}

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await fetch(`${this.baseUrl.replace(/\/$/, '')}${path}`, { ...init, signal: controller.signal, headers: { 'content-type': 'application/json', 'x-workspace-runner-token': this.token, ...(init.headers ?? {}) } })
      const body = await response.json().catch(() => ({})) as { error?: { code?: string; message?: string } }
      if (!response.ok) throw new WorkspaceRunnerError(body.error?.code ?? `runner_http_${response.status}`, body.error?.message ?? '工作区 Runner 请求失败', response.status >= 500)
      return body as T
    } catch (error) {
      if (error instanceof WorkspaceRunnerError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new WorkspaceRunnerError('runner_timeout', '工作区 Runner 请求超时')
      throw new WorkspaceRunnerError('runner_unavailable', error instanceof Error ? error.message : '工作区 Runner 不可用')
    } finally { clearTimeout(timer) }
  }

  create(input: { templateKey: string; files: RunnerFileInput[]; commands: string[] }): Promise<RunnerCreateResult> { return this.request('/internal/v1/workspace-runs', { method: 'POST', body: JSON.stringify(input) }) }
  status(runnerRunId: string): Promise<{ status: 'active' | 'ended' | 'missing'; leaseExpiresAt: string | null }> { return this.request(`/internal/v1/workspace-runs/${encodeURIComponent(runnerRunId)}`) }
  writeFile(runnerRunId: string, file: RunnerFileInput, expectedRevision: number): Promise<{ revision: number }> { return this.request(`/internal/v1/workspace-runs/${encodeURIComponent(runnerRunId)}/files/${encodeURIComponent(file.path)}`, { method: 'PUT', body: JSON.stringify({ ...file, expectedRevision }) }) }
  execute(runnerRunId: string, command: string, clientRequestId: string): Promise<RunnerExecutionResult> { return this.request(`/internal/v1/workspace-runs/${encodeURIComponent(runnerRunId)}/executions`, { method: 'POST', body: JSON.stringify({ command, clientRequestId }) }) }
  reset(runnerRunId: string, files: RunnerFileInput[]): Promise<void> { return this.request(`/internal/v1/workspace-runs/${encodeURIComponent(runnerRunId)}/reset`, { method: 'POST', body: JSON.stringify({ files }) }).then(() => undefined) }
  end(runnerRunId: string): Promise<void> { return this.request(`/internal/v1/workspace-runs/${encodeURIComponent(runnerRunId)}/end`, { method: 'POST' }).then(() => undefined) }
}

export class FakeWorkspaceRunnerClient implements WorkspaceRunnerClient {
  private readonly runs = new Map<string, { files: Map<string, { content: string; revision: number }>; commands: string[]; ended: boolean; fixtureKind: 'list' | 'order' | 'generic' }>()
  create(input: { templateKey: string; files: RunnerFileInput[]; commands: string[] }): Promise<RunnerCreateResult> {
    const fixtureKind = input.files.some((file) => file.content.includes('zhixing-fixture: python-list-starter')) ? 'list' : input.files.some((file) => file.content.includes('zhixing-fixture: order-starter')) ? 'order' : 'generic'
    const runnerRunId = `fake-${this.runs.size + 1}`; this.runs.set(runnerRunId, { files: new Map(input.files.map((file) => [file.path, { content: file.content, revision: 1 }])), commands: input.commands, ended: false, fixtureKind })
    return Promise.resolve({ runnerRunId, leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() })
  }
  status(runnerRunId: string): Promise<{ status: 'active' | 'ended' | 'missing'; leaseExpiresAt: string | null }> { const run = this.runs.get(runnerRunId); return Promise.resolve(run ? { status: run.ended ? 'ended' : 'active', leaseExpiresAt: new Date(Date.now() + 30 * 60_000).toISOString() } : { status: 'missing', leaseExpiresAt: null }) }
  writeFile(runnerRunId: string, file: RunnerFileInput, expectedRevision: number): Promise<{ revision: number }> { const run = this.runs.get(runnerRunId); if (!run || run.ended) return Promise.reject(new WorkspaceRunnerError('runner_run_not_found', 'Runner 工作区不存在', false)); const current = run.files.get(file.path); if (!current || current.revision !== expectedRevision) return Promise.reject(new WorkspaceRunnerError('file_revision_conflict', 'Runner 文件版本冲突', false)); current.content = file.content; current.revision += 1; return Promise.resolve({ revision: current.revision }) }
  execute(runnerRunId: string, command: string, _clientRequestId: string): Promise<RunnerExecutionResult> { const run = this.runs.get(runnerRunId); if (!run || run.ended) return Promise.reject(new WorkspaceRunnerError('runner_run_not_found', 'Runner 工作区不存在', false)); if (!run.commands.includes(command) && command !== 'pytest -q') return Promise.resolve({ runnerExecutionId: `fake-exec-${Date.now()}`, status: 'rejected', stdout: '', stderr: 'unsupported command', exitCode: 126, durationMs: 0 }); const failed = run.fixtureKind !== 'generic' && [...run.files.values()].some((file) => file.content.includes('zhixing-fixture: order-starter') || file.content.includes('zhixing-fixture: python-list-starter')) && command.includes('pytest'); const output = run.fixtureKind === 'list' ? (failed ? '2 passed, 1 failed' : '3 passed') : failed ? '1 failed, 1 passed' : '2 passed'; return Promise.resolve({ runnerExecutionId: `fake-exec-${Date.now()}`, status: failed ? 'failed' : 'succeeded', stdout: output, stderr: '', exitCode: failed ? 1 : 0, durationMs: 8 }) }
  reset(runnerRunId: string, files: RunnerFileInput[]): Promise<void> { const run = this.runs.get(runnerRunId); if (!run || run.ended) return Promise.reject(new WorkspaceRunnerError('runner_run_not_found', 'Runner 工作区不存在', false)); run.files = new Map(files.map((file) => [file.path, { content: file.content, revision: 1 }])); return Promise.resolve() }
  end(runnerRunId: string): Promise<void> { const run = this.runs.get(runnerRunId); if (run) run.ended = true; return Promise.resolve() }
}
