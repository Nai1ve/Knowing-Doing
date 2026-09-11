import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import { FixtureCaseBuilder } from '../src/case-builder.js'
import { CaseWorkspaceService } from '../src/case-workspace-service.js'
import { GymBuildService } from '../src/gym-build-service.js'
import { MySqlDynamicCaseService } from '../src/mysql-dynamic-case-service.js'
import type { CaseDesignProvider } from '../src/case-design-agent.js'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { DockerWorkspaceRuntimeAdapter } from '../src/runtime-adapter.js'
import { FakeWorkspaceRunnerClient } from '../src/workspace-runner-client.js'

function setup(executeStatus: 'succeeded' | 'failed' = 'succeeded') {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-gym-build-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  const learnerId = 'gym-build-learner'
  const now = new Date().toISOString()
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO intakes(id, learner_id, goal, technology, status, created_at, updated_at) VALUES ('gym-intake', ?, '学习 MySQL 慢查询', 'MySQL 8', 'planned', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES ('gym-roadmap', ?, 'agent-roadmap-v2', '学习 MySQL 慢查询', 'active', 1, '{}', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES ('gym-node', 'gym-roadmap', NULL, 'mysql-slow-query', 'lab', 'MySQL 慢查询', '观察执行计划并验证索引假设。', '{}', '完成 EXPLAIN 对比', 90, 1, 1, 'lab', 'mysql.slow-query', NULL, ?)").run(now)
  repository.db.prepare("INSERT INTO learning_plans(id, learner_id, intake_id, title, goal, source_status, status, plan_state, template_key, revision, roadmap_id, created_at, updated_at) VALUES ('gym-plan', ?, 'gym-intake', 'MySQL 慢查询计划', '学习 MySQL 慢查询', 'agent', 'active', 'active', 'agent-roadmap-v2', 1, 'gym-roadmap', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO plan_units(id, plan_id, roadmap_node_id, position, title, objective, case_id, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json, learning_case_id) VALUES ('gym-unit', 'gym-plan', 'gym-node', 1, 'MySQL 慢查询', '完成 EXPLAIN 对比', NULL, 'current', 'available', 'lab', 90, '按当前路线执行。', NULL, '[]', NULL)").run()

  const scheduler = {
    registerDynamicCase: async () => undefined,
    createRun: async () => ({ kind: 'started' as const, run: { runId: 'preflight-run', caseId: 'dynamic', revision: 1, status: 'active' as const, fixtureVersion: 'fixture', expiresAt: now, idleExpiresAt: now, sessions: [] }, accessToken: 'token' }),
    getAccess: () => null,
    isRunActive: () => false,
    createSession: async () => ({ id: 'session-1', name: 'default' as const, status: 'open' as const }),
    execute: async () => executeStatus === 'succeeded'
      ? { status: 'succeeded' as const, result: { kind: 'result_set' as const, rows: [{ key: 'idx' }], columns: ['key'], truncated: false, rawOutput: 'key\nidx' } }
      : { status: 'failed' as const, result: null },
    release: async () => undefined,
  }
  const designAgent: CaseDesignProvider = {
    modelName: 'test-case-agent', fingerprint: (value) => JSON.stringify(value),
    async design(input, onAttempt) {
      const candidate = input.candidates[0]
      const materialization = input.materializationByCandidate[candidate.key]
      const rawDesign = JSON.stringify({ candidateKey: candidate.key })
      onAttempt?.({ phase: 'design', status: 'running' })
      onAttempt?.({ phase: 'design', status: 'succeeded', rawOutput: rawDesign, latencyMs: 1 })
      return { candidate, rawDesign, spec: {
        specVersion: 3, kind: 'mysql_data_diagnosis', capabilityKey: materialization.capabilityKey, exerciseProfileKey: candidate.exerciseProfileKey!, materialization,
        title: '动态 MySQL 案例', scenario: '受控案例场景', learningGoal: '观察执行计划',
        tasks: [{ key: 'observe', instruction: '观察执行计划', expectedObservation: '记录 key' }, { key: 'compare', instruction: '比较结果', expectedObservation: '说明差异' }],
        verification: { signals: ['可解释执行计划'] }, tutorContext: { concepts: ['EXPLAIN'], likelyMisconceptions: [], evidenceToNotice: ['key'] },
      } }
    },
  }
  const mysql = new MySqlDynamicCaseService(repository, scheduler as never, undefined, designAgent)
  const workspace = new CaseWorkspaceService(repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient()))
  const service = new GymBuildService(repository, workspace, mysql)
  return { directory, repository, learnerId, service, mysql, now }
}

function close(state: ReturnType<typeof setup>) {
  state.repository.close()
  rmSync(state.directory, { recursive: true, force: true })
}

describe('GymBuildService', () => {
  it('does not enqueue a build when the linked case is already ready and preflighted', async () => {
    const state = setup()
    try {
      const created = await state.mysql.createCase(state.learnerId, {
        roadmapNodeId: 'gym-node',
        request: { capabilityKey: 'mysql.slow-query', environmentKey: 'mysql-performance-v1', environmentVersion: '1', schemaTemplateKey: 'orders-v1', seedProfileKey: 'orders-100k-v1', faultKey: 'wrong_index', queryTemplateKey: 'orders-by-user-created-v1', parameters: { rowCount: 100_000, distribution: 'uniform' } },
        clientRequestId: 'existing-case',
      })
      state.repository.db.prepare('UPDATE plan_units SET learning_case_id = ? WHERE id = ?').run(created.case.id, 'gym-unit')
      const view = state.service.create(state.learnerId, 'gym-plan', 'gym-unit', 'build-ready')
      expect(view.job.status).toBe('ready')
      expect(view.job.attemptCount).toBe(0)
      expect(state.repository.db.prepare('SELECT COUNT(*) AS count FROM gym_build_job_attempts').get()).toMatchObject({ count: 0 })
    } finally { close(state) }
  })

  it('records one failed attempt for concurrent retry requests', async () => {
    const state = setup('failed')
    try {
      const created = state.service.create(state.learnerId, 'gym-plan', 'gym-unit', 'build-failed')
      await vi.waitFor(() => expect(state.service.get(state.learnerId, created.job.id).job.status).toBe('failed'))
      const first = state.service.retry(state.learnerId, created.job.id)
      const second = state.service.retry(state.learnerId, created.job.id)
      expect(first.job.id).toBe(second.job.id)
      await vi.waitFor(() => expect(state.service.get(state.learnerId, created.job.id).job.attemptCount).toBe(2))
      expect(state.repository.db.prepare('SELECT attempt_no, status, trigger FROM gym_build_job_attempts WHERE gym_build_job_id = ? ORDER BY attempt_no').all(created.job.id)).toEqual([
        { attempt_no: 1, status: 'failed', trigger: 'create' },
        { attempt_no: 2, status: 'failed', trigger: 'retry' },
      ])
    } finally { close(state) }
  })

  it('keeps Case Agent output diagnostics on the server-side generation job', async () => {
    const state = setup()
    try {
      const created = state.service.create(state.learnerId, 'gym-plan', 'gym-unit', 'design-diagnostics')
      await vi.waitFor(() => expect(state.service.get(state.learnerId, created.job.id).job.status).toBe('ready'))
      const row = state.repository.db.prepare("SELECT status, raw_output_json, validation_issues_json FROM case_generation_attempts WHERE phase = 'design'").get()
      expect(row).toMatchObject({ status: 'succeeded', raw_output_json: expect.stringContaining('candidateKey'), validation_issues_json: '[]' })
    } finally { close(state) }
  })

  it('keeps a fresh build running and interrupts only stale work on recovery', async () => {
    const state = setup()
    try {
      const freshJobId = 'fresh-build'
      state.repository.db.prepare("INSERT INTO gym_build_jobs(id, learner_id, plan_id, plan_unit_id, roadmap_node_id, client_request_id, input_fingerprint, capability_key, card_snapshot_json, environment_key, environment_version, runtime_kind, status, attempt_count, worker_token, started_at, created_at, updated_at) VALUES (?, ?, 'gym-plan', 'gym-unit', 'gym-node', 'fresh-request', 'fresh-fingerprint', 'mysql.slow-query', '{\"nodeId\":\"gym-node\",\"title\":\"MySQL 慢查询\",\"summary\":\"观察执行计划\",\"completionStandard\":\"完成对比\",\"knowledgeCard\":{},\"evidence\":[],\"learnerProfile\":[]}', 'mysql-performance-v1', '1', 'mysql_lab', 'building', 1, 'fresh-worker', ?, ?, ?)").run(freshJobId, state.learnerId, state.now, state.now, state.now)
      state.repository.db.prepare("INSERT INTO gym_build_job_attempts(id, gym_build_job_id, attempt_no, status, worker_token, trigger, started_at, created_at) VALUES ('fresh-attempt', ?, 1, 'running', 'fresh-worker', 'create', ?, ?)").run(freshJobId, state.now, state.now)
      await state.service.resume()
      expect(state.service.get(state.learnerId, freshJobId).job.status).toBe('building')
      expect(state.repository.db.prepare('SELECT status FROM gym_build_job_attempts WHERE id = ?').get('fresh-attempt')).toMatchObject({ status: 'running' })

      const stale = new Date(Date.now() - 11 * 60 * 1000).toISOString()
      state.repository.db.prepare('UPDATE gym_build_jobs SET started_at = ?, updated_at = ? WHERE id = ?').run(stale, stale, freshJobId)
      await state.service.resume()
      await vi.waitFor(() => expect(state.service.get(state.learnerId, freshJobId).job.status).toBe('ready'))
      expect(state.repository.db.prepare('SELECT attempt_no, status, trigger FROM gym_build_job_attempts WHERE gym_build_job_id = ? ORDER BY attempt_no').all(freshJobId)).toEqual([
        { attempt_no: 1, status: 'interrupted', trigger: 'create' },
        { attempt_no: 2, status: 'succeeded', trigger: 'recovery' },
      ])
    } finally { close(state) }
  })
})
