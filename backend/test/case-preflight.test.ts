import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import type { CaseBuilderInput, CaseBuilderProvider } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'
import { FakeWorkspaceRunnerClient, type RunnerExecutionResult } from '../src/workspace-runner-client.js'

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-case-preflight-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  const learnerId = 'preflight-learner'
  const now = new Date().toISOString()
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES ('preflight-roadmap', ?, 'agent-roadmap-v2', '学习 Python list', 'active', 1, '{}', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES ('preflight-node', 'preflight-roadmap', NULL, 'python-list', 'concept', 'Python list', 'list 案例', '{}', '测试通过', 90, 1, 1, 'workspace', 'python.collections.list', NULL, ?)").run(now)
  repository.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, revision, updated_at) VALUES ('preflight-roadmap', 'preflight-node', 'available', 'agent', 1, ?)").run(now)
  return { directory, repository, learnerId }
}

describe('CasePreflightService', () => {
  it('requires a real starter failure and a passing private reference solution', async () => {
    const state = setup()
    try {
      const service = new CaseWorkspaceService(state.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()))
      const request = service.createCaseRequest(state.learnerId, { roadmapNodeId: 'preflight-node', input: { kind: 'brief', brief: '我想学习 Python list 的创建、索引、切片和可变性。' }, clientRequestId: 'list-preflight-1' })
      await vi.waitFor(() => expect(service.getCaseGenerationJob(state.learnerId, request.job.id).job.status).toBe('succeeded'))
      const result = service.getCaseGenerationJob(state.learnerId, request.job.id)
      expect(result.case.status).toBe('ready')
      expect(result.case.capabilityKey).toBe('python.collections.list')
      expect(result.preflight).toMatchObject({ status: 'passed' })
      const row = state.repository.db.prepare('SELECT status, json_extract(starter_execution_json, \'$[0].exitCode\') AS starter_exit, json_extract(reference_execution_json, \'$[0].exitCode\') AS reference_exit FROM case_preflight_runs WHERE case_generation_job_id = ?').get(request.job.id) as { status: string; starter_exit: number; reference_exit: number }
      expect(row).toMatchObject({ status: 'passed', starter_exit: 1, reference_exit: 0 })
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('fails the case when the starter already passes', async () => {
    class PassingRunner extends FakeWorkspaceRunnerClient {
      override async execute(runId: string, command: string, requestId: string): Promise<RunnerExecutionResult> {
        const result = await super.execute(runId, command, requestId)
        return { ...result, status: 'succeeded', exitCode: 0, stdout: '3 passed', stderr: '' }
      }
    }
    const state = setup()
    try {
      const service = new CaseWorkspaceService(state.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new PassingRunner()))
      const request = service.createCaseRequest(state.learnerId, { roadmapNodeId: 'preflight-node', input: { kind: 'brief', brief: '我想学习 Python list。' }, clientRequestId: 'list-preflight-fail' })
      await vi.waitFor(() => expect(service.getCaseGenerationJob(state.learnerId, request.job.id).job.status).toBe('failed'))
      const result = service.getCaseGenerationJob(state.learnerId, request.job.id)
      expect(result.case.status).toBe('failed')
      expect(result.preflight).toMatchObject({ status: 'failed', userMessage: '案例初始状态未产生预期失败' })
      expect(state.repository.db.prepare('SELECT failure_code FROM case_preflight_runs WHERE case_generation_job_id = ?').get(request.job.id)).toMatchObject({ failure_code: 'starter_did_not_fail' })
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })

  it('rebuilds once with preflight diagnostics before failing permanently', async () => {
    class RepairingBuilder implements CaseBuilderProvider {
      readonly providerName = 'fixture' as const
      calls = 0
      private readonly delegate = new FixtureCaseBuilder()
      async build(input: CaseBuilderInput) {
        this.calls += 1
        return this.delegate.build({ ...input, onReferenceSolution: (solution) => input.onReferenceSolution?.(this.calls === 1
          ? { files: [{ path: 'src/list_practice.py', content: '# zhixing-fixture: python-list-starter\n' }], verificationCommands: solution.verificationCommands }
          : solution) })
      }
    }
    const state = setup()
    try {
      const builder = new RepairingBuilder()
      const service = new CaseWorkspaceService(state.repository, builder, new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()))
      const request = service.createCaseRequest(state.learnerId, { roadmapNodeId: 'preflight-node', input: { kind: 'brief', brief: '我想学习 Python list。' }, clientRequestId: 'list-preflight-repair' })
      await vi.waitFor(() => expect(service.getCaseGenerationJob(state.learnerId, request.job.id).job.status).toBe('succeeded'))
      expect(builder.calls).toBe(2)
      expect(state.repository.db.prepare('SELECT COUNT(*) AS count FROM case_preflight_runs WHERE case_generation_job_id = ?').get(request.job.id)).toMatchObject({ count: 2 })
      expect(service.getCaseGenerationJob(state.learnerId, request.job.id).preflight.status).toBe('passed')
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })
})
