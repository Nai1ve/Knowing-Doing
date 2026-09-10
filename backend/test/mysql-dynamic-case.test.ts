import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { applyProductMigrations } from '../src/product-migrate.js'
import { ProductRepository } from '../src/product-repository.js'
import { MySqlDynamicCaseService } from '../src/mysql-dynamic-case-service.js'

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
})
