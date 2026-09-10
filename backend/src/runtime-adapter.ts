import { getEnvironmentTemplate } from './environment-registry.js'
import type { RuntimeKind } from './product-types.js'
import type { RunnerCreateResult, RunnerExecutionResult, RunnerFileInput, WorkspaceRunnerClient } from './workspace-runner-client.js'
import { WorkspaceRunnerError } from './workspace-runner-client.js'

export interface RuntimeAdapter {
  readonly runtimeKind: RuntimeKind
  provision(input: { environmentKey: string; environmentVersion: string; files: RunnerFileInput[]; commands: string[] }): Promise<RunnerCreateResult>
  status(runId: string): ReturnType<WorkspaceRunnerClient['status']>
  writeFile(runId: string, file: RunnerFileInput, expectedRevision: number): ReturnType<WorkspaceRunnerClient['writeFile']>
  execute(runId: string, command: string, clientRequestId: string): Promise<RunnerExecutionResult>
  reset(runId: string, files: RunnerFileInput[]): ReturnType<WorkspaceRunnerClient['reset']>
  end(runId: string): ReturnType<WorkspaceRunnerClient['end']>
}

/**
 * The Docker runner is deliberately behind an environment-aware adapter.
 * The adapter receives a server-resolved template; callers cannot select an image or Docker option.
 */
export class DockerWorkspaceRuntimeAdapter implements RuntimeAdapter {
  readonly runtimeKind = 'docker_workspace' as const

  constructor(private readonly runner: WorkspaceRunnerClient) {}

  private template(environmentKey: string, environmentVersion: string) {
    const template = getEnvironmentTemplate(environmentKey, environmentVersion)
    if (!template || template.status !== 'available' || template.runtimeKind !== this.runtimeKind) {
      throw new WorkspaceRunnerError('workspace_environment_unavailable', '当前环境模板不可用于 Docker 工作区', false)
    }
    return template
  }

  async provision(input: { environmentKey: string; environmentVersion: string; files: RunnerFileInput[]; commands: string[] }): Promise<RunnerCreateResult> {
    const template = this.template(input.environmentKey, input.environmentVersion)
    return this.runner.create({ templateKey: template.key, files: input.files, commands: input.commands })
  }

  status(runId: string) { return this.runner.status(runId) }
  writeFile(runId: string, file: RunnerFileInput, expectedRevision: number) { return this.runner.writeFile(runId, file, expectedRevision) }
  execute(runId: string, command: string, clientRequestId: string) { return this.runner.execute(runId, command, clientRequestId) }
  reset(runId: string, files: RunnerFileInput[]) { return this.runner.reset(runId, files) }
  end(runId: string) { return this.runner.end(runId) }
}
