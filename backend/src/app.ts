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
import { PracticeService, ProductNotFoundError } from './practice-service.js'

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
  practiceServiceFactory?: (scheduler: LabScheduler) => PracticeService
}

export function buildApp(dependencies: AppDependencies): { app: FastifyInstance; scheduler: LabScheduler } {
  const store = dependencies.store ?? new MySqlLabStore(dependencies.config)
  const scheduler = new LabScheduler(store, dependencies.config)
  const app = Fastify({ logger: false })

  void app.register(cors, { origin: dependencies.config.corsOrigin })
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ProductNotFoundError) return reply.code(404).send({ error: { code: 'not_found', message: error.message, retryable: false } })
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

  if (dependencies.practiceServiceFactory) registerProductRoutes(app, dependencies.practiceServiceFactory(scheduler))

  return { app, scheduler }
}

function learnerId(request: FastifyRequest): string {
  const value = request.headers['x-learner-id']
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : 'anonymous-web'
}

function productBody(request: FastifyRequest): Body {
  return bodyOf(request)
}

function optionalString(body: Body, key: string): string | null | undefined {
  const value = body[key]
  if (value == null) return undefined
  if (typeof value !== 'string') throw new LabError('invalid_request', `${key} 必须是字符串`, 400)
  return value.trim() || null
}

function productRunId(request: FastifyRequest): string { return String((request.params as { runId: string }).runId) }

function registerProductRoutes(app: FastifyInstance, service: PracticeService): void {
  app.post('/api/product/intakes', async (request, reply) => {
    const body = productBody(request); const goal = stringField(body, 'goal')
    const weeklyMinutes = body.weeklyMinutes == null ? null : numberField(body, 'weeklyMinutes')
    reply.code(201).send(service.createIntake({ learnerId: learnerId(request), goal, technology: optionalString(body, 'technology') ?? undefined, outcome: optionalString(body, 'outcome'), weeklyMinutes }))
  })

  app.get('/api/product/intakes/:intakeId', async (request, reply) => reply.send(service.getIntake(String((request.params as { intakeId: string }).intakeId))))
  app.post('/api/product/intakes/:intakeId/plan', async (request, reply) => reply.code(201).send(service.draftPlan(String((request.params as { intakeId: string }).intakeId))))
  app.post('/api/product/plans/:planId/confirm', async (request, reply) => reply.send(service.confirmPlan(String((request.params as { planId: string }).planId))))

  app.post('/api/product/practice-runs', async (request, reply) => {
    const body = productBody(request); const caseId = stringField(body, 'caseId')
    if (!isCaseId(caseId)) throw new LabError('case_not_found', '案例不存在', 404)
    const result = await service.startPractice({ learnerId: learnerId(request), planUnitId: optionalString(body, 'planUnitId'), caseId })
    if (result.queue) return reply.code(202).send(result)
    return reply.code(201).send(result)
  })

  app.get('/api/product/practice-runs/:runId', async (request, reply) => reply.send(service.snapshot(productRunId(request))))
  app.get('/api/product/practice-runs/:runId/lab', async (request, reply) => reply.send(service.labAccess(productRunId(request))))
  app.post('/api/product/practice-runs/:runId/messages', async (request, reply) => {
    const body = productBody(request); const message = stringField(body, 'message')
    reply.send(await service.ask(productRunId(request), message, optionalString(body, 'clientRequestId') ?? undefined))
  })
  app.post('/api/product/practice-runs/:runId/artifacts', async (request, reply) => {
    const body = productBody(request); const content = stringField(body, 'content')
    const kind = optionalString(body, 'kind'); const sourceKind = optionalString(body, 'sourceKind')
    if (kind && !['external_text', 'source_excerpt'].includes(kind)) throw new LabError('invalid_request', '不支持的外部素材类型', 400)
    if (sourceKind && !['user', 'zhihu', 'global_search'].includes(sourceKind)) throw new LabError('invalid_request', '不支持的来源类型', 400)
    reply.code(201).send(service.addExternalArtifact(productRunId(request), { kind: kind as 'external_text' | 'source_excerpt' | undefined, sourceKind: sourceKind as 'user' | 'zhihu' | 'global_search' | undefined, content, metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : undefined }))
  })
  app.post('/api/product/practice-runs/:runId/lab-executions', async (request, reply) => {
    const body = productBody(request); const token = bearer(request)
    if (!token) throw new LabError('unauthorized', '缺少 Lab 访问令牌', 401)
    const result = await service.executeLab({ runId: productRunId(request), token, revision: numberField(body, 'revision'), sessionId: stringField(body, 'sessionId'), statement: stringField(body, 'statement'), clientRequestId: stringField(body, 'clientRequestId') })
    if (result.execution.status === 'timed_out') return reply.code(504).send(result)
    if (result.execution.status === 'failed') return reply.code(422).send(result)
    return reply.send(result)
  })
  app.post('/api/product/practice-runs/:runId/verify', async (request, reply) => reply.send(service.verify(productRunId(request))))
  app.post('/api/product/practice-runs/:runId/note-outline', async (request, reply) => reply.code(201).send(service.generateNoteOutline(productRunId(request))))
  app.post('/api/product/practice-runs/:runId/article-draft', async (request, reply) => {
    const outline = optionalString(productBody(request), 'outline')
    reply.code(201).send(service.generateArticleDraft(productRunId(request), outline ?? undefined))
  })
  app.get('/api/product/memories', async (request, reply) => reply.send(service.memories(learnerId(request))))
  app.patch('/api/product/memories/:memoryId', async (request, reply) => {
    const body = productBody(request); const update: { statement?: string; userNote?: string | null; status?: 'active' | 'corrected' | 'deleted' } = {}
    const statement = optionalString(body, 'statement'); const userNote = optionalString(body, 'userNote'); const status = optionalString(body, 'status')
    if (statement !== undefined) update.statement = statement ?? ''
    if (userNote !== undefined) update.userNote = userNote
    if (status !== undefined) {
      if (!['active', 'corrected', 'deleted'].includes(status ?? '')) throw new LabError('invalid_request', '不支持的记忆状态', 400)
      update.status = status as 'active' | 'corrected' | 'deleted'
    }
    reply.send(service.updateMemory(learnerId(request), String((request.params as { memoryId: string }).memoryId), update))
  })
}
