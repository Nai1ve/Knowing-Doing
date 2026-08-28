import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import type { LabConfig } from './config.js'
import type { CaseId } from './domain.js'
import { errorResponse, LabError } from './errors.js'
import { getManifest, isCaseId, listManifests } from './fixtures.js'
import { MySqlLabStore, type LabStore } from './mysql-store.js'
import { LabScheduler } from './scheduler.js'
import { validateStatement } from './sql-policy.js'
import { verifyLabToken } from './token.js'

type Body = Record<string, unknown>

function bodyOf(request: FastifyRequest): Body {
  return request.body && typeof request.body === 'object' ? request.body as Body : {}
}

function stringField(body: Body, key: string): string {
  const value = body[key]
  if (typeof value !== 'string' || !value.trim()) throw new LabError('invalid_request', `${key} 不能为空`, 400)
  return value.trim()
}

function numberField(body: Body, key: string): number {
  const value = body[key]
  if (typeof value !== 'number' || !Number.isInteger(value) || value <= 0) throw new LabError('invalid_request', `${key} 必须是正整数`, 400)
  return value
}

function bearer(request: FastifyRequest): string | undefined {
  const header = request.headers.authorization
  if (!header) return undefined
  const match = /^Bearer\s+(.+)$/i.exec(header)
  return match?.[1]
}

export interface AppDependencies {
  config: LabConfig
  store?: LabStore
}

export function buildApp(dependencies: AppDependencies): { app: FastifyInstance; scheduler: LabScheduler } {
  const store = dependencies.store ?? new MySqlLabStore(dependencies.config)
  const scheduler = new LabScheduler(store, dependencies.config)
  const app = Fastify({ logger: false })

  void app.register(cors, { origin: dependencies.config.corsOrigin })
  app.setErrorHandler((error, _request, reply) => {
    const response = errorResponse(error)
    reply.code(response.statusCode).send(response.body)
  })

  app.get('/api/lab/health', async (_request, reply) => {
    const fixtures = await store.health()
    reply.send({ ready: Object.values(fixtures).every((fixture) => fixture.ready), fixtures, cases: scheduler.caseStatus() })
  })

  app.get('/api/lab/cases', async (_request, reply) => {
    reply.send(listManifests().map((manifest) => ({
      id: manifest.id,
      title: manifest.title,
      fixtureVersion: manifest.fixtureVersion,
      allowedSessions: manifest.allowedSessions,
    })))
  })

  app.post('/api/lab/runs', async (request, reply) => {
    const caseId = stringField(bodyOf(request), 'caseId')
    if (!isCaseId(caseId)) throw new LabError('case_not_found', '案例不存在', 404)
    const result = await scheduler.createRun(caseId)
    if (result.kind === 'started') return reply.code(201).send({ run: result.run, accessToken: result.accessToken })
    return reply.code(202).send({ ticket: result.ticket })
  })

  app.get('/api/lab/queue-tickets/:ticketId', async (request, reply) => {
    const ticketId = String((request.params as { ticketId: string }).ticketId)
    reply.send(scheduler.getTicket(ticketId))
  })

  app.delete('/api/lab/queue-tickets/:ticketId', async (request, reply) => {
    const ticketId = String((request.params as { ticketId: string }).ticketId)
    scheduler.cancelTicket(ticketId)
    reply.code(204).send()
  })

  app.get('/api/lab/runs/:runId', async (request, reply) => {
    const runId = String((request.params as { runId: string }).runId)
    reply.send(scheduler.getRun(runId, bearer(request)))
  })

  app.delete('/api/lab/runs/:runId', async (request, reply) => {
    const runId = String((request.params as { runId: string }).runId)
    await scheduler.release(runId, bearer(request))
    reply.code(204).send()
  })

  app.post('/api/lab/runs/:runId/sessions', async (request, reply) => {
    const runId = String((request.params as { runId: string }).runId)
    const name = stringField(bodyOf(request), 'name')
    reply.code(201).send(await scheduler.createSession(runId, bearer(request), name))
  })

  app.post('/api/lab/runs/:runId/execute', async (request, reply) => {
    const runId = String((request.params as { runId: string }).runId)
    const body = bodyOf(request)
    const run = scheduler.getRun(runId, bearer(request))
    const manifest = getManifest(run.caseId)
    const statement = stringField(body, 'statement')
    const sessionId = stringField(body, 'sessionId')
    const clientRequestId = stringField(body, 'clientRequestId')
    const revision = numberField(body, 'revision')
    validateStatement(statement, manifest)
    const result = await scheduler.execute(runId, bearer(request), revision, sessionId, statement, clientRequestId)
    if (result.status === 'timed_out') return reply.code(504).send(result)
    if (result.status === 'failed') return reply.code(422).send(result)
    return reply.send(result)
  })

  app.post('/api/lab/runs/:runId/reset', async (request, reply) => {
    const runId = String((request.params as { runId: string }).runId)
    const body = bodyOf(request)
    const revision = numberField(body, 'revision')
    reply.send(await scheduler.reset(runId, bearer(request), revision))
  })

  app.get('/api/lab/cases/:caseId/snapshots/:snapshotId', async (request, reply) => {
    const caseId = String((request.params as { caseId: string }).caseId)
    if (!isCaseId(caseId)) throw new LabError('case_not_found', '案例不存在', 404)
    throw new LabError('replay_not_ready', '当前案例尚未准备可用的回放快照', 503, true, { caseId, snapshotId: String((request.params as { snapshotId: string }).snapshotId) })
  })

  return { app, scheduler }
}
