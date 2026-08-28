import { describe, expect, it, vi } from 'vitest'
import type { PoolConnection } from 'mysql2/promise'
import type { CaseId, LabExecutionResult } from '../src/domain.js'
import { getManifest, listManifests } from '../src/fixtures.js'
import type { LabStore } from '../src/mysql-store.js'
import { LabScheduler } from '../src/scheduler.js'

class FakeStore implements LabStore {
  readonly resets: CaseId[] = []
  readonly calls: string[] = []
  async health() { return Object.fromEntries(listManifests().map((manifest) => [manifest.id, { ready: true, fixtureVersion: manifest.fixtureVersion }])) as Awaited<ReturnType<LabStore['health']>> }
  async reset(caseId: CaseId) { this.resets.push(caseId) }
  async createSession(_caseId: CaseId, sessionId: string) { return { sessionId } as unknown as PoolConnection }
  async execute(_connection: PoolConnection, statement: string) {
    this.calls.push(statement)
    await new Promise((resolve) => setTimeout(resolve, statement.includes('WAIT') ? 25 : 1))
    return { elapsed: 1, result: { kind: 'command' as const, affectedRows: 0, warningCount: 0, truncated: false, rawOutput: 'ok' } }
  }
  async closeConnection(_connection: PoolConnection) {}
}

const options = { tokenSecret: 'test-secret', runLeaseMs: 60_000, runIdleTimeoutMs: 60_000, queueLeaseMs: 60_000, queryTimeoutMs: 1000, maxRows: 200, maxOutputBytes: 1024 }

async function activeSession(scheduler: LabScheduler, caseId: CaseId, name = 'default') {
  const started = await scheduler.createRun(caseId)
  if (started.kind !== 'started') throw new Error('expected active run')
  const session = await scheduler.createSession(started.run.runId, started.accessToken, name)
  return { started, session }
}

describe('LabScheduler', () => {
  it('runs three cases independently and queues the fourth run in the same case', async () => {
    const store = new FakeStore()
    const scheduler = new LabScheduler(store, options)
    const slow = await scheduler.createRun('mysql-order-list-index-001')
    const deadlock = await scheduler.createRun('mysql-deadlock-lock-order-001')
    const pagination = await scheduler.createRun('mysql-deep-pagination-001')
    expect(slow.kind).toBe('started')
    expect(deadlock.kind).toBe('started')
    expect(pagination.kind).toBe('started')

    const queued = await scheduler.createRun('mysql-order-list-index-001')
    expect(queued.kind).toBe('queued')
    if (slow.kind !== 'started' || queued.kind !== 'queued') throw new Error('fixture setup failed')

    await scheduler.release(slow.run.runId, slow.accessToken)
    expect(scheduler.getTicket(queued.ticket.ticketId).status).toBe('ready')
    await scheduler.shutdown()
  })

  it('serializes one session while allowing deadlock sessions to overlap', async () => {
    const store = new FakeStore()
    const scheduler = new LabScheduler(store, options)
    const run = await scheduler.createRun('mysql-deadlock-lock-order-001')
    if (run.kind !== 'started') throw new Error('expected active run')
    const a = await scheduler.createSession(run.run.runId, run.accessToken, 'tx-a')
    const b = await scheduler.createSession(run.run.runId, run.accessToken, 'tx-b')
    const first = scheduler.execute(run.run.runId, run.accessToken, run.run.revision, a.id, 'UPDATE accounts SET balance = balance + 1 WHERE id = 1', 'a-1')
    const second = scheduler.execute(run.run.runId, run.accessToken, run.run.revision, a.id, 'UPDATE accounts SET balance = balance + 1 WHERE id = 1', 'a-2')
    const txB = scheduler.execute(run.run.runId, run.accessToken, run.run.revision, b.id, 'UPDATE accounts SET balance = balance + 1 WHERE id = 2', 'b-1')
    const results = await Promise.all([first, second, txB])
    expect(results.every((result: LabExecutionResult) => result.status === 'succeeded')).toBe(true)
    expect(store.calls).toEqual([
      'UPDATE accounts SET balance = balance + 1 WHERE id = 1',
      'UPDATE accounts SET balance = balance + 1 WHERE id = 2',
      'UPDATE accounts SET balance = balance + 1 WHERE id = 1',
    ])
    await scheduler.shutdown()
  })

  it('deduplicates concurrent requests with the same client request id', async () => {
    const store = new FakeStore()
    const scheduler = new LabScheduler(store, options)
    const { started, session } = await activeSession(scheduler, 'mysql-order-list-index-001')
    const first = scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, 'WAIT', 'same-request')
    const second = scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, 'WAIT', 'same-request')
    const [firstResult, secondResult] = await Promise.all([first, second])
    expect(firstResult.executionId).toBe(secondResult.executionId)
    expect(store.calls).toEqual(['WAIT'])
    await scheduler.shutdown()
  })

  it('invalidates old tokens after reset', async () => {
    const store = new FakeStore()
    const scheduler = new LabScheduler(store, options)
    const { started, session } = await activeSession(scheduler, 'mysql-order-list-index-001')
    const reset = await scheduler.reset(started.run.runId, started.accessToken, started.run.revision)
    expect(reset.run.revision).toBe(started.run.revision + 1)
    expect(() => scheduler.getRun(started.run.runId, started.accessToken)).toThrowError('版本已变化')
    await expect(scheduler.createSession(started.run.runId, started.accessToken, 'default')).rejects.toThrowError('版本已变化')
    await expect(scheduler.execute(started.run.runId, started.accessToken, started.run.revision, session.id, 'SELECT 1', 'stale')).rejects.toThrowError('版本已变化')
    await scheduler.shutdown()
  })

  it('expires an idle run and promotes the next queued ticket', async () => {
    const store = new FakeStore()
    const scheduler = new LabScheduler(store, { ...options, runIdleTimeoutMs: 10 })
    const first = await scheduler.createRun('mysql-order-list-index-001')
    const queued = await scheduler.createRun('mysql-order-list-index-001')
    if (first.kind !== 'started' || queued.kind !== 'queued') throw new Error('expected active run and queued ticket')

    await new Promise((resolve) => setTimeout(resolve, 25))
    const next = await scheduler.createRun('mysql-order-list-index-001')

    expect(next.kind).toBe('queued')
    expect(scheduler.getTicket(queued.ticket.ticketId).status).toBe('ready')
    await scheduler.shutdown()
  })

  it('reaps an idle run without requiring another API request', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeStore()
      const scheduler = new LabScheduler(store, { ...options, runIdleTimeoutMs: 10 })
      const first = await scheduler.createRun('mysql-order-list-index-001')
      const queued = await scheduler.createRun('mysql-order-list-index-001')
      if (first.kind !== 'started' || queued.kind !== 'queued') throw new Error('expected active run and queued ticket')

      await vi.advanceTimersByTimeAsync(30_000)

      expect(scheduler.getTicket(queued.ticket.ticketId).status).toBe('ready')
      expect(store.resets).toContain('mysql-order-list-index-001')
      await scheduler.shutdown()
    } finally {
      vi.useRealTimers()
    }
  })

  it('refreshes the idle window when the active run is read', async () => {
    vi.useFakeTimers()
    try {
      const store = new FakeStore()
      const scheduler = new LabScheduler(store, { ...options, runIdleTimeoutMs: 10 })
      const started = await scheduler.createRun('mysql-order-list-index-001')
      if (started.kind !== 'started') throw new Error('expected active run')

      vi.advanceTimersByTime(8)
      const refreshed = scheduler.getRun(started.run.runId, started.accessToken)
      expect(new Date(refreshed.idleExpiresAt).getTime()).toBeGreaterThan(Date.now())
      vi.advanceTimersByTime(8)
      expect(() => scheduler.getRun(started.run.runId, started.accessToken)).not.toThrow()
      await scheduler.shutdown()
    } finally {
      vi.useRealTimers()
    }
  })
})
