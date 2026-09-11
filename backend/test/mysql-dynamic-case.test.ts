import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { MySqlDynamicCaseService } from '../src/mysql-dynamic-case-service.js'
import { LabError } from '../src/errors.js'

const request = { capabilityKey: 'mysql.slow-query', environmentKey: 'mysql-performance-v1', environmentVersion: '1', schemaTemplateKey: 'orders-v1', seedProfileKey: 'orders-100k-v1', faultKey: 'wrong_index', queryTemplateKey: 'orders-by-user-created-v1', parameters: { rowCount: 100_000, distribution: 'skewed' } }

function setup(scheduler: unknown) {
  const directory = mkdtempSync(path.join(tmpdir(), 'zhixing-mysql-dynamic-'))
  const dbPath = path.join(directory, 'product.db')
  applyProductMigrations(dbPath)
  const repository = new ProductRepository(dbPath)
  const learnerId = 'mysql-dynamic-learner'
  const now = new Date().toISOString()
  repository.ensureLearner(learnerId)
  repository.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, created_at, updated_at) VALUES ('mysql-roadmap', ?, 'agent-roadmap-v2', '学习 MySQL 慢查询', 'active', 1, '{}', ?, ?)").run(learnerId, now, now)
  repository.db.prepare("INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, case_id, created_at) VALUES ('mysql-node', 'mysql-roadmap', NULL, 'mysql-slow-query', 'lab', 'MySQL 慢查询', '观察执行计划', '{}', '完成 EXPLAIN 对比', 90, 1, 1, 'lab', 'mysql.slow-query', NULL, ?)").run(now)
  return { directory, repository, learnerId, service: new MySqlDynamicCaseService(repository, scheduler as never) }
}

function successfulScheduler(calls: string[] = []) {
  return {
    registerDynamicCase: async () => undefined,
    createRun: async () => ({ kind: 'started', run: { runId: 'dynamic-run', revision: 1 }, accessToken: 'token' }),
    createSession: async () => ({ id: 'session-1', name: 'default', status: 'open' }),
    execute: async (_runId: string, _token: string, _revision: number, _sessionId: string, statement: string) => { calls.push(statement); return { status: 'succeeded', result: { kind: 'result_set', rows: [{ key: 'idx' }], columns: ['key'], truncated: false, rawOutput: 'key\nidx' } } },
    release: async () => undefined,
  }
}

describe('MySqlDynamicCaseService', () => {
  it('preflights a registered dynamic case without using the fixed manifest path', async () => {
    const calls: string[] = []
    const scenario = setup(successfulScheduler(calls)); const { directory, repository, learnerId, service } = scenario
    try {
      const result = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'mysql-case-1' })
      expect(result.case.id).toBeTruthy()
      expect(result.case.preflightStatus).toBe('passed')
      expect(calls[0]).toMatch(/^EXPLAIN SELECT/)
      expect(calls.some((statement) => statement.includes('CREATE INDEX idx_orders_user_id_created_at'))).toBe(true)
      expect(repository.db.prepare('SELECT COUNT(*) AS count FROM case_materialization_events WHERE type = \'preflight_passed\'').get()).toMatchObject({ count: 1 })
      const callCount = calls.length
      const replayed = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'mysql-case-1' })
      expect(replayed.case.id).toBe(result.case.id)
      expect(calls).toHaveLength(callCount)
      expect(repository.db.prepare('SELECT COUNT(*) AS count FROM case_materialization_events WHERE type = \'preflight_passed\'').get()).toMatchObject({ count: 1 })
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('resolves a registered MySQL capability when an older route node omitted capability_key', async () => {
    const scenario = setup(successfulScheduler()); const { directory, repository, learnerId, service } = scenario
    try {
      repository.db.prepare('UPDATE roadmap_nodes SET capability_key = NULL WHERE id = ?').run('mysql-node')
      const result = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'mysql-node-without-capability' })
      expect(result.case.preflightStatus).toBe('passed')
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('restores a previously failed case to ready after a successful preflight retry', async () => {
    const scenario = setup(successfulScheduler()); const { directory, repository, learnerId, service } = scenario
    try {
      const first = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'mysql-preflight-retry' })
      repository.db.prepare("UPDATE learning_cases SET status = 'failed', preflight_status = 'failed' WHERE id = ?").run(first.case.id)
      const retried = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'mysql-preflight-retry' })
      expect(retried.case.status).toBe('ready')
      expect(retried.case.preflightStatus).toBe('passed')
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('serializes concurrent creation and rejects a reused client request with a different input', async () => {
    const scenario = setup(successfulScheduler()); const { directory, repository, learnerId, service } = scenario
    try {
      const [first, second] = await Promise.all([
        service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'same-client-request' }),
        service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'same-client-request' }),
      ])
      expect(first.case.id).toBe(second.case.id)
      expect(repository.db.prepare('SELECT COUNT(*) AS count FROM learning_cases').get()).toMatchObject({ count: 1 })
      expect(repository.db.prepare('SELECT COUNT(*) AS count FROM case_generation_jobs').get()).toMatchObject({ count: 1 })
      await expect(service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request: { ...request, faultKey: 'missing_index' }, clientRequestId: 'same-client-request' })).rejects.toMatchObject({ code: 'case_request_idempotency_conflict', statusCode: 409 })
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('records failed materialization when MySQL preflight cannot execute', async () => {
    const scheduler = { ...successfulScheduler(), execute: async () => ({ status: 'failed', result: null }) }
    const scenario = setup(scheduler); const { directory, repository, learnerId, service } = scenario
    try {
      await expect(service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'failed-preflight' })).rejects.toMatchObject({ code: 'mysql_case_preflight_failed', statusCode: 503 })
      expect(repository.db.prepare('SELECT status, failure_code FROM case_materializations').get()).toMatchObject({ status: 'failed', failure_code: 'mysql_preflight_failed' })
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('reuses an active dynamic runtime and restarts it after the scheduler expires', async () => {
    let active = true
    let createRunCalls = 0
    const runFor = (sequence: number) => ({ runId: `dynamic-practice-run-${sequence}`, revision: 1, fixtureVersion: 'dynamic-fixture' })
    const scheduler = {
      registerDynamicCase: async () => undefined,
      createRun: async () => { createRunCalls += 1; return { kind: 'started' as const, run: runFor(createRunCalls), accessToken: 'token' } },
      getAccess: (runId: string) => active ? { run: { runId, revision: 1, fixtureVersion: 'dynamic-fixture' }, accessToken: 'token' } : null,
      isRunActive: () => active,
      createSession: async () => ({ id: 'session-1', name: 'default', status: 'open' as const }),
      execute: async () => ({ status: 'succeeded' as const, result: { kind: 'result_set' as const, rows: [{ key: 'idx' }], columns: ['key'], truncated: false, rawOutput: 'key\nidx' } }),
      release: async () => undefined,
    }
    const scenario = setup(scheduler); const { directory, repository, learnerId, service } = scenario
    try {
      const created = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'runtime-case' })
      const first = await service.startPractice(learnerId, created.case.id)
      const practiceId = first.practice.id
      expect((await service.runtime(learnerId, practiceId)).status).toBe('active')
      expect((await service.startPractice(learnerId, created.case.id)).practice.id).toBe(practiceId)
      expect(createRunCalls).toBe(2) // one preflight run and one real runtime

      active = false
      expect((await service.runtime(learnerId, practiceId)).status).toBe('expired')
      active = true
      const restarted = await service.startPractice(learnerId, created.case.id)
      expect(restarted.practice.id).toBe(practiceId)
      expect(restarted.lab?.run.runId).toBe('dynamic-practice-run-3')
      expect(createRunCalls).toBe(3)
      expect(repository.db.prepare("SELECT status FROM practice_lab_segments WHERE practice_run_id = ? ORDER BY started_at ASC").all(practiceId)).toHaveLength(2)
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('returns a durable-to-the-page queue result and adopts it when the scheduler promotes it', async () => {
    let createRunCalls = 0
    const ticket: any = { ticketId: 'dynamic-ticket', caseId: 'dynamic-case', status: 'waiting', position: 1, pollAfterMs: 100, expiresAt: new Date(Date.now() + 60_000).toISOString() }
    const run = { runId: 'queued-dynamic-run', revision: 1, fixtureVersion: 'dynamic-fixture' }
    const scheduler = {
      registerDynamicCase: async () => undefined,
      createRun: async () => { createRunCalls += 1; return createRunCalls === 1 ? { kind: 'started' as const, run, accessToken: 'token' } : { kind: 'queued' as const, ticket } },
      getTicket: () => ticket,
      getAccess: () => null,
      isRunActive: () => false,
      createSession: async () => ({ id: 'session-1', name: 'default', status: 'open' as const }),
      execute: async () => ({ status: 'succeeded' as const, result: { kind: 'result_set' as const, rows: [{ key: 'idx' }], columns: ['key'], truncated: false, rawOutput: 'key\nidx' } }),
      release: async () => undefined,
    }
    const scenario = setup(scheduler); const { directory, repository, learnerId, service } = scenario
    try {
      const created = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'queue-case' })
      const queued = await service.startPractice(learnerId, created.case.id)
      expect(queued.queue?.ticketId).toBe('dynamic-ticket')
      expect(queued.practice.learningCaseId).toBe(created.case.id)
      expect(repository.db.prepare('SELECT runtime_queue_ticket_id, runtime_queue_expires_at FROM practice_runs WHERE id = ?').get(queued.practice.id)).toMatchObject({ runtime_queue_ticket_id: 'dynamic-ticket' })
      expect((await service.runtime(learnerId, queued.practice.id)).status).toBe('queued')
      ticket.status = 'ready'; ticket.run = { ...run, accessToken: 'token' }
      const promoted = await service.runtime(learnerId, queued.practice.id)
      expect(promoted.status).toBe('active')
      expect(promoted.practice.labRunId).toBe('queued-dynamic-run')
    } finally { scenario.repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })

  it('returns expired and clears a queue ticket that is lost during a service restart', async () => {
    const ticket: any = { ticketId: 'restart-ticket', caseId: 'dynamic-case', status: 'waiting', position: 1, pollAfterMs: 100, expiresAt: new Date(Date.now() + 60_000).toISOString() }
    let createRunCalls = 0
    const scheduler = {
      registerDynamicCase: async () => undefined,
      createRun: async () => { createRunCalls += 1; return createRunCalls === 1 ? { kind: 'started' as const, run: { runId: 'preflight-run', revision: 1 }, accessToken: 'token' } : { kind: 'queued' as const, ticket } },
      getTicket: () => ticket,
      getAccess: () => null,
      isRunActive: () => false,
      createSession: async () => ({ id: 'session-1', name: 'default' as const, status: 'open' as const }),
      execute: async () => ({ status: 'succeeded' as const, result: { kind: 'result_set' as const, rows: [{ key: 'idx' }], columns: ['key'], truncated: false, rawOutput: 'key\nidx' } }),
      release: async () => undefined,
    }
    const scenario = setup(scheduler); const { directory, repository, learnerId, service } = scenario
    try {
      const created = await service.createCase(learnerId, { roadmapNodeId: 'mysql-node', request, clientRequestId: 'restart-queue-case' })
      const queued = await service.startPractice(learnerId, created.case.id)
      const restartedScheduler = { ...scheduler, getTicket: () => { throw new LabError('queue_ticket_not_found', '等待票据不存在', 404) } }
      const restartedService = new MySqlDynamicCaseService(repository, restartedScheduler as never)
      const recovered = await restartedService.runtime(learnerId, queued.practice.id)
      expect(recovered.status).toBe('expired')
      expect(recovered.error?.code).toBe('runtime_queue_expired')
      expect(repository.db.prepare('SELECT runtime_queue_ticket_id, runtime_queue_expires_at FROM practice_runs WHERE id = ?').get(queued.practice.id)).toEqual({ runtime_queue_ticket_id: null, runtime_queue_expires_at: null })
    } finally { repository.close(); rmSync(directory, { recursive: true, force: true }) }
  })
})
