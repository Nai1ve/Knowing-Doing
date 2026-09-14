import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder, ModelCaseBuilder } from '../src/case-builder.js'
import type { CaseBuilderProvider } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { FakeWorkspaceRunnerClient, WorkspaceRunnerError } from '../src/workspace-runner-client.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'

async function withService<T>(callback: (service: CaseWorkspaceService, repository: ProductRepository) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-case-workspace-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath)
  const service = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()))
  try { return await callback(service, repository) } finally { if (repository.db.open) repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

function createWorkspaceNode(repository: ProductRepository, learnerId: string): string {
  repository.ensureLearner(learnerId); const now = new Date().toISOString(); const roadmapId = 'roadmap-workspace-1'; const nodeId = 'node-python-1'
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES (?, ?, 'agent-roadmap-v2', '学习 Python 测试', 'active', 1, '{}', ?, ?)").run(roadmapId, learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES (?, ?, NULL, 'python-testing', 'lab', 'Python 测试实践', '完成一个 Python 测试修复案例。', '{}', '测试通过', 90, 1, 1, 'workspace', 'python.testing', NULL, ?)").run(nodeId, roadmapId, now)
  repository.db.prepare("INSERT INTO roadmap_node_evidence(id, roadmap_id, node_id, source_type, source_id, excerpt, position, created_at) VALUES ('workspace-evidence-1', ?, ?, 'planning_message', 'message-1', '用户希望通过测试定位边界条件并验证修复。', 1, ?)").run(roadmapId, nodeId, now)
  repository.db.prepare("INSERT INTO learner_profile_snapshots(id, learner_id, planning_session_id, version, status, input_fingerprint, summary_json, created_at) VALUES ('workspace-profile-1', ?, NULL, 1, 'current', 'profile-fingerprint', '{}', ?)").run(learnerId, now)
  repository.db.prepare("INSERT INTO learner_profile_dimensions(id, snapshot_id, dimension_key, level, confidence, summary, next_validation) VALUES ('workspace-dimension-1', 'workspace-profile-1', 'python.testing', 'exposed', 0.6, '接触过测试但需要实践验证。', '完成一次 pytest 修复案例。')").run()
  return nodeId
}

// The stock fake always reports active runs; the scripted subclass lets each
// scenario control how the runner answers after a restart (ended, missing,
// unreachable) without needing a real Docker daemon.
class ScriptedWorkspaceRunnerClient extends FakeWorkspaceRunnerClient {
  failStatusWith: WorkspaceRunnerError | null = null
  override status(runnerRunId: string) {
    if (this.failStatusWith) return Promise.reject(this.failStatusWith)
    return super.status(runnerRunId)
  }
}

async function withScriptedService<T>(callback: (service: CaseWorkspaceService, repository: ProductRepository, fake: ScriptedWorkspaceRunnerClient) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-case-resume-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath)
  const fake = new ScriptedWorkspaceRunnerClient()
  const service = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(fake))
  try { return await callback(service, repository, fake) } finally { if (repository.db.open) repository.close(); rmSync(directory, { recursive: true, force: true }) }
}

async function withBuilderService<T>(builder: CaseBuilderProvider, callback: (service: CaseWorkspaceService, repository: ProductRepository) => Promise<T> | T): Promise<T> {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-case-retry-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath)
  const service = new CaseWorkspaceService(repository, builder, new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()))
  try { return await callback(service, repository) } finally { if (repository.db.open) repository.close(); rmSync(directory, { recursive: true, force: true }) }
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
    expect(ready.case).toMatchObject({ environmentKey: 'python-pytest-v1', environmentVersion: '1', runtimeKind: 'docker_workspace' })
    expect(ready.case.inputSnapshot.context).toMatchObject({ roadmapRationale: [{ sourceType: 'planning_message', sourceId: 'message-1' }], learnerProfile: { snapshotId: 'workspace-profile-1', dimensions: [{ key: 'python.testing', level: 'exposed' }] } })
    expect(repository.db.prepare('SELECT phase, status FROM case_generation_attempts WHERE case_generation_job_id = ?').all(first.job.id)).toEqual([{ phase: 'generate', status: 'succeeded' }])

    const workspace = await service.startPractice(learnerId, ready.case.id)
    expect(workspace.workspace.status).toBe('active'); expect(workspace.files).toHaveLength(3)
    expect(workspace.environment).toMatchObject({ key: 'python-pytest-v1', version: '1', runtimeKind: 'docker_workspace' })
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
    const ended = await service.end(learnerId, workspace.workspace.id)
    expect(ended.workspace.status).toBe('ended')
    await expect(service.execute(learnerId, workspace.workspace.id, 'pytest -q', 'exec-after-end')).rejects.toMatchObject({ code: 'workspace_not_active' })
    await expect(service.saveFile(learnerId, workspace.workspace.id, source.path, 'after end', fixed.files.find((file) => file.path === source.path)!.revision)).rejects.toMatchObject({ code: 'workspace_not_active' })
  }))

  it('protects ownership, revision conflicts and active workspace uniqueness', async () => withService(async (service, repository) => {
    const learnerId = 'owner-workspace'; const nodeId = createWorkspaceNode(repository, learnerId)
    const created = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '测试所有权。' }, clientRequestId: 'owner-case' })
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, created.job.id).job.status).toBe('succeeded'))
    const item = service.getCaseGenerationJob(learnerId, created.job.id).case; const first = await service.startPractice(learnerId, item.id); const second = await service.startPractice(learnerId, item.id)
    expect(second.workspace.id).toBe(first.workspace.id)
    expect(() => service.getWorkspace('other-workspace', first.workspace.id)).toThrow('工作区不存在')
    const file = first.files[0]!; await expect(service.saveFile(learnerId, first.workspace.id, file.path, 'stale', file.revision + 1)).rejects.toMatchObject({ code: 'file_revision_conflict' })
    const largeContent = 'x'.repeat(240 * 1024)
    const now = new Date().toISOString()
    const insertExtraFile = repository.db.prepare('INSERT INTO workspace_files(id, workspace_run_id, path, content, checksum, revision, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 1, ?, ?)')
    for (let index = 0; index < 9; index += 1) insertExtraFile.run(`extra-${index}`, first.workspace.id, `extra-${index}.txt`, largeContent, 'fixture', now, now)
    await expect(service.saveFile(learnerId, first.workspace.id, file.path, 'replacement', file.revision)).rejects.toMatchObject({ code: 'workspace_total_too_large' })
    expect(service.getWorkspace(learnerId, first.workspace.id).workspace.status).toBe('active')
    const filePlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM workspace_files WHERE workspace_run_id = ? ORDER BY path').all(first.workspace.id) as Array<{ detail: string }>
    expect(filePlan.some((row) => row.detail.includes('idx_workspace_files_run_path'))).toBe(true)
    const jobPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM case_generation_jobs WHERE learner_id = ? AND status = ? ORDER BY updated_at DESC').all(learnerId, 'succeeded') as Array<{ detail: string }>
    expect(jobPlan.some((row) => row.detail.includes('idx_case_jobs_learner_status_updated'))).toBe(true)
    const environmentPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM learning_cases WHERE learner_id = ? AND environment_key = ? ORDER BY updated_at DESC').all(learnerId, 'python-pytest-v1') as Array<{ detail: string }>
    expect(environmentPlan.some((row) => row.detail.includes('idx_learning_cases_learner_environment_updated'))).toBe(true)
    const executionPlan = repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM workspace_executions WHERE workspace_run_id = ? ORDER BY sequence DESC LIMIT ?').all(first.workspace.id, 20) as Array<{ detail: string }>
    expect(executionPlan.some((row) => row.detail.includes('idx_workspace_executions_run_sequence'))).toBe(true)
  }))
})

describe('resumeWorkspaces', () => {
  async function readyWorkspace(service: CaseWorkspaceService, repository: ProductRepository, learnerId: string): Promise<string> {
    const nodeId = createWorkspaceNode(repository, learnerId)
    const created = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '练习测试修复并验证。' }, clientRequestId: `resume-${learnerId}` })
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, created.job.id).job.status).toBe('succeeded'))
    const item = service.getCaseGenerationJob(learnerId, created.job.id).case
    return (await service.startPractice(learnerId, item.id)).workspace.id
  }

  const workspaceState = (repository: ProductRepository, workspaceId: string): { status: string; ended_reason: string | null } =>
    repository.db.prepare('SELECT status, ended_reason FROM workspace_runs WHERE id = ?').get(workspaceId) as { status: string; ended_reason: string | null }

  const executionState = (repository: ProductRepository, workspaceId: string): Array<{ status: string; stderr: string }> =>
    repository.db.prepare('SELECT status, stderr FROM workspace_executions WHERE workspace_run_id = ?').all(workspaceId) as Array<{ status: string; stderr: string }>

  it('fails a provisioning workspace that lost its runner id after a service restart', async () => withScriptedService(async (service, repository) => {
    const learnerId = 'resume-missing-run'; const workspaceId = await readyWorkspace(service, repository, learnerId)
    repository.db.prepare("UPDATE workspace_runs SET runner_run_id = NULL, status = 'provisioning', updated_at = ? WHERE id = ?").run(new Date().toISOString(), workspaceId)
    await service.resumeWorkspaces()
    expect(workspaceState(repository, workspaceId)).toEqual({ status: 'failed', ended_reason: 'service_restarted' })
  }))

  it('fails an active workspace whose runner run has already ended', async () => withScriptedService(async (service, repository, fake) => {
    const learnerId = 'resume-ended-run'; const workspaceId = await readyWorkspace(service, repository, learnerId)
    const runnerRunId = repository.db.prepare('SELECT runner_run_id FROM workspace_runs WHERE id = ?').get(workspaceId) as { runner_run_id: string }
    await fake.end(runnerRunId.runner_run_id)
    await service.resumeWorkspaces()
    expect(workspaceState(repository, workspaceId)).toEqual({ status: 'failed', ended_reason: 'runner_unavailable' })
  }))

  it('fails the in-flight execution and restores an executing workspace after a service restart', async () => withScriptedService(async (service, repository) => {
    const learnerId = 'resume-executing'; const workspaceId = await readyWorkspace(service, repository, learnerId)
    const now = new Date().toISOString()
    repository.db.prepare("UPDATE workspace_runs SET status = 'executing', updated_at = ? WHERE id = ?").run(now, workspaceId)
    repository.db.prepare("INSERT INTO workspace_executions(id, workspace_run_id, sequence, client_request_id, command, status, created_at) VALUES (?, ?, 1, 'resume-exec-1', 'pytest -q', 'running', ?)").run('resume-execution-1', workspaceId, now)
    await service.resumeWorkspaces()
    expect(workspaceState(repository, workspaceId)).toEqual({ status: 'active', ended_reason: null })
    expect(executionState(repository, workspaceId)).toEqual([{ status: 'failed', stderr: '服务在执行完成前重启' }])
  }))

  it('fails an executing workspace and its running execution when the runner is unreachable', async () => withScriptedService(async (service, repository, fake) => {
    const learnerId = 'resume-unreachable'; const workspaceId = await readyWorkspace(service, repository, learnerId)
    const now = new Date().toISOString()
    repository.db.prepare("UPDATE workspace_runs SET status = 'executing', updated_at = ? WHERE id = ?").run(now, workspaceId)
    repository.db.prepare("INSERT INTO workspace_executions(id, workspace_run_id, sequence, client_request_id, command, status, created_at) VALUES (?, ?, 1, 'resume-exec-2', 'pytest -q', 'running', ?)").run('resume-execution-2', workspaceId, now)
    fake.failStatusWith = new WorkspaceRunnerError('runner_unavailable', 'runner down')
    await service.resumeWorkspaces()
    expect(workspaceState(repository, workspaceId)).toEqual({ status: 'failed', ended_reason: 'runner_unavailable' })
    expect(executionState(repository, workspaceId)).toEqual([{ status: 'failed', stderr: 'Runner 不可用' }])
  }))
})

describe('resumeCaseJobs', () => {
  async function readyCase(service: CaseWorkspaceService, repository: ProductRepository, learnerId: string): Promise<{ caseId: string; jobId: string }> {
    const nodeId = createWorkspaceNode(repository, learnerId)
    const created = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '练习测试修复并验证。' }, clientRequestId: `resume-job-${learnerId}` })
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, created.job.id).job.status).toBe('succeeded'))
    return { caseId: created.case.id, jobId: created.job.id }
  }

  it('requeues a running generation job interrupted by a service restart and finishes it on the next attempt', async () => withScriptedService(async (service, repository) => {
    const learnerId = 'resume-job-restart'; const { caseId, jobId } = await readyCase(service, repository, learnerId)
    const old = new Date(Date.now() - 120_000).toISOString()
    // Simulate the worker being killed mid-generation: job stuck in 'running'
    // before the 30s fence, case still 'generating' with no half-written spec.
    repository.db.prepare("UPDATE case_generation_jobs SET status = 'running', updated_at = ? WHERE id = ?").run(old, jobId)
    repository.db.prepare("UPDATE learning_cases SET status = 'generating', preflight_status = 'queued', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ?").run(old, caseId)
    await service.resumeCaseJobs()
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, jobId).job.status).toBe('succeeded'))
    expect(service.getCaseGenerationJob(learnerId, jobId).case.status).toBe('ready')
    expect(service.getCaseGenerationJob(learnerId, jobId).case.spec?.environment.templateKey).toBe('python-pytest-v1')
    const attempts = repository.db.prepare('SELECT attempt_number, phase, status FROM case_generation_attempts WHERE case_generation_job_id = ? ORDER BY attempt_number ASC').all(jobId) as Array<{ attempt_number: number; phase: string; status: string }>
    expect(attempts).toHaveLength(2)
    expect(attempts[1]).toMatchObject({ attempt_number: 2, phase: 'generate', status: 'succeeded' })
  }))
})

describe('case generation retry', () => {
  // A model provider without credentials fails every build deterministically,
  // which exercises the retry path without a real network call.
  const unconfiguredModel = new ModelCaseBuilder({ modelBaseUrl: '', modelApiKey: '', modelName: 'test-model', modelTimeoutMs: 1000 })

  it('retries only failed jobs, reusing the same job and immutable input context on a new attempt', async () => withBuilderService(unconfiguredModel, async (service, repository) => {
    const learnerId = 'retry-learner'; const nodeId = createWorkspaceNode(repository, learnerId)
    const created = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '练习测试修复。' }, clientRequestId: 'retry-1' })
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, created.job.id).job.status).toBe('failed'))
    const failed = service.getCaseGenerationJob(learnerId, created.job.id)
    expect(failed.job.failureCode).toBe('model_not_configured')
    expect(failed.case.status).toBe('failed')

    service.retryCaseGeneration(learnerId, created.job.id)
    await vi.waitFor(() => {
      const job = service.getCaseGenerationJob(learnerId, created.job.id).job
      expect(job.status).toBe('failed'); expect(job.attemptCount).toBe(2)
    })
    const retried = service.getCaseGenerationJob(learnerId, created.job.id)
    expect(retried.job.inputFingerprint).toBe(failed.job.inputFingerprint)
    expect(retried.case.id).toBe(failed.case.id)
    const attempts = repository.db.prepare('SELECT attempt_number, phase, status FROM case_generation_attempts WHERE case_generation_job_id = ? ORDER BY attempt_number ASC').all(created.job.id) as Array<{ attempt_number: number; phase: string; status: string }>
    expect(attempts).toEqual([
      { attempt_number: 1, phase: 'generate', status: 'failed' },
      { attempt_number: 2, phase: 'generate', status: 'failed' },
    ])
  }))

  it('refuses to retry a job that already succeeded', async () => withScriptedService(async (service, repository) => {
    const learnerId = 'retry-succeeded'; const nodeId = createWorkspaceNode(repository, learnerId)
    const created = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '练习测试修复。' }, clientRequestId: 'retry-ok' })
    await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, created.job.id).job.status).toBe('succeeded'))
    expect(() => service.retryCaseGeneration(learnerId, created.job.id)).toThrow(/不能重试/)
  }))
})
