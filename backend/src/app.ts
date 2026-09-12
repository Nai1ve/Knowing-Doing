import { randomUUID } from 'node:crypto'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import cors from '@fastify/cors'
import multipart from '@fastify/multipart'
import type { LabConfig } from './config.js'
import { errorResponse, LabError } from './errors.js'
import { MySqlLabStore, type LabStore } from './mysql-store.js'
import { LabScheduler } from './scheduler.js'
import { verifyLabToken } from './token.js'
import { PracticeService, ProductNotFoundError, type TutorStreamEvent } from './practice-service.js'
import { TutorProviderError } from './tutor.js'
import { WritingConflictError, WritingNotFoundError, WritingService } from './writing-service.js'
import { PlanningService } from './planning.js'
import { AgentPlanningService, PlanningAgentError, type PlanningStreamEvent } from './agent-planning.js'
import { CaseWorkspaceService } from './case-workspace-service.js'
import { MySqlDynamicCaseService } from './mysql-dynamic-case-service.js'
import { EnvironmentBuildOrchestrator } from './gym-build-service.js'

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
  agentPlanningServiceFactory?: () => AgentPlanningService
  caseWorkspaceServiceFactory?: () => CaseWorkspaceService
  mysqlDynamicCaseServiceFactory?: (scheduler: LabScheduler) => MySqlDynamicCaseService
  gymBuildServiceFactory?: (workspace: CaseWorkspaceService, mysql: MySqlDynamicCaseService) => EnvironmentBuildOrchestrator
  runtimeStatus?: () => Promise<Record<string, unknown>>
}

export function buildApp(dependencies: AppDependencies): { app: FastifyInstance; scheduler: LabScheduler } {
  const store = dependencies.store ?? new MySqlLabStore(dependencies.config)
  const scheduler = new LabScheduler(store, dependencies.config)
  const app = Fastify({ logger: false })

  app.addHook('onRequest', async (request) => {
    if (dependencies.config.identityMode === 'shared_demo') request.headers['x-learner-id'] = dependencies.config.demoLearnerId
  })

  void app.register(multipart, { limits: { files: 1, fields: 0, fileSize: dependencies.config.resumeMaxBytes } })
  void app.register(cors, { origin: dependencies.config.corsOrigin, methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'] })
  app.setErrorHandler((error, _request, reply) => {
    if (process.env.NODE_ENV !== 'production') console.error('[zhixing-api]', error instanceof Error ? `${error.name}: ${error.message}` : error)
    if (error instanceof ProductNotFoundError || error instanceof WritingNotFoundError) return reply.code(404).send({ error: { code: 'not_found', message: error.message, retryable: false } })
    if (error instanceof WritingConflictError) return reply.code(409).send({ error: { code: 'writing_conflict', message: error.message, retryable: false } })
    if (error instanceof TutorProviderError) return reply.code(error.statusCode ?? 503).send({ error: { code: error.code, message: error.message, retryable: error.retryable } })
    if (error instanceof PlanningAgentError) return reply.code(error.retryable ? 503 : 503).send({ error: { code: error.code, message: error.message, retryable: error.retryable } })
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'FST_REQ_FILE_TOO_LARGE') return reply.code(422).send({ error: { code: 'resume_too_large', message: `简历不能超过 ${Math.floor(dependencies.config.resumeMaxBytes / 1024 / 1024)} MB`, retryable: false } })
    if (error && typeof error === 'object' && 'code' in error && (error as { code?: unknown }).code === 'FST_ERR_CTP_EMPTY_JSON_BODY') return reply.code(400).send({ error: { code: 'invalid_request', message: '请求体不能为空', retryable: false } })
    const response = errorResponse(error)
    reply.code(response.statusCode).send(response.body)
  })

  app.get('/api/product/runtime-status', async (_request, reply) => {
    reply.send(await dependencies.runtimeStatus?.() ?? { model: { configured: Boolean(dependencies.config.modelBaseUrl && dependencies.config.modelApiKey), name: dependencies.config.modelName }, zhihu: { configured: false, executable: false, lastRetrieval: null } })
  })

  const caseWorkspaceService = dependencies.caseWorkspaceServiceFactory?.()
  const mysqlDynamicCaseService = dependencies.mysqlDynamicCaseServiceFactory?.(scheduler)
  const planningService = dependencies.planningServiceFactory?.()
  if (planningService && mysqlDynamicCaseService) planningService.setDynamicRuntimeChecker((practice) => mysqlDynamicCaseService.runtimeStatusForPractice(practice))
  if (dependencies.practiceServiceFactory) registerProductRoutes(app, dependencies.practiceServiceFactory(scheduler), dependencies.writingServiceFactory?.(), mysqlDynamicCaseService)
  if (planningService && dependencies.agentPlanningServiceFactory) registerPlanningRoutes(app, planningService, dependencies.agentPlanningServiceFactory())
  if (caseWorkspaceService) registerCaseWorkspaceRoutes(app, caseWorkspaceService)
  if (caseWorkspaceService && mysqlDynamicCaseService && dependencies.gymBuildServiceFactory) {
    const gymBuildService = dependencies.gymBuildServiceFactory(caseWorkspaceService, mysqlDynamicCaseService)
    registerGymBuildRoutes(app, gymBuildService)
    void gymBuildService.resume().catch((error) => console.error('[zhixing-gym] resume_unhandled', { error: error instanceof Error ? error.message : String(error) }))
  }

  return { app, scheduler }
}

function registerPlanningRoutes(app: FastifyInstance, service: PlanningService, agent: AgentPlanningService): void {
  app.get('/api/product/planning-sessions/:sessionId', async (request, reply) => {
    const id = String((request.params as { sessionId: string }).sessionId)
    if (!agent.isAgentSession(learnerId(request), id)) throw new LabError('planning_not_found', '规划对话不存在', 404)
    reply.send(agent.getSession(learnerId(request), id))
  })
  app.post('/api/product/planning-sessions/:sessionId/resume', async (request, reply) => {
    const sessionId = String((request.params as { sessionId: string }).sessionId)
    const file = await request.file()
    if (!file || file.fieldname !== 'resume') throw new LabError('resume_required', '请选择 PDF 格式的简历', 422)
    const learner = learnerId(request)
    if (!agent.isAgentSession(learner, sessionId)) throw new LabError('planning_not_found', '规划对话不存在', 404)
    const requestId = request.headers['x-client-request-id']
    const attachment = await service.uploadResume(learner, sessionId, { filename: file.filename, mimetype: file.mimetype, file: file.file, clientRequestId: typeof requestId === 'string' ? requestId : undefined })
    await agent.attachResume(learner, sessionId)
    reply.code(201).send(attachment)
  })
  app.get('/api/product/roadmap-drafts/:roadmapId', async (request, reply) => {
    const learner = learnerId(request); const id = String((request.params as { roadmapId: string }).roadmapId)
    if (!agent.isAgentRoadmap(learner, id)) throw new LabError('roadmap_not_found', '路线草案不存在', 404)
    reply.send(service.getDraftForLearner(learner, id))
  })
  app.post('/api/product/roadmap-drafts/:roadmapId/confirm', async (request, reply) => {
    const id = String((request.params as { roadmapId: string }).roadmapId); const learner = learnerId(request)
    if (!agent.isAgentRoadmap(learner, id)) throw new LabError('roadmap_not_found', '路线草案不存在', 404)
    const body = productBody(request); const snapshot = service.getDraftForLearner(learner, id); const plan = service.confirm(learner, id, numberField(body, 'revision'), optionalString(body, 'startUnitKey') ?? undefined); agent.markRoadmapConfirmed(learner, snapshot.planningSessionId); return reply.send(plan)
  })
  app.get('/api/product/roadmaps/current', async (request, reply) => {
    reply.send(service.current(learnerId(request)))
  })
  app.get('/api/product/roadmaps/:roadmapId/tree', async (request, reply) => {
    const params = request.params as { roadmapId: string }
    const query = request.query as { depth?: string; focusNodeId?: string }
    const depth = query.depth == null ? 2 : Number(query.depth)
    reply.send(service.tree(learnerId(request), params.roadmapId, { depth, focusNodeId: query.focusNodeId || null }))
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

  if (agent) registerAgentPlanningRoutes(app, agent, service)
}

function registerAgentPlanningRoutes(app: FastifyInstance, service: AgentPlanningService, planningService: PlanningService): void {
  const stream = async (request: FastifyRequest, reply: FastifyReply, action: (send: (event: PlanningStreamEvent) => Promise<void>) => Promise<void>) => {
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' })
    const send = async (event: PlanningStreamEvent) => { if (!reply.raw.destroyed && !reply.raw.writableEnded) reply.raw.write(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`) }
    try { await action(send) } catch (error) { if (!reply.raw.destroyed && !reply.raw.writableEnded) await send({ type: 'failed', invocationId: 'unknown', code: error instanceof Error ? error.name : 'planning_failed', message: error instanceof Error ? error.message : '规划调用失败', retryable: true }) } finally { if (!reply.raw.writableEnded) reply.raw.end() }
  }
  app.post('/api/product/planning-sessions/agent', async (request, reply) => {
    const body = productBody(request)
    reply.code(201).send(service.createSession(learnerId(request), { message: stringField(body, 'message'), clientRequestId: optionalString(body, 'clientRequestId') ?? randomUUID() }))
  })
  app.get('/api/product/planning-sessions/:sessionId/diagnostic', async (request, reply) => {
    reply.send(service.phasedStatus(learnerId(request), String((request.params as { sessionId: string }).sessionId)))
  })
  app.get('/api/product/planning-sessions/:sessionId/diagnostic/events', async (request, reply) => {
    const sessionId = String((request.params as { sessionId: string }).sessionId); const status = service.phasedStatus(learnerId(request), sessionId)
    reply.hijack(); reply.raw.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' }); reply.raw.write(`event: planning_stage\ndata: ${JSON.stringify({ type: 'planning_stage', sessionId, stage: status.stage, readiness: status.readiness })}\n\n`); reply.raw.write(`event: planning_status\ndata: ${JSON.stringify(status)}\n\n`); reply.raw.end()
  })
  app.post('/api/product/planning-sessions/:sessionId/assessments', async (request, reply) => {
    const body = productBody(request); const sessionId = String((request.params as { sessionId: string }).sessionId); reply.code(201).send(await service.prepareAssessment(learnerId(request), sessionId, optionalString(body, 'clientRequestId') ?? randomUUID()))
  })
  app.post('/api/product/planning-sessions/:sessionId/assessments/:assessmentId/answers', async (request, reply) => {
    const body = productBody(request); const answers = body.answers; if (!Array.isArray(answers)) throw new LabError('invalid_request', 'answers 必须是数组', 400); reply.send(service.submitAssessmentAnswers(learnerId(request), String((request.params as { sessionId: string }).sessionId), String((request.params as { assessmentId: string }).assessmentId), answers as Array<{ questionId: string; value: unknown }>, optionalString(body, 'clientRequestId') ?? randomUUID()))
  })
  app.post('/api/product/planning-sessions/:sessionId/assessments/:assessmentId/finalize', async (request, reply) => {
    const body = productBody(request); const action = body.action === 'abandon' ? 'abandon' : body.action === 'complete' ? 'complete' : (() => { throw new LabError('invalid_request', 'action 必须是 complete 或 abandon', 400) })(); reply.send(await service.finalizeAssessment(learnerId(request), String((request.params as { sessionId: string }).sessionId), String((request.params as { assessmentId: string }).assessmentId), action, optionalString(body, 'clientRequestId') ?? randomUUID()))
  })
  app.post('/api/product/planning-sessions/:sessionId/requirements/messages', async (request, reply) => {
    const body = productBody(request); reply.code(201).send(await service.addRequirementsMessage(learnerId(request), String((request.params as { sessionId: string }).sessionId), stringField(body, 'message'), optionalString(body, 'clientRequestId') ?? randomUUID()))
  })
  app.patch('/api/product/planning-sessions/:sessionId/requirements/:briefId', async (request, reply) => {
    const body = productBody(request); reply.send(service.updateRequirementBrief(learnerId(request), String((request.params as { sessionId: string }).sessionId), String((request.params as { briefId: string }).briefId), body.content))
  })
  app.post('/api/product/planning-sessions/:sessionId/requirements/:briefId/confirm', async (request, reply) => {
    reply.send(service.confirmRequirementBrief(learnerId(request), String((request.params as { sessionId: string }).sessionId), String((request.params as { briefId: string }).briefId)))
  })
  app.post('/api/product/planning-sessions/stream', async (request, reply) => { const body = productBody(request); const message = stringField(body, 'message'); const requestId = optionalString(body, 'clientRequestId') ?? randomUUID(); await stream(request, reply, (send) => service.createAndStream(learnerId(request), message, requestId, send)) })
  app.get('/api/product/planning/state', async (request, reply) => reply.send(service.planningState(learnerId(request))))
  app.post('/api/product/planning-sessions/:sessionId/messages/stream', async (request, reply) => { const body = productBody(request); const sessionId = String((request.params as { sessionId: string }).sessionId); const message = stringField(body, 'message'); const requestId = optionalString(body, 'clientRequestId') ?? randomUUID(); await stream(request, reply, (send) => service.streamMessage(learnerId(request), sessionId, message, requestId, send)) })
  app.post('/api/product/planning-invocations/:invocationId/retry', async (request, reply) => { const invocationId = String((request.params as { invocationId: string }).invocationId); await stream(request, reply, (send) => service.retryInvocation(learnerId(request), invocationId, send)) })
  app.post('/api/product/planning-sessions/:sessionId/roadmap-generations', async (request, reply) => { const body = productBody(request); const result = await service.generateRoadmap(learnerId(request), String((request.params as { sessionId: string }).sessionId), optionalString(body, 'clientRequestId') ?? randomUUID(), false, true); reply.code(202).send(result) })
  app.get('/api/product/roadmap-generation-runs/:id', async (request, reply) => reply.send(service.getRoadmapGeneration(learnerId(request), String((request.params as { id: string }).id))))
  app.post('/api/product/roadmap-generation-runs/:id/retry', async (request, reply) => { const id = String((request.params as { id: string }).id); reply.code(202).send(await service.retryRoadmap(learnerId(request), id)) })
  app.post('/api/product/plans/:planId/adjustments', async (request, reply) => { const body = productBody(request); const params = request.params as { planId: string }; reply.code(201).send(await service.createPlanAdjustment(learnerId(request), params.planId, stringField(body, 'request'), optionalString(body, 'clientRequestId') ?? randomUUID())) })
  app.get('/api/product/plan-adjustments/:id', async (request, reply) => reply.send(service.getPlanAdjustment(learnerId(request), String((request.params as { id: string }).id))))
  app.post('/api/product/plan-adjustments/:id/confirm', async (request, reply) => reply.send(service.confirmPlanAdjustment(learnerId(request), String((request.params as { id: string }).id))))
  app.post('/api/product/roadmaps/:roadmapId/nodes/:nodeId/knowledge-route', async (request, reply) => { const params = request.params as { roadmapId: string; nodeId: string }; const refresh = Boolean((productBody(request) as { refresh?: unknown }).refresh); reply.send(await service.knowledgeRoute(learnerId(request), params.roadmapId, params.nodeId, refresh)) })
  app.get('/api/product/roadmaps/:roadmapId/nodes/:nodeId/knowledge-route', async (request, reply) => { const params = request.params as { roadmapId: string; nodeId: string }; reply.send(await service.knowledgeRoute(learnerId(request), params.roadmapId, params.nodeId)) })
  app.post('/api/product/knowledge-routes/:routeSetId/feedback', async (request, reply) => { const body = productBody(request); const feedback = stringField(body, 'feedback'); if (!['read', 'too_hard', 'too_easy', 'irrelevant', 'helpful'].includes(feedback)) throw new LabError('invalid_request', '反馈类型不受支持', 400); service.feedback(learnerId(request), String((request.params as { routeSetId: string }).routeSetId), stringField(body, 'sourceItemId'), feedback as 'read' | 'too_hard' | 'too_easy' | 'irrelevant' | 'helpful'); reply.code(204).send() })
}

function learnerId(request: FastifyRequest): string {
  const value = request.headers['x-learner-id']
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, 120) : 'anonymous-web'
}

function workspaceId(request: FastifyRequest): string { return String((request.params as { workspaceRunId: string }).workspaceRunId) }

function registerCaseWorkspaceRoutes(app: FastifyInstance, service: CaseWorkspaceService): void {
  app.post('/api/product/roadmap-nodes/:nodeId/case-requests', async (request, reply) => {
    const body = productBody(request); const params = request.params as { nodeId: string }
    reply.code(202).send(service.createCaseRequest(learnerId(request), { ...body, roadmapNodeId: params.nodeId }))
  })
  app.get('/api/product/case-generation-jobs/:jobId', async (request, reply) => {
    reply.send(service.getCaseGenerationJob(learnerId(request), String((request.params as { jobId: string }).jobId)))
  })
  app.post('/api/product/case-generation-jobs/:jobId/retry', async (request, reply) => {
    reply.code(202).send(service.retryCaseGeneration(learnerId(request), String((request.params as { jobId: string }).jobId)))
  })
  app.get('/api/product/learning-cases/:caseId', async (request, reply) => {
    reply.send(service.getLearningCase(learnerId(request), String((request.params as { caseId: string }).caseId)))
  })
  app.post('/api/product/learning-cases/:caseId/practice', async (request, reply) => {
    reply.code(201).send(await service.startPractice(learnerId(request), String((request.params as { caseId: string }).caseId)))
  })
  app.get('/api/product/workspace-runs/:workspaceRunId', async (request, reply) => reply.send(service.getWorkspace(learnerId(request), workspaceId(request))))
  app.get('/api/product/workspace-runs/:workspaceRunId/completion', async (request, reply) => reply.send(service.getCompletion(learnerId(request), workspaceId(request))))
  app.post('/api/product/workspace-runs/:workspaceRunId/completion/recheck', async (request, reply) => reply.send(service.recheckCompletion(learnerId(request), workspaceId(request))))
  app.get('/api/product/workspace-runs/:workspaceRunId/tutor-history', async (request, reply) => reply.send(service.getTutorHistory(learnerId(request), workspaceId(request))))
  app.get('/api/product/workspace-runs/:workspaceRunId/files/:path', async (request, reply) => {
    const params = request.params as { workspaceRunId: string; path: string }
    reply.send(service.getFile(learnerId(request), params.workspaceRunId, params.path))
  })
  app.patch('/api/product/workspace-runs/:workspaceRunId/files/:path', async (request, reply) => {
    const body = productBody(request); const params = request.params as { workspaceRunId: string; path: string }
    reply.send(await service.saveFile(learnerId(request), params.workspaceRunId, params.path, stringField(body, 'content'), numberField(body, 'expectedRevision')))
  })
  app.post('/api/product/workspace-runs/:workspaceRunId/executions', async (request, reply) => {
    const body = productBody(request); const result = await service.execute(learnerId(request), workspaceId(request), stringField(body, 'command'), stringField(body, 'clientRequestId'))
    if (result.execution.status === 'timed_out') return reply.code(504).send(result)
    if (result.execution.status === 'failed' || result.execution.status === 'rejected') return reply.code(422).send(result)
    reply.send(result)
  })
  app.post('/api/product/workspace-runs/:workspaceRunId/reset', async (request, reply) => reply.send(await service.reset(learnerId(request), workspaceId(request))))
  app.post('/api/product/workspace-runs/:workspaceRunId/end', async (request, reply) => reply.send(await service.end(learnerId(request), workspaceId(request))))
}

function registerGymBuildRoutes(app: FastifyInstance, service: EnvironmentBuildOrchestrator): void {
  app.post('/api/product/plans/:planId/units/:planUnitId/gym-builds', async (request, reply) => {
    const params = request.params as { planId: string; planUnitId: string }
    const body = productBody(request)
    reply.code(202).send(service.create(learnerId(request), params.planId, params.planUnitId, optionalString(body, 'clientRequestId') ?? randomUUID()))
  })
  app.get('/api/product/gym-builds/:id', async (request, reply) => reply.send(service.get(learnerId(request), String((request.params as { id: string }).id))))
  app.get('/api/product/gym-builds/:id/events', async (request, reply) => {
    const query = request.query as { afterSequence?: string }
    const afterSequence = query.afterSequence == null ? 0 : Number(query.afterSequence)
    if (!Number.isInteger(afterSequence) || afterSequence < 0) throw new LabError('invalid_request', 'afterSequence 必须是非负整数', 400)
    reply.send(service.events(learnerId(request), String((request.params as { id: string }).id), afterSequence))
  })
  app.post('/api/product/gym-builds/:id/retry', async (request, reply) => reply.code(202).send(service.retry(learnerId(request), String((request.params as { id: string }).id))))
  app.post('/api/product/gym-builds/:id/start', async (request, reply) => {
    const result = await service.start(learnerId(request), String((request.params as { id: string }).id))
    const queued = Boolean(result && typeof result === 'object' && 'queue' in result && result.queue)
    return reply.code(queued ? 202 : 201).send(result)
  })
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

function registerProductRoutes(app: FastifyInstance, service: PracticeService, writingService?: WritingService, mysqlDynamicCaseService?: MySqlDynamicCaseService): void {
  app.get('/api/product/plans/:planId', async (request, reply) => {
    reply.send(service.getPlan(learnerId(request), String((request.params as { planId: string }).planId)))
  })

  app.post('/api/product/plans/:planId/units/:unitId/practice', async (request, reply) => {
    const params = request.params as { planId: string; unitId: string }
    const plan = service.getPlan(learnerId(request), params.planId)
    const unit = plan.units.find((candidate) => candidate.id === params.unitId)
    if (mysqlDynamicCaseService && unit?.learningMode === 'lab' && unit.learningCaseId) {
      const result = await mysqlDynamicCaseService.startPractice(learnerId(request), unit.learningCaseId, unit.id)
      return reply.code(result.queue ? 202 : 201).send(result)
    }
    throw new LabError('gym_build_required', '当前学习单元需要先完成动态 Gym 构建', 409, true)
  })
  if (mysqlDynamicCaseService) {
    app.get('/api/product/practice-runs/:runId/runtime', async (request, reply) => {
      reply.send(await mysqlDynamicCaseService.runtime(learnerId(request), String((request.params as { runId: string }).runId)))
    })
    app.post('/api/product/practice-runs/:runId/runtime/sessions', async (request, reply) => {
      const body = productBody(request)
      reply.code(201).send(await mysqlDynamicCaseService.openSession(learnerId(request), productRunId(request), optionalString(body, 'name') ?? 'default'))
    })
    app.post('/api/product/practice-runs/:runId/runtime/reset', async (request, reply) => {
      reply.send(await mysqlDynamicCaseService.resetPractice(learnerId(request), productRunId(request), numberField(productBody(request), 'revision')))
    })
    app.post('/api/product/practice-runs/:runId/runtime/end', async (request, reply) => {
      await mysqlDynamicCaseService.endPractice(learnerId(request), productRunId(request))
      reply.code(204).send()
    })
    app.post('/api/product/practice-runs/:runId/runtime/restart', async (request, reply) => {
      const result = await mysqlDynamicCaseService.restartPractice(learnerId(request), productRunId(request))
      reply.code(result.queue ? 202 : 201).send(result)
    })
  }

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
