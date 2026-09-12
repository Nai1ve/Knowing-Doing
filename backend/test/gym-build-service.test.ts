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
import { OpenHandsBuildAdapterError, type OpenHandsBuildAdapter, type OpenHandsBuildTaskInput } from '../src/environment-build.js'
import { EnvironmentRuntimeReferenceService, verifyEnvironmentRuntimeReference } from '../src/environment-runtime-reference.js'

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

  it('surfaces the dynamic MySQL preflight diagnostic and blocks Lab entry', async () => {
    const state = setup('failed')
    try {
      const created = state.service.create(state.learnerId, 'gym-plan', 'gym-unit', 'mysql-preflight-failure-visible')
      await vi.waitFor(() => expect(state.service.get(state.learnerId, created.job.id).job.status).toBe('failed'))
      const view = state.service.get(state.learnerId, created.job.id)
      expect(view.failure).toMatchObject({ source: 'case_preflight', code: 'mysql_preflight_failed', message: 'mysql_preflight_initial_explain_failed', canEnterLab: false })
      expect(view.case).toMatchObject({ status: 'failed', preflightStatus: 'failed', failureCode: 'mysql_preflight_failed', failureMessage: 'mysql_preflight_initial_explain_failed' })
      await expect(state.service.start(state.learnerId, created.job.id)).rejects.toMatchObject({ code: 'mysql_preflight_failed', message: 'mysql_preflight_initial_explain_failed' })
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
      state.repository.db.prepare("INSERT INTO gym_build_jobs(id, learner_id, plan_id, plan_unit_id, roadmap_node_id, client_request_id, input_fingerprint, capability_key, card_snapshot_json, environment_key, environment_version, runtime_kind, status, current_phase, attempt_count, worker_token, started_at, created_at, updated_at) VALUES (?, ?, 'gym-plan', 'gym-unit', 'gym-node', 'fresh-request', 'fresh-fingerprint', 'mysql.slow-query', '{\"nodeId\":\"gym-node\",\"title\":\"MySQL 慢查询\",\"summary\":\"观察执行计划\",\"completionStandard\":\"完成对比\",\"knowledgeCard\":{},\"evidence\":[],\"learnerProfile\":[]}', 'mysql-performance-v1', '1', 'mysql_lab', 'running', 'designing', 1, 'fresh-worker', ?, ?, ?)").run(freshJobId, state.learnerId, state.now, state.now, state.now)
      state.repository.db.prepare("INSERT INTO gym_build_job_attempts(id, gym_build_job_id, attempt_no, status, worker_token, trigger, started_at, created_at) VALUES ('fresh-attempt', ?, 1, 'running', 'fresh-worker', 'create', ?, ?)").run(freshJobId, state.now, state.now)
      await state.service.resume()
      expect(state.service.get(state.learnerId, freshJobId).job.status).toBe('running')
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

  it('records safe adapter events and requires a labeled runtime artifact before ready', async () => {
    const state = setup()
    try {
      const digest = `sha256:${'a'.repeat(64)}`
      let task: OpenHandsBuildTaskInput | null = null
      let createCalls = 0
      const adapter: OpenHandsBuildAdapter = {
        async createTask(input) { task = input; createCalls += 1; return { taskId: `task-${createCalls}` } },
        async events(_taskId, afterSequence) {
          if (afterSequence > 0) return { events: [], nextSequence: afterSequence }
          return { events: [{ id: 'agent-event-1', sequence: 1, phase: 'designing', type: 'tool', summary: 'Agent 已冻结输入', command: 'Authorization: Bearer sk-this-token-must-not-reach-the-client', createdAt: new Date().toISOString() }], nextSequence: 1 }
        },
        async status(taskId) {
          if (!task) throw new Error('missing task')
          return {
            taskId, status: 'succeeded' as const, updatedAt: new Date().toISOString(), failure: null,
            manifest: {
              protocolVersion: 1 as const, runtimeKind: 'mysql_lab' as const,
              environment: { key: 'mysql-performance-v1', version: '1', runtimeImageDigest: digest, runtimeImageRef: `registry.example/mysql@${digest}` },
              starterFiles: [], referenceFiles: [], mysql: { contractFingerprint: task.mysqlContract!.materializationFingerprint, initializationSql: [task.mysqlContract!.schemaSql, task.mysqlContract!.faultSql], starterExplain: task.mysqlContract!.starterExplain, referenceSql: [task.mysqlContract!.referenceSql] },
              verification: { commandKeys: ['explain'], successSignals: ['key'] },
              resources: [{ kind: 'image' as const, id: digest, role: 'runtime_artifact' as const, labels: {
                'zhixing.case-build': task.buildId, 'zhixing.case-attempt': task.attemptId, 'zhixing.protocol-version': '1', 'zhixing.resource-role': 'runtime_artifact',
                'zhixing.runtime-kind': 'mysql_lab', 'zhixing.runtime-image-digest': digest, 'zhixing.environment-key': 'mysql-performance-v1', 'zhixing.environment-version': '1',
                'zhixing.mysql-contract-fingerprint': task.mysqlContract!.materializationFingerprint,
              } }],
            },
          }
        },
        async cancel() {}, async cleanup() {},
        async startMySqlRuntime() { throw new Error('not used by fixture scheduler') }, async resetMySqlRuntime() {}, async createMySqlSession() { throw new Error('not used by fixture scheduler') }, async executeMySql() { throw new Error('not used by fixture scheduler') }, async closeMySqlSession() {}, async endMySqlRuntime() {},
      }
      const service = new GymBuildService(state.repository, new CaseWorkspaceService(state.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient())), state.mysql, { adapter, enabled: true, taskTimeoutMs: 1_000 })
      const created = service.create(state.learnerId, 'gym-plan', 'gym-unit', 'adapter-build')
      await vi.waitFor(() => expect(service.get(state.learnerId, created.job.id).job.status).toBe('ready'))
      expect(createCalls).toBe(1)
      expect(task).not.toBeNull()
      const recordedTask = task as unknown as OpenHandsBuildTaskInput
      expect(recordedTask.mysqlContract).toMatchObject({ learningCaseId: service.get(state.learnerId, created.job.id).job.learningCaseId, database: expect.stringMatching(/^zhixing_dynamic_/), seed: { rowCount: 100_000, distribution: 'uniform' } })
      expect(service.events(state.learnerId, created.job.id).events.map((event) => event.sequence)).toEqual(expect.arrayContaining([1, 2]))
      expect(service.events(state.learnerId, created.job.id).events.map((event) => event.command).join('\n')).not.toContain('sk-this-token')
      const binding = state.repository.db.prepare('SELECT runtime_image_digest, runtime_image_ref, resource_lease_json, status FROM environment_runtime_bindings WHERE gym_build_job_id = ?').get(created.job.id) as { runtime_image_digest: string; runtime_image_ref: string; resource_lease_json: string; status: string }
      expect(binding).toMatchObject({ runtime_image_digest: digest, runtime_image_ref: `registry.example/mysql@${digest}`, status: 'ready' })
      expect(JSON.parse(binding.resource_lease_json)).toMatchObject({ attemptId: recordedTask.attemptId, database: recordedTask.mysqlContract?.database, mysqlContractFingerprint: recordedTask.mysqlContract?.materializationFingerprint })
      const runtimeReference = new EnvironmentRuntimeReferenceService(state.repository.db, 'test-runtime-reference').referenceForCase({
        learnerId: state.learnerId, learningCaseId: service.get(state.learnerId, created.job.id).job.learningCaseId!, runtimeKind: 'mysql_lab', environmentKey: 'mysql-performance-v1', environmentVersion: '1',
      })
      expect(runtimeReference).not.toBeNull()
      expect(verifyEnvironmentRuntimeReference(runtimeReference as string, 'test-runtime-reference').requiredLabels).toMatchObject({ 'zhixing.case-attempt': recordedTask.attemptId })
    } finally { close(state) }
  })

  it('uses all three repair rounds for an agent manifest defect but never retries a platform fault', async () => {
    const state = setup()
    try {
      let calls = 0
      let brokenTask: OpenHandsBuildTaskInput | null = null
      const brokenAdapter: OpenHandsBuildAdapter = {
        async createTask(input) { calls += 1; brokenTask = input; return { taskId: `broken-${calls}` } }, async events(_task, after) { return { events: [], nextSequence: after } },
        async status(taskId) {
          if (!brokenTask) throw new Error('missing task')
          return { taskId, status: 'succeeded' as const, updatedAt: new Date().toISOString(), failure: null, manifest: { protocolVersion: 1 as const, runtimeKind: 'mysql_lab' as const, environment: { key: 'mysql-performance-v1', version: '1', runtimeImageDigest: `sha256:${'b'.repeat(64)}` }, starterFiles: [], referenceFiles: [], mysql: { contractFingerprint: brokenTask.mysqlContract!.materializationFingerprint, initializationSql: [brokenTask.mysqlContract!.schemaSql, brokenTask.mysqlContract!.faultSql], starterExplain: brokenTask.mysqlContract!.starterExplain, referenceSql: [brokenTask.mysqlContract!.referenceSql] }, verification: { commandKeys: ['explain'], successSignals: [] }, resources: [] } }
        },
        async cancel() {}, async cleanup() {}, async startMySqlRuntime() { throw new Error('unused') }, async resetMySqlRuntime() {}, async createMySqlSession() { throw new Error('unused') }, async executeMySql() { throw new Error('unused') }, async closeMySqlSession() {}, async endMySqlRuntime() {},
      }
      const service = new GymBuildService(state.repository, new CaseWorkspaceService(state.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient())), state.mysql, { adapter: brokenAdapter, enabled: true, taskTimeoutMs: 1_000 })
      const created = service.create(state.learnerId, 'gym-plan', 'gym-unit', 'broken-manifest')
      await vi.waitFor(() => expect(service.get(state.learnerId, created.job.id).job.status).toBe('failed'))
      expect(calls).toBe(4)
      expect(service.get(state.learnerId, created.job.id).job).toMatchObject({ repairRound: 3, failureCategory: 'agent_failure' })

      const faultState = setup()
      try {
        const faultAdapter: OpenHandsBuildAdapter = { ...brokenAdapter, async createTask() { calls += 1; throw new OpenHandsBuildAdapterError('case_builder_unavailable', 'socket unavailable', 'platform_fault') } }
        const faultService = new GymBuildService(faultState.repository, new CaseWorkspaceService(faultState.repository, new FixtureCaseBuilder(), new DockerWorkspaceRuntimeAdapter(new FakeWorkspaceRunnerClient())), faultState.mysql, { adapter: faultAdapter, enabled: true, taskTimeoutMs: 1_000 })
        const fault = faultService.create(faultState.learnerId, 'gym-plan', 'gym-unit', 'platform-fault')
        await vi.waitFor(() => expect(faultService.get(faultState.learnerId, fault.job.id).job.status).toBe('failed'))
        expect(faultService.get(faultState.learnerId, fault.job.id).job).toMatchObject({ repairRound: 0, failureCategory: 'platform_fault' })
      } finally { close(faultState) }
    } finally { close(state) }
  })
})
