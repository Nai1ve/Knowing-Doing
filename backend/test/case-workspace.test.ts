import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { FakeWorkspaceRunnerClient } from '../src/workspace-runner-client.js'

async function withService<T>(callback: (service: CaseWorkspaceService, repository: ProductRepository) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-case-workspace-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath)
  const service = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), new FakeWorkspaceRunnerClient())
  try { return await callback(service, repository) } finally { if (repository.db.open) repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

function createWorkspaceNode(repository: ProductRepository, learnerId: string): string {
  repository.ensureLearner(learnerId); const now = new Date().toISOString(); const roadmapId = 'roadmap-workspace-1'; const nodeId = 'node-python-1'
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES (?, ?, 'agent-roadmap-v2', '学习 Python 测试', 'active', 1, '{}', ?, ?)").run(roadmapId, learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES (?, ?, NULL, 'python-testing', 'lab', 'Python 测试实践', '完成一个 Python 测试修复案例。', '{}', '测试通过', 90, 1, 1, 'workspace', 'python.testing', NULL, ?)").run(nodeId, roadmapId, now)
  return nodeId
}

describe('CaseWorkspaceService', () => {
  it('creates an idempotent fixture case and executes a real workspace-shaped flow', async () => withService(async (service, repository) => {
    const learnerId = 'workspace-learner'; const nodeId = createWorkspaceNode(repository, learnerId)
    const first = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '我想练习如何阅读测试并修复边界条件。' }, clientRequestId: 'case-1' })
    const duplicate = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '我想练习如何阅读测试并修复边界条件。' }, clientRequestId: 'case-1' })
    expect(duplicate.job.id).toBe(first.job.id)
    const sameFingerprint = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '我想练习如何阅读测试并修复边界条件。' }, clientRequestId: 'case-2' })
    expect(sameFingerprint.case.id).toBe(first.case.id)
    expect(sameFingerprint.job.id).toBe(first.job.id)
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, first.job.id).job.status).toBe('succeeded'))
    const ready = service.getCaseGenerationJob(learnerId, first.job.id)
    expect(ready.case.provider).toBe('fixture'); expect(ready.case.spec?.environment.templateKey).toBe('python-pytest-v1')

    const workspace = await service.startPractice(learnerId, ready.case.id)
    expect(workspace.workspace.status).toBe('active'); expect(workspace.files).toHaveLength(3)
    const failed = await service.execute(learnerId, workspace.workspace.id, 'pytest -q', 'exec-1')
    expect(failed.execution.status).toBe('failed')
    const source = workspace.files.find((file) => file.path === 'src/order_summary.py')!
    const fixed = await service.saveFile(learnerId, workspace.workspace.id, source.path, '# fixed implementation\n', source.revision)
    expect(fixed.files.find((file) => file.path === source.path)?.revision).toBe(2)
    const succeeded = await service.execute(learnerId, workspace.workspace.id, 'pytest -q', 'exec-2')
    expect(succeeded.execution.status).toBe('succeeded')
    const snapshot = repository.snapshot(workspace.practice.id)
    expect(snapshot.artifacts.map((artifact) => artifact.kind)).toEqual(expect.arrayContaining(['workspace_file', 'workspace_command', 'workspace_output']))
    expect(repository.db.prepare('SELECT COUNT(*) AS count FROM learning_cases WHERE learner_id = ?').get(learnerId)).toMatchObject({ count: 1 })
  }))

  it('protects ownership, revision conflicts and active workspace uniqueness', async () => withService(async (service, repository) => {
    const learnerId = 'owner-workspace'; const nodeId = createWorkspaceNode(repository, learnerId)
    const created = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '测试所有权。' }, clientRequestId: 'owner-case' })
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, created.job.id).job.status).toBe('succeeded'))
    const item = service.getCaseGenerationJob(learnerId, created.job.id).case; const first = await service.startPractice(learnerId, item.id); const second = await service.startPractice(learnerId, item.id)
    expect(second.workspace.id).toBe(first.workspace.id)
    expect(() => service.getWorkspace('other-workspace', first.workspace.id)).toThrow('工作区不存在')
    const file = first.files[0]!; await expect(service.saveFile(learnerId, first.workspace.id, file.path, 'stale', file.revision + 1)).rejects.toMatchObject({ code: 'file_revision_conflict' })
    const filePlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM workspace_files WHERE workspace_run_id = ? ORDER BY path').all(first.workspace.id) as Array<{ detail: string }>
    expect(filePlan.some((row) => row.detail.includes('idx_workspace_files_run_path'))).toBe(true)
    const jobPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM case_generation_jobs WHERE learner_id = ? AND status = ? ORDER BY updated_at DESC').all(learnerId, 'succeeded') as Array<{ detail: string }>
    expect(jobPlan.some((row) => row.detail.includes('idx_case_jobs_learner_status_updated'))).toBe(true)
    const executionPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM workspace_executions WHERE workspace_run_id = ? ORDER BY sequence DESC LIMIT ?').all(first.workspace.id, 20) as Array<{ detail: string }>
    expect(executionPlan.some((row) => row.detail.includes('idx_workspace_executions_run_sequence'))).toBe(true)
  }))
})
