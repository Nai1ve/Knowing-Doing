import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { LabStore } from '../src/mysql-store.js'
import { buildApp } from '../src/app.js'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { loadConfig } from '../src/config.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'
import { FakeWorkspaceRunnerClient } from '../src/workspace-runner-client.js'

const noopStore: LabStore = {
  async reset() {},
  async createSession() { throw new Error('unused') },
  async execute() { throw new Error('unused') },
  async closeConnection() {},
}

describe('case workspace routes', () => {
  const cleanup: Array<() => void> = []
  afterEach(() => { while (cleanup.length) cleanup.pop()?.() })

  function setup() {
    const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-case-routes-'))
    const dbPath = path.join(directory, 'product.db')
    applyProductMigrations(dbPath)
    const repository = new ProductRepository(dbPath)
    const service = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()))
    const app = buildApp({
      config: { ...loadConfig(), legacyHeaderLearnerId: true, signedDeviceSessionEnabled: false, practiceCardV2Enabled: false, mixedGymEnabled: false },
      store: noopStore,
      caseWorkspaceServiceFactory: () => service,
    }).app
    cleanup.push(() => { void app.close(); repository.close(); rmSync(directory, { recursive: true, force: true }) })
    return { repository, service, app }
  }

  function seedNode(repository: ProductRepository, learnerId: string): string {
    const now = new Date().toISOString()
    repository.ensureLearner(learnerId)
    repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES ('route-roadmap', ?, 'agent-roadmap-v2', '学习 Python 测试', 'active', 1, '{}', ?, ?)").run(learnerId, now, now)
    repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES ('route-node', 'route-roadmap', NULL, 'python-testing', 'lab', 'Python 测试实践', '完成一个 Python 测试修复案例。', '{}', '测试通过', 90, 1, 1, 'workspace', 'python.testing', NULL, ?)").run(now)
    return 'route-node'
  }

  async function readyWorkspace(app: ReturnType<typeof setup>['app'], service: CaseWorkspaceService, repository: ProductRepository, learnerId: string): Promise<{ workspaceId: string; caseId: string; jobId: string }> {
    const nodeId = seedNode(repository, learnerId)
    const created = await app.inject({ method: 'POST', url: `/api/product/roadmap-nodes/${nodeId}/case-requests`, headers: { 'x-learner-id': learnerId }, payload: { input: { kind: 'brief', brief: '练习测试修复并验证。' }, clientRequestId: 'route-ready' } })
    const { case: createdCase, job } = created.json<{ case: { id: string }; job: { id: string } }>()
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, job.id).job.status).toBe('succeeded'))
    const practiced = await app.inject({ method: 'POST', url: `/api/product/learning-cases/${createdCase.id}/practice`, headers: { 'x-learner-id': learnerId } })
    expect(practiced.statusCode).toBe(201)
    return { workspaceId: practiced.json<{ workspace: { id: string } }>().workspace.id, caseId: createdCase.id, jobId: job.id }
  }

  it('maps workspace route statuses and enforces learner ownership over HTTP', async () => {
    const { repository, service, app } = setup()
    const learnerId = 'route-owner'; const otherLearner = 'route-other'
    const nodeId = seedNode(repository, learnerId)
    const created = await app.inject({ method: 'POST', url: `/api/product/roadmap-nodes/${nodeId}/case-requests`, headers: { 'x-learner-id': learnerId }, payload: { input: { kind: 'brief', brief: '练习测试修复。' }, clientRequestId: 'route-1' } })
    expect(created.statusCode).toBe(202)
    const { case: createdCase, job } = created.json<{ case: { id: string }; job: { id: string } }>()
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, job.id).job.status).toBe('succeeded'))

    const owned = await app.inject({ method: 'GET', url: `/api/product/case-generation-jobs/${job.id}`, headers: { 'x-learner-id': learnerId } })
    expect(owned.statusCode).toBe(200)
    const foreign = await app.inject({ method: 'GET', url: `/api/product/case-generation-jobs/${job.id}`, headers: { 'x-learner-id': otherLearner } })
    expect(foreign.statusCode).toBe(404)

    const practiced = await app.inject({ method: 'POST', url: `/api/product/learning-cases/${createdCase.id}/practice`, headers: { 'x-learner-id': learnerId } })
    expect(practiced.statusCode).toBe(201)
    const workspaceId = practiced.json<{ workspace: { id: string } }>().workspace.id

    const failedExec = await app.inject({ method: 'POST', url: `/api/product/workspace-runs/${workspaceId}/executions`, headers: { 'x-learner-id': learnerId }, payload: { command: 'pytest -q', clientRequestId: 'route-exec-1' } })
    expect(failedExec.statusCode).toBe(422)
    expect(failedExec.json<{ execution: { status: string } }>().execution.status).toBe('failed')

    const foreignWorkspace = await app.inject({ method: 'GET', url: `/api/product/workspace-runs/${workspaceId}`, headers: { 'x-learner-id': otherLearner } })
    expect(foreignWorkspace.statusCode).toBe(404)
  })

  it('round-trips encoded file paths, rejects stale revisions, and refuses writes after end', async () => {
    const { repository, service, app } = setup()
    const learnerId = 'route-file'
    const { workspaceId } = await readyWorkspace(app, service, repository, learnerId)

    const filePath = 'src/order_summary.py'
    const encoded = encodeURIComponent(filePath)
    const url = (action: string) => `/api/product/workspace-runs/${workspaceId}/files/${encoded}${action}`
    const headers = { 'x-learner-id': learnerId }

    const stale = await app.inject({ method: 'PATCH', url: url(''), headers, payload: { content: '# x\n', expectedRevision: 99 } })
    expect(stale.statusCode).toBe(409)
    expect(stale.json<{ error: { code: string } }>().error.code).toBe('file_revision_conflict')

    const saved = await app.inject({ method: 'PATCH', url: url(''), headers, payload: { content: '# fixed implementation\n', expectedRevision: 1 } })
    expect(saved.statusCode).toBe(200)
    expect(saved.json<{ files: Array<{ path: string; revision: number }> }>().files.find((file) => file.path === filePath)?.revision).toBe(2)

    const readBack = await app.inject({ method: 'GET', url: url(''), headers })
    expect(readBack.statusCode).toBe(200)
    expect(readBack.json<{ content: string }>().content).toContain('# fixed implementation')

    const ended = await app.inject({ method: 'POST', url: `/api/product/workspace-runs/${workspaceId}/end`, headers })
    expect(ended.statusCode).toBe(200)
    const afterEnd = await app.inject({ method: 'PATCH', url: url(''), headers, payload: { content: '# nope\n', expectedRevision: 2 } })
    expect(afterEnd.statusCode).toBe(409)
    expect(afterEnd.json<{ error: { code: string } }>().error.code).toBe('workspace_not_active')
  })
})
