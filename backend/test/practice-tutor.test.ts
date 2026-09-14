import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import { CasePreflightService } from '../src/case-preflight-service.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { loadConfig } from '../src/config.js'
import type { TutorContext, WorkspaceTutorContext } from '../src/context.js'
import type { LabStore } from '../src/mysql-store.js'
import { LabScheduler } from '../src/scheduler.js'
import { PlanningService } from '../src/planning.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import type { PracticeRun, SourceItem } from '../src/product-types.js'
import { PracticeService } from '../src/practice-service.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'
import { TutorEngine, type TutorGenerated } from '../src/tutor.js'
import { FakeWorkspaceRunnerClient } from '../src/workspace-runner-client.js'
import { WorkspaceCompletionService } from '../src/workspace-completion-service.js'

const noopStore: LabStore = {
  async reset() {},
  async createSession() { throw new Error('unused') },
  async execute() { throw new Error('unused') },
  async closeConnection() {},
}

// Records the context passed to the model so the dispatch under test can be
// inspected without a real network call.
class RecordingTutor extends TutorEngine {
  capturedContext: TutorContext | null = null
  constructor() { super({ modelBaseUrl: '', modelApiKey: '', modelName: 'test-model', modelTimeoutMs: 1000 }) }
  override async generate(_run: PracticeRun, context: TutorContext, _message: string, _sources: SourceItem[]): Promise<TutorGenerated> {
    this.capturedContext = context
    return { response: '先看失败断言，再对照实现找边界。', sourceRefs: [] }
  }
}

function setup() {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-practice-tutor-')); const dbPath = path.join(directory, 'product.db'); applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath); const learnerId = 'practice-tutor-learner'; const now = new Date().toISOString(); const roadmapId = 'practice-tutor-roadmap'; const nodeId = 'practice-tutor-node'
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES (?, ?, 'agent-roadmap-v2', '学习 Python 测试', 'active', 1, '{}', ?, ?)").run(roadmapId, learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES (?, ?, NULL, 'python-testing', 'lab', 'Python 测试实践', '完成一个 Python 测试修复案例。', '{}', '通过验证命令完成案例。', 90, 1, 1, 'workspace', 'python.testing', NULL, ?)").run(nodeId, roadmapId, now)
  repository.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, revision, updated_at) VALUES (?, ?, 'available', 'agent', 1, ?)").run(roadmapId, nodeId, now)
  repository.db.prepare("INSERT INTO learner_profile_snapshots(id, learner_id, planning_session_id, version, status, input_fingerprint, summary_json, created_at) VALUES ('practice-tutor-profile', ?, NULL, 1, 'current', 'practice-tutor-profile', '{}', ?)").run(learnerId, now)
  return { directory, repository, learnerId, nodeId }
}

async function startWorkspace(repository: ProductRepository, learnerId: string, nodeId: string): Promise<{ workspaceRunId: string; practiceRunId: string }> {
  const completion = new WorkspaceCompletionService(repository, new PlanningService(repository))
  const preflightRuntime = new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient())
  const service = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), new FakeWorkspaceRunnerClient(), completion, new CasePreflightService(repository, preflightRuntime))
  const request = service.createCaseRequest(learnerId, { roadmapNodeId: nodeId, input: { kind: 'brief', brief: '练习测试修复与验证。' }, clientRequestId: 'practice-tutor-case' })
  await vi.waitFor(() => expect(service.getCaseGenerationJob(learnerId, request.job.id).job.status).toBe('succeeded'))
  const started = await service.startPractice(learnerId, request.case.id)
  // Keep the run active: save a file that still carries the fixture marker so
  // the fake runner keeps pytest failing and completion never verifies.
  const file = started.files.find((item) => item.path === 'src/order_summary.py')!
  await service.saveFile(learnerId, started.workspace.id, file.path, '# zhixing-fixture: order-starter\n', file.revision)
  await service.execute(learnerId, started.workspace.id, 'pytest -q', 'practice-tutor-exec')
  return { workspaceRunId: started.workspace.id, practiceRunId: started.practice.id }
}

describe('PracticeService.runTutor dispatch', () => {
  it('builds a bounded workspace context for a code_workspace practice and records the tutor evidence chain', async () => {
    const state = setup()
    try {
      const { practiceRunId } = await startWorkspace(state.repository, state.learnerId, state.nodeId)
      const tutor = new RecordingTutor()
      const practice = new PracticeService(state.repository, new LabScheduler(noopStore, loadConfig()), tutor)
      await practice.streamTutor({ runId: practiceRunId, message: '我看到测试失败了，下一步看哪里？', clientRequestId: 'practice-tutor-msg' }, async () => undefined)

      const context = tutor.capturedContext
      expect(context).not.toBeNull()
      const workspaceContext = context as WorkspaceTutorContext
      expect(workspaceContext.workspace).toBeDefined()
      expect(workspaceContext.workspace.status).toBe('active')
      expect(workspaceContext.workspace.node.title).toBe('Python 测试实践')
      // All three fixture tasks share the same recommended command, so once
      // pytest -q has run the resolver falls back to the last task deterministically.
      expect(workspaceContext.workspace.currentTask?.key).toBe('fix')
      expect(workspaceContext.workspace.recentExecutions).toEqual([expect.objectContaining({ command: 'pytest -q', status: 'failed' })])
      expect(workspaceContext.workspace.recentFiles.length).toBeGreaterThan(0)
      // The context is bounded to the current workspace evidence: only source
      // excerpts and workspace artifacts, no foreign or unrelated history.
      expect(workspaceContext.rawEvidence.every((item) => item.kind === 'external_text' || item.kind.startsWith('workspace_'))).toBe(true)

      const events = state.repository.db.prepare("SELECT actor, type FROM practice_events WHERE practice_run_id = ? ORDER BY sequence ASC").all(practiceRunId) as Array<{ actor: string; type: string }>
      expect(events.some((event) => event.actor === 'user' && event.type === 'user_message')).toBe(true)
      expect(events.some((event) => event.actor === 'tutor' && event.type === 'tutor_reply')).toBe(true)
    } finally { state.repository.close(); rmSync(state.directory, { recursive: true, force: true }) }
  })
})
