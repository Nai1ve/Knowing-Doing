import { describe, expect, it } from 'vitest'
import type { PoolConnection } from 'mysql2/promise'
import type { CaseId, CaseManifest } from '../src/domain.js'
import type { LabStore } from '../src/mysql-store.js'
import { LabScheduler } from '../src/scheduler.js'

const manifest: CaseManifest = {
  id: 'dynamic-case-1', title: '动态执行计划案例', schema: 'zhixing_dynamic_123456789abc', allowedSessions: ['default'], fixtureVersion: 'dynamic-v1', tables: ['orders'], baselineIndexes: { orders: { PRIMARY: '' } },
}

class FakeStore implements LabStore {
  readonly resets: CaseId[] = []
  async reset(caseId: CaseId) { this.resets.push(caseId) }
  async createSession(_caseId: CaseId, sessionId: string) { return { sessionId } as unknown as PoolConnection }
  async execute(_connection: PoolConnection, statement: string) { return { elapsed: 1, result: { kind: 'command' as const, affectedRows: 0, warningCount: 0, truncated: false, rawOutput: statement } } }
  async closeConnection(_connection: PoolConnection) {}
  async registerDynamicCase() {}
}

const options = { tokenSecret: 'test-secret', runLeaseMs: 60_000, runIdleTimeoutMs: 60_000, queueLeaseMs: 60_000, queryTimeoutMs: 1_000, maxRows: 100, maxOutputBytes: 8_192 }

async function schedulerWithDynamicCase() {
  const scheduler = new LabScheduler(new FakeStore(), options)
  await scheduler.registerDynamicCase(manifest, { schemaSql: 'CREATE TABLE orders (id INT PRIMARY KEY)', rowCount: 1, distribution: 'uniform', faultSql: '/* none */' })
  return scheduler
}

describe('LabScheduler dynamic runtime', () => {
  it('rejects unregistered cases', async () => {
    const scheduler = new LabScheduler(new FakeStore(), options)
    await expect(scheduler.createRun('fixed-case-removed')).rejects.toMatchObject({ code: 'case_not_found' })
    await scheduler.shutdown()
  })

  it('starts only an explicitly registered dynamic case', async () => {
    const scheduler = await schedulerWithDynamicCase()
    const started = await scheduler.createRun(manifest.id)
    expect(started.kind).toBe('started')
    if (started.kind === 'started') expect(started.run.caseId).toBe(manifest.id)
    await scheduler.shutdown()
  })

  it('serializes a second run through a queue ticket', async () => {
    const scheduler = await schedulerWithDynamicCase()
    const first = await scheduler.createRun(manifest.id)
    const second = await scheduler.createRun(manifest.id)
    expect(first.kind).toBe('started')
    expect(second.kind).toBe('queued')
    if (first.kind === 'started') await scheduler.release(first.run.runId, first.accessToken)
    if (second.kind === 'queued') expect(scheduler.getTicket(second.ticket.ticketId).status).toBe('ready')
    await scheduler.shutdown()
  })

  it('keeps execution idempotent by client request id', async () => {
    const scheduler = await schedulerWithDynamicCase()
    const started = await scheduler.createRun(manifest.id)
    if (started.kind !== 'started') throw new Error('expected active run')
    const session = await scheduler.createSession(started.run.runId, started.accessToken, 'default')
    const first = await scheduler.execute(started.run.runId, started.accessToken, 1, session.id, 'SELECT 1 FROM orders', 'request-1')
    const second = await scheduler.execute(started.run.runId, started.accessToken, 1, session.id, 'SELECT 1 FROM orders', 'request-1')
    expect(second.executionId).toBe(first.executionId)
    await scheduler.shutdown()
  })
})
