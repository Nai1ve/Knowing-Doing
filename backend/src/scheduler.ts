import { randomUUID } from 'node:crypto'
import type { PoolConnection as Connection } from 'mysql2/promise'
import { AsyncGate, AsyncMutex } from './async-gate.js'
import type { CaseId, LabExecutionResult, QueueTicketView, RunView, SessionName } from './domain.js'
import { getManifest, listManifests } from './fixtures.js'
import { LabError } from './errors.js'
import type { LabStore } from './mysql-store.js'
import { signLabToken, verifyLabToken } from './token.js'

interface ManagedSession {
  id: string
  name: SessionName
  connection: Connection
  status: 'open' | 'closed'
  mutex: AsyncMutex
}

interface ActiveRun {
  runId: string
  caseId: CaseId
  revision: number
  createdAt: number
  expiresAt: number
  lastActivityAt: number
  sessions: Map<SessionName, ManagedSession>
  results: Map<string, LabExecutionResult>
  inFlight: Map<string, Promise<LabExecutionResult>>
}

interface Ticket {
  ticketId: string
  caseId: CaseId
  createdAt: number
  expiresAt: number
  status: 'waiting' | 'ready' | 'expired' | 'cancelled'
  run?: ActiveRun
}

interface CaseSlot {
  caseId: CaseId
  active?: ActiveRun
  queue: Ticket[]
  control: AsyncMutex
  gate: AsyncGate
}

export interface SchedulerOptions {
  tokenSecret: string
  runLeaseMs: number
  runIdleTimeoutMs: number
  queueLeaseMs: number
  queryTimeoutMs: number
  maxRows: number
  maxOutputBytes: number
}

export class LabScheduler {
  private readonly slots = new Map<CaseId, CaseSlot>()
  private readonly tickets = new Map<string, Ticket>()
  private readonly reapTimer: NodeJS.Timeout

  constructor(private readonly store: LabStore, private readonly options: SchedulerOptions) {
    for (const manifest of listManifests()) {
      this.slots.set(manifest.id, { caseId: manifest.id, queue: [], control: new AsyncMutex(), gate: new AsyncGate() })
    }
    this.reapTimer = setInterval(() => { void this.reapExpired() }, 30_000)
    this.reapTimer.unref()
  }

  async createRun(caseId: CaseId): Promise<{ kind: 'started'; run: RunView; accessToken: string } | { kind: 'queued'; ticket: QueueTicketView }> {
    const slot = this.getSlot(caseId)
    return slot.control.run(async () => {
      await this.expireActiveIfNeeded(slot)
      if (slot.active) {
        const ticket = this.newTicket(caseId)
        slot.queue.push(ticket)
        this.tickets.set(ticket.ticketId, ticket)
        return { kind: 'queued', ticket: this.toTicketView(ticket) }
      }
      const run = await this.startRun(slot)
      return { kind: 'started', run: this.toRunView(run), accessToken: this.tokenFor(run) }
    })
  }

  getRun(runId: string, token: string | undefined): RunView {
    const run = this.findRun(runId, token)
    this.recordActivity(run)
    return this.toRunView(run)
  }

  getAccess(runId: string): { run: RunView; accessToken: string } | null {
    for (const slot of this.slots.values()) {
      const run = slot.active
      if (!run || run.runId !== runId || this.isExpired(run)) continue
      this.recordActivity(run)
      return { run: this.toRunView(run), accessToken: this.tokenFor(run) }
    }
    return null
  }

  isRunActive(runId: string): boolean {
    for (const slot of this.slots.values()) if (slot.active?.runId === runId && !this.isExpired(slot.active)) return true
    return false
  }

  getTicket(ticketId: string): QueueTicketView {
    const ticket = this.findTicket(ticketId)
    if (ticket.status === 'waiting' && ticket.expiresAt <= Date.now()) ticket.status = 'expired'
    return this.toTicketView(ticket)
  }

  caseStatus() {
    return [...this.slots.values()].map((slot) => ({
      caseId: slot.caseId,
      activeRunId: slot.active?.runId,
      queueLength: slot.queue.filter((ticket) => ticket.status === 'waiting' && ticket.expiresAt > Date.now()).length,
    }))
  }

  cancelTicket(ticketId: string): void {
    const ticket = this.findTicket(ticketId)
    if (ticket.status === 'waiting') ticket.status = 'cancelled'
  }

  async createSession(runId: string, token: string | undefined, name: string): Promise<{ id: string; name: SessionName; status: 'open' }> {
    const run = this.findRun(runId, token)
    this.recordActivity(run)
    const manifest = getManifest(run.caseId)
    if (!manifest.allowedSessions.includes(name as SessionName)) {
      throw new LabError('session_not_allowed', '当前案例不支持该会话', 422, false, { allowedSessions: manifest.allowedSessions })
    }
    const sessionName = name as SessionName
    return this.slotFor(run.caseId).gate.read(async () => {
      const currentRun = this.findRun(runId, token)
      this.recordActivity(currentRun)
      const current = currentRun.sessions.get(sessionName)
      if (current?.status === 'open') return { id: current.id, name: current.name, status: 'open' as const }
      const connection = await this.store.createSession(currentRun.caseId, sessionName)
      const session = { id: randomUUID(), name: sessionName, connection, status: 'open' as const, mutex: new AsyncMutex() }
      currentRun.sessions.set(sessionName, session)
      return { id: session.id, name: session.name, status: session.status }
    })
  }

  async execute(runId: string, token: string | undefined, revision: number, sessionId: string, statement: string, clientRequestId: string): Promise<LabExecutionResult> {
    const run = this.findRun(runId, token, revision)
    this.recordActivity(run)
    const session = [...run.sessions.values()].find((candidate) => candidate.id === sessionId)
    if (!session || session.status !== 'open') throw new LabError('session_not_found', 'SQL 会话不存在或已关闭', 409, true)
    const cached = run.results.get(clientRequestId)
    if (cached) return cached

    return this.slotFor(run.caseId).gate.read(async () => {
      if (run.revision !== revision) {
        throw new LabError('revision_conflict', 'Lab 运行版本已变化，请刷新当前运行', 409, true, { expectedRevision: revision, currentRevision: run.revision })
      }
      this.recordActivity(run)
      if (session.status !== 'open') throw new LabError('session_not_found', 'SQL 会话不存在或已关闭', 409, true)
      const current = run.results.get(clientRequestId)
      if (current) return current
      const inFlight = run.inFlight.get(clientRequestId)
      if (inFlight) return inFlight

      const execution = session.mutex.run(async () => {
      const executionId = randomUUID()
      const startedAt = new Date().toISOString()
      try {
        const output = await this.store.execute(session.connection, statement, this.options.queryTimeoutMs, this.options.maxRows, this.options.maxOutputBytes)
        const result: LabExecutionResult = {
          executionId, runId, caseId: run.caseId, revision: run.revision, clientRequestId, session: session.name,
          statement, status: 'succeeded', startedAt, durationMs: output.elapsed, result: output.result,
        }
        run.results.set(clientRequestId, result)
        return result
      } catch (error) {
        if (error instanceof LabError && error.code === 'execution_timeout') {
          session.status = 'closed'
          await this.store.closeConnection(session.connection, { destroy: true }).catch(() => undefined)
          const result: LabExecutionResult = {
            executionId, runId, caseId: run.caseId, revision: run.revision, clientRequestId, session: session.name,
            statement, status: 'timed_out', startedAt, durationMs: Date.now() - Date.parse(startedAt),
            error: { code: error.code, message: error.message, retryable: true },
          }
          run.results.set(clientRequestId, result)
          return result
        }
        if (error instanceof LabError && error.code === 'execution_failed') {
          const result: LabExecutionResult = {
            executionId, runId, caseId: run.caseId, revision: run.revision, clientRequestId, session: session.name,
            statement, status: 'failed', startedAt, durationMs: Date.now() - Date.parse(startedAt),
            error: { code: error.code, message: error.message, sqlState: typeof error.details?.sqlState === 'string' ? error.details.sqlState : undefined, retryable: false },
          }
          run.results.set(clientRequestId, result)
          return result
        }
        throw error
      }
      })
      run.inFlight.set(clientRequestId, execution)
      try {
        return await execution
      } finally {
        run.inFlight.delete(clientRequestId)
      }
    })
  }

  async reset(runId: string, token: string | undefined, revision: number): Promise<{ run: RunView; accessToken: string }> {
    const run = this.findRun(runId, token, revision)
    const slot = this.slotFor(run.caseId)
    return slot.control.run(async () => {
      const current = this.findRun(runId, token, revision)
      return slot.gate.write(async () => {
        await this.closeSessions(current)
        await this.store.reset(current.caseId)
        current.revision += 1
        current.results.clear()
        current.expiresAt = Date.now() + this.options.runLeaseMs
        current.lastActivityAt = Date.now()
        return { run: this.toRunView(current), accessToken: this.tokenFor(current) }
      })
    })
  }

  async release(runId: string, token: string | undefined): Promise<void> {
    const run = this.findRun(runId, token)
    const slot = this.slotFor(run.caseId)
    await slot.control.run(async () => {
      const current = this.findRun(runId, token)
      if (slot.active?.runId !== current.runId) return
      await this.finishActive(slot)
      await this.promoteNext(slot)
    })
  }

  async shutdown(): Promise<void> {
    clearInterval(this.reapTimer)
    for (const slot of this.slots.values()) {
      await slot.control.run(async () => {
        if (slot.active) await this.finishActive(slot)
      })
    }
    await this.store.close?.()
  }

  private async startRun(slot: CaseSlot): Promise<ActiveRun> {
    await slot.gate.write(() => this.store.reset(slot.caseId))
    const now = Date.now()
    const run: ActiveRun = {
      runId: randomUUID(), caseId: slot.caseId, revision: 1, createdAt: now,
      expiresAt: now + this.options.runLeaseMs, lastActivityAt: now,
      sessions: new Map(), results: new Map(), inFlight: new Map(),
    }
    slot.active = run
    return run
  }

  private async promoteNext(slot: CaseSlot): Promise<void> {
    while (!slot.active && slot.queue.length > 0) {
      const ticket = slot.queue.shift()!
      if (ticket.status !== 'waiting' || ticket.expiresAt <= Date.now()) {
        ticket.status = 'expired'
        continue
      }
      try {
        ticket.run = await this.startRun(slot)
        ticket.status = 'ready'
        slot.active = ticket.run
      } catch {
        ticket.status = 'expired'
      }
    }
  }

  private async finishActive(slot: CaseSlot): Promise<void> {
    if (!slot.active) return
    const run = slot.active
    await slot.gate.write(async () => {
      await this.closeSessions(run)
      await this.store.reset(run.caseId)
    })
    slot.active = undefined
  }

  private async closeSessions(run: ActiveRun): Promise<void> {
    for (const session of run.sessions.values()) {
      if (session.status === 'open') await this.store.closeConnection(session.connection).catch(() => undefined)
      session.status = 'closed'
    }
    run.sessions.clear()
  }

  private async expireActiveIfNeeded(slot: CaseSlot): Promise<void> {
    if (slot.active && this.isExpired(slot.active)) {
      await this.finishActive(slot)
      await this.promoteNext(slot)
    }
  }

  private async reapExpired(): Promise<void> {
    for (const slot of this.slots.values()) {
      await slot.control.run(async () => {
        await this.expireActiveIfNeeded(slot)
      })
    }
  }

  private findRun(runId: string, token: string | undefined, revision?: number): ActiveRun {
    const payload = verifyLabToken(token, this.options.tokenSecret, { runId, caseId: this.caseIdForRun(runId), revision })
    const run = this.slotFor(payload.caseId).active
    if (!run || run.runId !== runId) throw new LabError('run_not_found', 'Lab 运行不存在或已结束', 404)
    if (this.isExpired(run)) throw new LabError('run_expired', 'Lab 已超过空闲时间，请重新进入案例', 410)
    if (payload.revision !== run.revision) {
      throw new LabError('revision_conflict', 'Lab 运行版本已变化，请刷新当前运行', 409, true, { currentRevision: run.revision, tokenRevision: payload.revision })
    }
    return run
  }

  private caseIdForRun(runId: string): CaseId {
    for (const slot of this.slots.values()) if (slot.active?.runId === runId) return slot.caseId
    throw new LabError('run_not_found', 'Lab 运行不存在或已结束', 404)
  }

  private tokenFor(run: ActiveRun): string {
    return signLabToken({ sub: run.runId, caseId: run.caseId, revision: run.revision, scope: 'lab:execute', exp: run.expiresAt }, this.options.tokenSecret)
  }

  private getSlot(caseId: CaseId): CaseSlot { return this.slotFor(caseId) }

  private slotFor(caseId: CaseId): CaseSlot {
    const slot = this.slots.get(caseId)
    if (!slot) throw new LabError('case_not_found', '案例不存在', 404)
    return slot
  }

  private newTicket(caseId: CaseId): Ticket {
    const now = Date.now()
    return { ticketId: randomUUID(), caseId, createdAt: now, expiresAt: now + this.options.queueLeaseMs, status: 'waiting' }
  }

  private findTicket(ticketId: string): Ticket {
    const ticket = this.tickets.get(ticketId)
    if (!ticket) throw new LabError('queue_ticket_not_found', '等待票据不存在', 404)
    return ticket
  }

  private toRunView(run: ActiveRun): RunView {
    const manifest = getManifest(run.caseId)
    return {
      runId: run.runId, caseId: run.caseId, revision: run.revision, status: 'active', fixtureVersion: manifest.fixtureVersion,
      expiresAt: new Date(run.expiresAt).toISOString(),
      idleExpiresAt: new Date(Math.min(run.expiresAt, run.lastActivityAt + this.options.runIdleTimeoutMs)).toISOString(),
      sessions: [...run.sessions.values()].map((session) => ({ id: session.id, name: session.name, status: session.status })),
    }
  }

  private toTicketView(ticket: Ticket): QueueTicketView {
    const slot = this.slotFor(ticket.caseId)
    const position = ticket.status === 'waiting' ? slot.queue.filter((item) => item.status === 'waiting' && item.createdAt <= ticket.createdAt).length : undefined
    return {
      ticketId: ticket.ticketId, caseId: ticket.caseId, status: ticket.status,
      ...(position !== undefined ? { position, pollAfterMs: 2000 } : {}),
      ...(ticket.run && ticket.status === 'ready' ? { run: { ...this.toRunView(ticket.run), accessToken: this.tokenFor(ticket.run) } } : {}),
      expiresAt: new Date(ticket.expiresAt).toISOString(),
    }
  }

  private recordActivity(run: ActiveRun): void {
    run.lastActivityAt = Date.now()
  }

  private isExpired(run: ActiveRun): boolean {
    const now = Date.now()
    return run.expiresAt <= now || run.lastActivityAt + this.options.runIdleTimeoutMs <= now
  }
}
