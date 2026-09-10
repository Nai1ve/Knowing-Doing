import { describe, expect, it } from 'vitest'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'
import { FakeWorkspaceRunnerClient } from '../src/workspace-runner-client.js'

describe('DockerWorkspaceRuntimeAdapter', () => {
  it('only provisions a server-registered Docker environment', async () => {
    const adapter = new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient())
    const created = await adapter.provision({ environmentKey: 'python-pytest-v1', environmentVersion: '1', files: [{ path: 'README.md', content: 'ok' }], commands: ['pytest -q'] })
    expect(created.runnerRunId).toBe('fake-1')
    await expect(adapter.provision({ environmentKey: 'mysql-performance-v1', environmentVersion: '1', files: [], commands: [] })).rejects.toMatchObject({ code: 'workspace_environment_unavailable' })
    const go = await adapter.provision({ environmentKey: 'go-test-v1', environmentVersion: '1', files: [{ path: 'go.mod', content: 'module example.com/test\n\ngo 1.24\n' }], commands: ['go test ./...'] })
    expect(go.runnerRunId).toBe('fake-2')
  })
})
