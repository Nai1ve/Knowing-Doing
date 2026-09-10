import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { CasePreflightService } from '../src/case-preflight-service.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { PlanningService } from '../src/planning.js'
import { FakeWorkspaceRunnerClient, type RunnerExecutionResult } from '../src/workspace-runner-client.js'
import { WorkspaceCompletionService } from '../src/workspace-completion-service.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-workspace-completion-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath); const repository = new ProductRepository(dbPath); const learnerId = 'completion-learner'; const now = new Date().toISOString(); const roadmapId = 'completion-roadmap'; const nodeId = 'completion-node'
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES (?, ?, 'agent-roadmap-v2', '学习 Python 测试', 'active', 1, '{}', ?, ?)").run(roadmapId, learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES (?, ?, NULL, 'python-testing', 'lab', 'Python 测试实践', '完成一个 Python 测试修复案例。', '{}', '通过验证命令完成案例。', 90, 1, 1, 'workspace', 'python.testing', NULL, ?)").run(nodeId, roadmapId, now)
  repository.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, revision, updated_at) VALUES (?, ?, 'available', 'agent', 1, ?)").run(roadmapId, nodeId, now)
  repository.db.prepare("INSERT INTO learner_profile_snapshots(id, learner_id, planning_session_id, version, status, input_fingerprint, summary_json, created_at) VALUES ('completion-profile', ?, NULL, 1, 'current', 'completion-profile', '{}', ?)").run(learnerId, now)
  return { directory, repository, learnerId, nodeId }
}

async function createWorkspace(repository: ProductRepository, learnerId: string, nodeId: string, runner = new FakeWorkspaceRunnerClient(), onResolved?: (practiceRunId: string) => void) {
  const completion = new WorkspaceCompletionService(repository, new PlanningService(repository), onResolved)
  const preflightRuntime = new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient())
  const service = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), runner, completion, new CasePreflightService(repository, preflightRuntime))
  const request = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '练习测试修复与验证。' }, clientRequestId: 'completion-case' })
  await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, request.job.id).job.status).toBe('succeeded'))
  return { service, workspace: await service.startPractice(learnerId, request.case.id) }
}

describe('WorkspaceCompletionService', () => {
  it('resolves a workspace once when every success signal matches', async () => {
    const state = setup()
    try {
      const resolvedRuns: string[] = []
      const { service, workspace } = await createWorkspace(state.repository, state.learnerId, state.nodeId, new FakeWorkspaceRunnerClient(), (runId) => resolvedRuns.push(runId))
      const first = await service.execute(state.learnerId, workspace.workspace.id, 'pytest -q', 'failed')
      const file = first.workspace.files.find((item) => item.path === 'src/order_summary.py')!
      await service.saveFile(state.learnerId, workspace.workspace.id, file.path, '# fixed\n', file.revision)
      const result = await service.execute(state.learnerId, workspace.workspace.id, 'pytest -q', 'passed')
      expect(result.workspace.completion?.status).toBe('verified')
      expect(result.workspace.practice.status).toBe('resolved')
      expect(resolvedRuns).toEqual([result.workspace.practice.id])
      expect(state.repository.db.prepare("SELECT status FROM roadmap_node_progress WHERE roadmap_id = 'completion-roadmap' AND node_id = 'completion-node'").get()).toMatchObject({ status: 'verified' })
      expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM practice_events WHERE practice_run_id = ? AND type = 'workspace_verified'").get(result.workspace.practice.id)).toMatchObject({ count: 1 })
      expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM workspace_completion_evaluations WHERE practice_run_id = ? AND status = 'verified'").get(result.workspace.practice.id)).toMatchObject({ count: 1 })
      expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM learner_profile_evidence WHERE source_type = 'workspace_verification'").get()).toMatchObject({ count: 1 })
      const plan = state.repository.db.prepare('EXPLAIN QUERY PLAN SELECT * FROM workspace_completion_evaluations WHERE workspace_run_id = ? AND status = ? ORDER BY updated_at DESC').all(workspace.workspace.id, 'verified') as Array<{ detail: string }>
      expect(plan.some((row) => row.detail.includes('idx_workspace_completion_run_status_updated'))).toBe(true)
      const recoveryPlan = state.repository.db.prepare("EXPLAIN QUERY PLAN SELECT e.workspace_run_id, w.learner_id FROM workspace_completion_evaluations e INDEXED BY idx_workspace_completion_status_updated INNER JOIN workspace_runs w ON w.id = e.workspace_run_id WHERE e.status = 'pending' GROUP BY e.workspace_run_id, w.learner_id ORDER BY MIN(e.updated_at) ASC LIMIT 50").all() as Array<{ detail: string }>
      expect(recoveryPlan.some((row) => row.detail.includes('idx_workspace_completion_status_updated'))).toBe(true)
      const output = state.repository.db.prepare("SELECT verification_status FROM artifacts WHERE practice_run_id = ? AND kind = 'workspace_output' ORDER BY created_at DESC LIMIT 1").get(result.workspace.practice.id)
      expect(output).toMatchObject({ verification_status: 'not_applicable' })
      await service.execute(state.learnerId, workspace.workspace.id, 'pytest -q', 'passed-again')
      expect(resolvedRuns).toEqual([result.workspace.practice.id])
      expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM practice_events WHERE practice_run_id = ? AND type = 'workspace_verified'").get(result.workspace.practice.id)).toMatchObject({ count: 1 })
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('keeps the practice active when a success signal is missing', async () => {
    class MissingSignalRunner extends FakeWorkspaceRunnerClient {
      override async execute(runId: string, command: string, requestId: string): Promise<RunnerExecutionResult> {
        const result = await super.execute(runId, command, requestId)
        return { ...result, status: 'succeeded', exitCode: 0, stdout: 'passed', stderr: '' }
      }
    }
    const state = setup()
    try {
      const { service, workspace } = await createWorkspace(state.repository, state.learnerId, state.nodeId, new MissingSignalRunner())
      const result = await service.execute(state.learnerId, workspace.workspace.id, 'pytest -q', 'missing-signal')
      expect(result.workspace.completion?.status).toBe('not_matched')
      expect(result.workspace.practice.status).toBe('active')
      expect(result.workspace.completion?.missingSignals).toEqual(['2 passed'])
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('does not verify a successful status with a non-zero exit code', async () => {
    class NonZeroRunner extends FakeWorkspaceRunnerClient {
      override async execute(runId: string, command: string, requestId: string): Promise<RunnerExecutionResult> {
        const result = await super.execute(runId, command, requestId)
        return { ...result, status: 'succeeded', exitCode: 1, stdout: '2 passed\npassed', stderr: '' }
      }
    }
    const state = setup()
    try {
      const { service, workspace } = await createWorkspace(state.repository, state.learnerId, state.nodeId, new NonZeroRunner())
      const result = await service.execute(state.learnerId, workspace.workspace.id, 'pytest -q', 'non-zero')
      expect(result.workspace.completion).toBeNull()
      expect(result.workspace.practice.status).toBe('active')
      expect(state.repository.db.prepare("SELECT COUNT(*) AS count FROM workspace_completion_evaluations WHERE practice_run_id = ?").get(result.workspace.practice.id)).toMatchObject({ count: 0 })
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })
})
