import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import type { LabConfig } from './config.js'
import type { CaseId } from './domain.js'
import { errorResponse, LabError } from './errors.js'
import { getManifest, isCaseId, listManifests } from './fixtures.js'
import { MySqlLabStore, type LabStore } from './mysql-store.js'
import { LabScheduler } from './scheduler.js'
import { validateStatement } from './sql-policy.js'
import { verifyLabToken } from './token.js'
import { PracticeService, ProductNotFoundError, type TutorStreamEvent } from './practice-service.js'
import { TutorProviderError } from './tutor.js'
import { WritingConflictError, WritingNotFoundError, WritingService } from './writing-service.js'
import { PlanningService } from './planning.js'

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
  writingServiceFactory?: () => WritingService
  planningServiceFactory?: () => PlanningService
  runtimeStatus?: () => Promise<Record<string, unknown>>
}

export function buildApp(dependencies: AppDependencies): { app: FastifyInstance; scheduler: LabScheduler } {
  const store = dependencies.store ?? new MySqlLabStore(dependencies.config)
  const scheduler = new LabScheduler(store, dependencies.config)
  const app = Fastify({ logger: false })

  void app.register(cors, { origin: dependencies.config.corsOrigin, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] })
  app.setErrorHandler((error, _request, reply) => {
    if (process.env.NODE_ENV !== 'production') console.error('[zhixing-api]', error instanceof Error ? `${error.name}: ${error.message}` : error)
    if (error instanceof ProductNotFoundError || error instanceof WritingNotFoundError) return reply.code(404).send({ error: { code: 'not_found', message: error.message, retryable: false } })
    if (error instanceof WritingConflictError) return reply.code(409).send({ error: { code: 'writing_conflict', message: error.message, retryable: false } })
    if (error instanceof TutorProviderError) return reply.code(error.statusCode ?? 503).send({ error: { code: error.code, message: error.message, retryable: error.retryable } })
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

  app.get('/api/product/runtime-status', async (_request, reply) => {
    reply.send(await dependencies.runtimeStatus?.() ?? { model: { configured: Boolean(dependencies.config.modelBaseUrl && dependencies.config.modelApiKey), name: dependencies.config.modelName }, zhihu: { configured: false, executable: false, lastRetrieval: null } })
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

  if (dependencies.practiceServiceFactory) registerProductRoutes(app, dependencies.practiceServiceFactory(scheduler), dependencies.writingServiceFactory?.())
  if (dependencies.planningServiceFactory) registerPlanningRoutes(app, dependencies.planningServiceFactory())

  return { app, scheduler }
}

function registerPlanningRoutes(app: FastifyInstance, service: PlanningService): void {
  app.post('/api/product/planning-sessions', async (request, reply) => {
    const body = productBody(request)
    reply.code(201).send(service.createSession(learnerId(request), { goal: optionalString(body, 'goal') ?? undefined, clientRequestId: optionalString(body, 'clientRequestId') }))
  })
  app.get('/api/product/planning-sessions/:sessionId', async (request, reply) => {
    reply.send(service.getSession(learnerId(request), String((request.params as { sessionId: string }).sessionId)))
  })
  app.post('/api/product/planning-sessions/:sessionId/turns', async (request, reply) => {
    const body = productBody(request)
    reply.send(service.addTurn(learnerId(request), String((request.params as { sessionId: string }).sessionId), {
      revision: numberField(body, 'revision'), stepKey: stringField(body, 'stepKey'), answer: stringField(body, 'answer'), structuredValue: body.structuredValue,
    }))
  })
  app.post('/api/product/planning-sessions/:sessionId/adjustments', async (request, reply) => {
    const body = productBody(request)
    const mastered = body.masteredNodeKeys == null ? undefined : Array.isArray(body.masteredNodeKeys) && body.masteredNodeKeys.every((item) => typeof item === 'string') ? body.masteredNodeKeys as string[] : (() => { throw new LabError('invalid_request', 'masteredNodeKeys 必须是字符串数组', 400) })()
    const weeklyMinutes = body.weeklyMinutes == null ? undefined : numberField(body, 'weeklyMinutes')
    reply.send(service.adjust(learnerId(request), String((request.params as { sessionId: string }).sessionId), { revision: numberField(body, 'revision'), weeklyMinutes, priorityDomain: optionalString(body, 'priorityDomain') ?? undefined, masteredNodeKeys: mastered }))
  })
  app.get('/api/product/roadmap-drafts/:roadmapId', async (request, reply) => {
    reply.send(service.getDraftForLearner(learnerId(request), String((request.params as { roadmapId: string }).roadmapId)))
  })
  app.post('/api/product/roadmap-drafts/:roadmapId/confirm', async (request, reply) => {
    reply.send(service.confirm(learnerId(request), String((request.params as { roadmapId: string }).roadmapId), numberField(productBody(request), 'revision')))
  })
  app.get('/api/product/roadmaps/current', async (request, reply) => {
    reply.send(service.current(learnerId(request)))
  })
  app.get('/api/product/roadmaps/:roadmapId/nodes', async (request, reply) => {
    const query = request.query as { parentId?: string; depth?: string }
    const depth = query.depth == null ? 1 : Number(query.depth)
    if (!Number.isInteger(depth) || depth < 1 || depth > 2) throw new LabError('invalid_request', 'depth 必须是 1 或 2', 400)
    reply.send(service.listNodes(learnerId(request), String((request.params as { roadmapId: string }).roadmapId), query.parentId || null, depth))
  })
  app.post('/api/product/roadmaps/:roadmapId/nodes/:nodeId/complete', async (request, reply) => {
    const body = productBody(request); const status = body.status == null ? undefined : body.status === 'self_reported' || body.status === 'completed' ? body.status : (() => { throw new LabError('invalid_request', 'status 不受支持', 400) })()
    reply.send(service.completeNode(learnerId(request), String((request.params as { roadmapId: string }).roadmapId), String((request.params as { nodeId: string }).nodeId), { revision: numberField(body, 'revision'), status }))
  })
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

function registerProductRoutes(app: FastifyInstance, service: PracticeService, writingService?: WritingService): void {
  app.post('/api/product/sample-plans/mysql-performance', async (request, reply) => {
    reply.code(201).send(service.createMysqlPerformancePlan(learnerId(request)))
  })

  app.get('/api/product/plans/active', async (request, reply) => {
    reply.send(service.getActivePlan(learnerId(request)))
  })

  app.get('/api/product/plans/current', async (request, reply) => {
    reply.send(service.getCurrentPlan(learnerId(request)))
  })

  app.get('/api/product/plans/:planId', async (request, reply) => {
    reply.send(service.getPlan(learnerId(request), String((request.params as { planId: string }).planId)))
  })

  app.post('/api/product/plans/:planId/units/:unitId/practice', async (request, reply) => {
    const params = request.params as { planId: string; unitId: string }
    const result = await service.startPlannedPractice({ learnerId: learnerId(request), planId: params.planId, planUnitId: params.unitId })
    reply.code(result.queue ? 202 : 201).send(result)
  })

  app.get('/api/product/onboarding/state', async (request, reply) => {
    reply.send(service.onboardingState(learnerId(request)))
  })

  app.post('/api/product/plans/regenerate', async (request, reply) => {
    const body = productBody(request)
    reply.code(201).send(service.regeneratePlan(learnerId(request), optionalString(body, 'clientRequestId')))
  })

  app.get('/api/product/profile/evidence', async (request, reply) => {
    reply.send(service.profileEvidence(learnerId(request)))
  })

  app.post('/api/product/diagnostic-sessions', async (request, reply) => {
    const body = productBody(request)
    const targetKey = stringField(body, 'targetKey')
    const goal = stringField(body, 'goal')
    const clientRequestId = optionalString(body, 'clientRequestId')
    reply.code(201).send(service.createDiagnosticSession({ learnerId: learnerId(request), targetKey: targetKey as 'mysql_performance' | 'general', goal, clientRequestId }))
  })

  app.get('/api/product/diagnostic-sessions/:sessionId', async (request, reply) => {
    reply.send(service.getDiagnosticSession(learnerId(request), String((request.params as { sessionId: string }).sessionId)))
  })

  app.patch('/api/product/diagnostic-sessions/:sessionId', async (request, reply) => {
    const body = productBody(request); const sessionId = String((request.params as { sessionId: string }).sessionId)
    const session = service.getDiagnosticSession(learnerId(request), sessionId)
    reply.send(service.saveDiagnosticAnswers({
      learnerId: learnerId(request), sessionId, revision: numberField(body, 'revision'), targetKey: session.targetKey,
      goal: stringField(body, 'goal'), experience: stringField(body, 'experience'), selfAssessment: stringField(body, 'selfAssessment'),
      weeklyMinutes: numberField(body, 'weeklyMinutes'), outcome: stringField(body, 'outcome'), contextNote: optionalString(body, 'contextNote') ?? '',
    }))
  })

  app.post('/api/product/diagnostic-sessions/:sessionId/proposals', async (request, reply) => {
    reply.code(201).send(service.createDiagnosticProposal(learnerId(request), String((request.params as { sessionId: string }).sessionId)))
  })

  app.get('/api/product/plan-proposals/:proposalId', async (request, reply) => {
    reply.send(service.getDiagnosticProposal(learnerId(request), String((request.params as { proposalId: string }).proposalId)))
  })

  app.post('/api/product/plan-proposals/:proposalId/confirm', async (request, reply) => {
    const body = productBody(request)
    reply.send(service.confirmDiagnosticProposal(learnerId(request), String((request.params as { proposalId: string }).proposalId), numberField(body, 'revision')))
  })

  app.post('/api/product/intakes', async (request, reply) => {
    const body = productBody(request); const goal = stringField(body, 'goal')
    const weeklyMinutes = body.weeklyMinutes == null ? null : numberField(body, 'weeklyMinutes')
    reply.code(201).send(service.createIntake({ learnerId: learnerId(request), goal, technology: optionalString(body, 'technology') ?? undefined, outcome: optionalString(body, 'outcome'), weeklyMinutes }))
  })

  app.get('/api/product/intakes/:intakeId', async (request, reply) => reply.send(service.getIntake(learnerId(request), String((request.params as { intakeId: string }).intakeId))))
  app.post('/api/product/intakes/:intakeId/plan', async (request, reply) => reply.code(201).send(service.draftPlan(learnerId(request), String((request.params as { intakeId: string }).intakeId))))
  app.post('/api/product/plans/:planId/confirm', async (request, reply) => reply.send(service.confirmPlan(learnerId(request), String((request.params as { planId: string }).planId))))

  app.post('/api/product/practice-runs', async (request, reply) => {
    const body = productBody(request); const planId = stringField(body, 'planId'); const planUnitId = stringField(body, 'planUnitId')
    const result = await service.startPlannedPractice({ learnerId: learnerId(request), planId, planUnitId })
    if (result.queue) return reply.code(202).send(result)
    return reply.code(201).send(result)
  })

  app.get('/api/product/practice-runs', async (request, reply) => {
    const query = request.query as { cursor?: string; limit?: string }
    const limit = query.limit == null ? 20 : Number(query.limit)
    if (!Number.isInteger(limit) || limit <= 0) throw new LabError('invalid_request', 'limit 必须是正整数', 400)
    reply.send(service.history(learnerId(request), query.cursor, limit))
  })
  app.get('/api/product/practice-runs/:runId', async (request, reply) => {
    service.assertOwnership(productRunId(request), learnerId(request))
    reply.send(service.snapshot(productRunId(request)))
  })
  app.post('/api/product/practice-runs/:runId/pins', async (request, reply) => {
    const body = productBody(request); const runId = productRunId(request)
    service.assertOwnership(runId, learnerId(request))
    const targetType = stringField(body, 'targetType')
    if (!['artifact', 'source'].includes(targetType)) throw new LabError('invalid_request', 'targetType 必须是 artifact 或 source', 400)
    const pin = service.createPin(learnerId(request), runId, { targetType: targetType as 'artifact' | 'source', targetId: stringField(body, 'targetId') })
    reply.code(201).send(pin)
  })
  app.delete('/api/product/practice-runs/:runId/pins/:pinId', async (request, reply) => {
    const runId = productRunId(request); const pinId = String((request.params as { pinId: string }).pinId)
    service.assertOwnership(runId, learnerId(request))
    service.deletePin(learnerId(request), runId, pinId)
    reply.code(204).send()
  })
  app.get('/api/product/practice-runs/:runId/lab', async (request, reply) => {
    service.assertOwnership(productRunId(request), learnerId(request))
    reply.send(service.labAccess(productRunId(request)))
  })
  app.post('/api/product/practice-runs/:runId/reopen-lab', async (request, reply) => {
    service.assertOwnership(productRunId(request), learnerId(request))
    const result = await service.reopenLab(productRunId(request))
    reply.code(result.queue ? 202 : 201).send(result)
  })
  app.post('/api/product/practice-runs/:runId/messages', async (request, reply) => {
    const body = productBody(request); const message = stringField(body, 'message')
    service.assertOwnership(productRunId(request), learnerId(request))
    reply.send(await service.ask(productRunId(request), message, optionalString(body, 'clientRequestId') ?? undefined))
  })
  const streamTutor = async (request: FastifyRequest, reply: FastifyReply, runId: string, message: string, clientRequestId: string, retryInvocationId?: string) => {
    reply.hijack()
    reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = async (event: TutorStreamEvent) => {
      if (reply.raw.destroyed || reply.raw.writableEnded) return
      reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`)
    }
    try {
      if (retryInvocationId) await service.retryTutor(runId, retryInvocationId, send)
      else await service.streamTutor({ runId, message, clientRequestId }, send)
    } catch (error) {
      if (!(error instanceof TutorProviderError) && !reply.raw.destroyed && !reply.raw.writableEnded) {
        const message = error instanceof Error ? error.message : 'Tutor 调用失败'
        await send({ type: 'failed', invocationId: retryInvocationId ?? clientRequestId, code: 'tutor_failed', message, retryable: true })
      }
    } finally {
      if (!reply.raw.writableEnded) reply.raw.end()
    }
  }
  app.post('/api/product/practice-runs/:runId/messages/stream', async (request, reply) => {
    const body = productBody(request); const runId = productRunId(request); const message = stringField(body, 'message'); const requestId = optionalString(body, 'clientRequestId') ?? randomUUID()
    service.assertOwnership(runId, learnerId(request))
    await streamTutor(request, reply, runId, message, requestId)
  })
  app.post('/api/product/practice-runs/:runId/tutor-invocations/:invocationId/retry', async (request, reply) => {
    const runId = productRunId(request); const invocationId = String((request.params as { invocationId: string }).invocationId)
    service.assertOwnership(runId, learnerId(request))
    await streamTutor(request, reply, runId, '', randomUUID(), invocationId)
  })
  app.get('/api/product/practice-runs/:runId/tutor-invocations/:invocationId', async (request, reply) => {
    const runId = productRunId(request); const invocationId = String((request.params as { invocationId: string }).invocationId)
    service.assertOwnership(runId, learnerId(request))
    reply.send(service.getTutorInvocation(runId, invocationId))
  })
  app.post('/api/product/practice-runs/:runId/artifacts', async (request, reply) => {
    const body = productBody(request); const content = stringField(body, 'content')
    service.assertOwnership(productRunId(request), learnerId(request))
    const kind = optionalString(body, 'kind'); const sourceKind = optionalString(body, 'sourceKind')
    if (kind && !['external_text', 'source_excerpt'].includes(kind)) throw new LabError('invalid_request', '不支持的外部素材类型', 400)
    if (sourceKind && !['user', 'zhihu', 'global_search'].includes(sourceKind)) throw new LabError('invalid_request', '不支持的来源类型', 400)
    reply.code(201).send(service.addExternalArtifact(productRunId(request), { kind: kind as 'external_text' | 'source_excerpt' | undefined, sourceKind: sourceKind as 'user' | 'zhihu' | 'global_search' | undefined, content, metadata: typeof body.metadata === 'object' && body.metadata ? body.metadata as Record<string, unknown> : undefined }))
  })
  app.post('/api/product/practice-runs/:runId/lab-executions', async (request, reply) => {
    const body = productBody(request); const token = bearer(request)
    if (!token) throw new LabError('unauthorized', '缺少 Lab 访问令牌', 401)
    service.assertOwnership(productRunId(request), learnerId(request))
    const result = await service.executeLab({ runId: productRunId(request), token, revision: numberField(body, 'revision'), sessionId: stringField(body, 'sessionId'), statement: stringField(body, 'statement'), clientRequestId: stringField(body, 'clientRequestId') })
    if (result.execution.status === 'timed_out') return reply.code(504).send(result)
    if (result.execution.status === 'failed') return reply.code(422).send(result)
    return reply.send(result)
  })
  app.post('/api/product/practice-runs/:runId/verify', async (request, reply) => { service.assertOwnership(productRunId(request), learnerId(request)); reply.send(service.verify(productRunId(request))) })
  app.post('/api/product/practice-runs/:runId/note-outline', async (request, reply) => { service.assertOwnership(productRunId(request), learnerId(request)); reply.code(201).send(service.generateNoteOutline(productRunId(request))) })
  app.post('/api/product/practice-runs/:runId/article-draft', async (request, reply) => {
    service.assertOwnership(productRunId(request), learnerId(request))
    const outline = optionalString(productBody(request), 'outline')
    reply.code(201).send(service.generateArticleDraft(productRunId(request), outline ?? undefined))
  })
  if (writingService) registerWritingRoutes(app, writingService, service)
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

function registerWritingRoutes(app: FastifyInstance, service: WritingService, practiceService: PracticeService): void {
  app.post('/api/product/practice-runs/:runId/writing', async (request, reply) => { practiceService.assertOwnership(productRunId(request), learnerId(request)); reply.code(201).send(service.initialize(productRunId(request))) })
  app.get('/api/product/practice-runs/:runId/writing', async (request, reply) => { practiceService.assertOwnership(productRunId(request), learnerId(request)); reply.send(service.getExisting(productRunId(request))) })
  app.get('/api/product/practice-runs/:runId/writing/workspace', async (request, reply) => { const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.workspace(runId)) })
  app.post('/api/product/practice-runs/:runId/writing/regenerate', async (request, reply) => { const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.code(202).send(service.regenerate(runId, optionalString(productBody(request), 'clientRequestId') ?? randomUUID())) })
  app.get('/api/product/practice-runs/:runId/writing/overview', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.curationOverview(runId))
  })
  app.get('/api/product/practice-runs/:runId/writing/clusters/:clusterId', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request))
    const query = request.query as { filter?: string; cursor?: string; limit?: string }
    const limit = query.limit == null ? 30 : Number(query.limit)
    if (!Number.isInteger(limit) || limit <= 0) throw new LabError('invalid_request', 'limit 必须是正整数', 400)
    reply.send(service.curationDetail(runId, String((request.params as { clusterId: string }).clusterId), query.filter, query.cursor, limit))
  })
  app.patch('/api/product/practice-runs/:runId/writing/clusters/:clusterId', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); const body = productBody(request)
    const status = stringField(body, 'status')
    if (!['pending', 'accepted', 'rejected'].includes(status)) throw new LabError('invalid_request', 'status 必须是 pending、accepted 或 rejected', 400)
    const note = body.userNote == null ? undefined : optionalString(body, 'userNote')
    reply.send(service.updateCuration(runId, String((request.params as { clusterId: string }).clusterId), numberField(body, 'revision'), status as 'pending' | 'accepted' | 'rejected', note))
  })
  app.post('/api/product/practice-runs/:runId/writing/curation/refresh', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.refreshCuration(runId))
  })
  app.post('/api/product/practice-runs/:runId/writing/curation/replay', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.replayCuration(runId))
  })
  app.patch('/api/product/practice-runs/:runId/writing/materials/:materialId', async (request, reply) => {
    practiceService.assertOwnership(productRunId(request), learnerId(request))
    const body = productBody(request); const selected = body.selected
    if (typeof selected !== 'boolean') throw new LabError('invalid_request', 'selected 必须是布尔值', 400)
    const note = body.editorialNote == null ? undefined : optionalString(body, 'editorialNote')
    reply.send(service.selectMaterial(productRunId(request), String((request.params as { materialId: string }).materialId), selected, note))
  })
  app.post('/api/product/practice-runs/:runId/writing/outline', async (request, reply) => { practiceService.assertOwnership(productRunId(request), learnerId(request)); reply.code(201).send(service.generateOutline(productRunId(request))) })
  app.post('/api/product/practice-runs/:runId/writing/article', async (request, reply) => { practiceService.assertOwnership(productRunId(request), learnerId(request)); reply.code(201).send(service.generateArticle(productRunId(request))) })
  app.post('/api/product/practice-runs/:runId/writing/generations', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); const body = productBody(request); const kind = stringField(body, 'kind')
    if (!['outline', 'article'].includes(kind)) throw new LabError('invalid_request', 'kind 必须是 outline 或 article', 400)
    const clientRequestId = optionalString(body, 'clientRequestId') ?? randomUUID()
    reply.code(202).send(service.startGeneration(runId, kind as 'outline' | 'article', clientRequestId))
  })
  app.get('/api/product/practice-runs/:runId/writing/generation-jobs/:jobId', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); const jobId = String((request.params as { jobId: string }).jobId)
    reply.send(service.getGenerationJob(runId, jobId))
  })
  app.post('/api/product/practice-runs/:runId/writing/generation-jobs/:jobId/retry', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); const job = service.getGenerationJob(runId, String((request.params as { jobId: string }).jobId))
    reply.code(202).send(service.startGeneration(runId, job.kind as 'outline' | 'article', job.clientRequestId ?? randomUUID(), true))
  })
  app.get('/api/product/practice-runs/:runId/writing/draft-runs/:draftId', async (request, reply) => { const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.getDraft(runId, String((request.params as { draftId: string }).draftId))) })
  app.post('/api/product/practice-runs/:runId/writing/draft-runs/:draftId/retry', async (request, reply) => { const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.code(202).send(service.retryDraft(runId, String((request.params as { draftId: string }).draftId))) })
  app.post('/api/product/practice-runs/:runId/writing/documents/:documentId/confirm', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.confirmOutline(runId, String((request.params as { documentId: string }).documentId)))
  })
  app.post('/api/product/practice-runs/:runId/writing/review', async (request, reply) => { practiceService.assertOwnership(productRunId(request), learnerId(request)); reply.send(service.review(productRunId(request))) })
  app.patch('/api/product/practice-runs/:runId/writing/documents/:documentId/sections/:sectionId', async (request, reply) => {
    practiceService.assertOwnership(productRunId(request), learnerId(request))
    const body = productBody(request)
    if (typeof body.content !== 'string') throw new LabError('invalid_request', 'content 必须是字符串', 400)
    const revision = numberField(body, 'revision')
    reply.send(service.editSection(productRunId(request), String((request.params as { documentId: string }).documentId), String((request.params as { sectionId: string }).sectionId), revision, body.content))
  })
  app.patch('/api/product/practice-runs/:runId/writing/documents/:documentId/blocks/:blockId', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); const body = productBody(request)
    if (typeof body.content !== 'string') throw new LabError('invalid_request', 'content 必须是字符串', 400)
    reply.send(service.editBlock(runId, String((request.params as { documentId: string }).documentId), String((request.params as { blockId: string }).blockId), numberField(body, 'revision'), body.content))
  })
  app.get('/api/product/practice-runs/:runId/writing/documents/:documentId/blocks/:blockId/evidence', async (request, reply) => {
    const runId = productRunId(request); practiceService.assertOwnership(runId, learnerId(request)); reply.send(service.blockEvidence(runId, String((request.params as { documentId: string }).documentId), String((request.params as { blockId: string }).blockId)))
  })
}
