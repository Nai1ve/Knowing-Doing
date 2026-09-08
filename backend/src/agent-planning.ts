import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { LabError } from './errors.js'
import { ProductRepository } from './product-repository.js'
import type { LabConfig } from './config.js'
import type { SourceItem } from './product-types.js'
import { PlanningContextCompiler, type PlanningContextPacket } from './planning-context.js'
import { ZhihuOpenApiClient, ZhihuOpenApiError } from './zhihu-openapi.js'

type Row = Record<string, unknown>
type SendEvent = (event: PlanningStreamEvent) => Promise<void> | void

const REQUIRED_TOPICS = [
  ['goal_deadline', '目标与期限', 1],
  ['projects', '真实项目经历', 2],
  ['responsibility', '实际职责与决策范围', 3],
  ['strengths_gaps', '当前强弱项', 4],
  ['time_constraints', '每周投入与约束', 5],
  ['outcome', '预期产出', 6],
] as const

const ProfileDeltaSchema = z.object({
  coveredTopics: z.array(z.string()).default([]),
  dimensions: z.array(z.object({
    key: z.string().min(1), level: z.enum(['unknown', 'exposed', 'applied', 'independent', 'advanced']), confidence: z.number().min(0).max(1), summary: z.string(), nextValidation: z.string(),
  })).default([]),
  evidence: z.array(z.object({ topicKey: z.string().nullable().optional(), sourceType: z.enum(['user_message', 'resume', 'reading', 'concept', 'lab']), sourceId: z.string(), excerpt: z.string() })).default([]),
  followUpTopic: z.string().nullable().optional(),
})

const RoadmapNodeDraftSchema = z.object({
  key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
  parentKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/).nullable(),
  type: z.enum(['domain', 'capability', 'concept', 'lab', 'project']),
  title: z.string().min(1).max(120),
  summary: z.string().min(1).max(500),
  points: z.array(z.string().min(1).max(100)).max(8).default([]),
  standard: z.string().min(1).max(500),
  minutes: z.number().int().positive().max(600),
  priority: z.number().int().positive().max(100),
  mode: z.enum(['knowledge', 'lab', 'unavailable']),
  caseIntent: z.string().nullable().default(null),
  contextKeys: z.array(z.string()).max(8).default([]),
})
const RoadmapPlanSchema = z.object({
  nodes: z.array(RoadmapNodeDraftSchema).min(1).max(80),
  unitKeys: z.array(z.string()).min(1).max(12),
  dependencies: z.array(z.object({ nodeKey: z.string(), dependsOnKey: z.string() })).max(80).default([]),
})
type RoadmapPlan = z.infer<typeof RoadmapPlanSchema>
type RoadmapPhase = 'domain' | 'module' | 'unit' | 'critic'
type RoadmapPhaseEvent = { phase: RoadmapPhase; status: 'started' | 'succeeded'; output?: unknown }
type RoadmapPhaseCallback = (event: RoadmapPhaseEvent) => Promise<void> | void
export type ProfileDelta = z.infer<typeof ProfileDeltaSchema>

export type PlanningStreamEvent =
  | { type: 'accepted'; invocationId: string; sessionId: string }
  | { type: 'assistant_delta'; invocationId: string; delta: string }
  | { type: 'profile_updated'; invocationId: string; profileSnapshotId: string; coveredTopics: string[]; pendingTopics: string[]; dimensions: ProfileDelta['dimensions'] }
  | { type: 'roadmap_readiness'; invocationId: string; readiness: 'ready'; coveredTopicCount: number; pendingTopicCount: number }
  | { type: 'next_question'; invocationId: string; question: string; topicKey: string | null; canGenerateRoadmap: boolean }
  | { type: 'completed'; invocationId: string; session: AgentPlanningSession }
  | { type: 'failed'; invocationId: string; code: string; message: string; retryable: boolean }

export interface AgentPlanningMessage { id: string; sequence: number; role: 'user' | 'assistant' | 'system'; content: string; metadata: Record<string, unknown>; createdAt: string }
export interface AgentPlanningTopic { key: string; label: string; priority: number; status: 'unknown' | 'covered' | 'needs_follow_up'; evidenceRefs: string[] }
export interface AgentProfileDimension { key: string; level: ProfileDelta['dimensions'][number]['level']; confidence: number; summary: string; nextValidation: string }
export interface AgentProfile { id: string; version: number; summary: Record<string, unknown>; dimensions: AgentProfileDimension[]; evidence: Array<{ id: string; topicKey: string | null; sourceType: string; sourceId: string; excerpt: string; createdAt: string }> }
export interface AgentRoadmapGeneration { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'; phase: RoadmapPhase | 'completed' | 'failed'; attemptCount: number; roadmapId: string | null; failureCode: string | null; failureMessage: string | null; updatedAt: string }
export interface AgentPlanningSession { id: string; learnerId: string; goal: string; status: string; mode: 'agent'; agentStatus: string; revision: number; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; profile: AgentProfile | null; resume: unknown; roadmapId: string | null; roadmapGeneration: AgentRoadmapGeneration | null; createdAt: string; updatedAt: string }
export interface AgentPlanningState {
  session: { id: string; goal: string; status: string; agentStatus: string; revision: number; roadmapId: string | null; updatedAt: string } | null
  generation: AgentRoadmapGeneration | null
  currentPlan: { id: string; title: string; goal: string; status: string; planState: string; roadmapId: string | null } | null
}

export interface PlanningProvider {
  readonly providerName: string
  readonly modelName: string
  stream(input: { goal: string; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; resumeText?: string | null; context?: PlanningContextPacket | null }, onDelta: (delta: string) => Promise<void> | void): Promise<string>
  interpret(input: { userMessage: string; assistantMessage: string; messages: AgentPlanningMessage[]; resumeText?: string | null; context?: PlanningContextPacket | null }): Promise<ProfileDelta>
  generateRoadmap?(input: { goal: string; messages: AgentPlanningMessage[]; context: PlanningContextPacket | null; onPhase: RoadmapPhaseCallback }): Promise<RoadmapPlan>
}

export class PlanningAgentError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true, public readonly details: Record<string, unknown> = {}) { super(message); this.name = 'PlanningAgentError' }
}

function contentFrom(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown } }> }).choices?.[0]
  const value = choice?.message?.content ?? choice?.delta?.content
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('')
  return ''
}

function stripThinking(value: string): string { return value.replace(/<think(?:ing)?>([\s\S]*?)<\/(?:think|thinking)>/gi, '').replace(/<\|(?:thinking|reasoning)[\s\S]*?<\|end(?:thinking|reasoning)\|>/gi, '') }
function fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function number(row: Row, key: string): number { return Number(row[key]) }
function json<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }
function resumeText(db: Database.Database, sessionId: string): string | null { const row = db.prepare('SELECT extracted_text FROM planning_resume_attachments WHERE planning_session_id = ? ORDER BY updated_at DESC LIMIT 1').get(sessionId) as Row | undefined; return row?.extracted_text == null ? null : String(row.extracted_text) }
function generationFrom(row: Row | undefined): AgentRoadmapGeneration | null {
  if (!row) return null
  return { id: text(row, 'id'), status: text(row, 'status') as AgentRoadmapGeneration['status'], phase: text(row, 'phase') as AgentRoadmapGeneration['phase'], attemptCount: number(row, 'attempt_count'), roadmapId: nullable(row, 'roadmap_id'), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), updatedAt: text(row, 'updated_at') }
}

const ROADMAP_JSON_CONTRACT = JSON.stringify({
  nodes: [{ key: 'domain-key', parentKey: null, type: 'domain', title: '能力域', summary: '说明当前能力域与目标的关系', points: ['关键点'], standard: '可观察的完成标准', minutes: 120, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: ['goal'] }],
  unitKeys: ['domain-key'],
  dependencies: [{ nodeKey: 'child-key', dependsOnKey: 'domain-key' }],
})

export class DeepSeekPlanningAgent implements PlanningProvider {
  readonly providerName = 'deepseek'
  readonly modelName: string
  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) { this.modelName = config.modelName }

  private async call(body: Record<string, unknown>): Promise<Response> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new PlanningAgentError('model_not_configured', '规划模型尚未配置', false)
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` }, body: JSON.stringify({ model: this.config.modelName, thinking: { type: 'disabled' }, ...body }) })
      if (!response.ok) throw new PlanningAgentError(`model_http_${response.status}`, `规划模型返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429)
      return response
    } catch (error) {
      if (error instanceof PlanningAgentError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new PlanningAgentError('model_timeout', '规划模型请求超时')
      throw new PlanningAgentError('model_request_failed', '规划模型请求失败')
    } finally { clearTimeout(timer) }
  }

  async stream(input: { goal: string; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; resumeText?: string | null; context?: PlanningContextPacket | null }, onDelta: (delta: string) => Promise<void> | void): Promise<string> {
    const conversation = input.messages.slice(-8).map((message) => ({ role: message.role, content: message.content }))
    const response = await this.call({ stream: true, temperature: 0.35, messages: [
      { role: 'system', content: '你是知行 Planner。用自然中文与用户讨论学习目标、经历、职责、能力、时间和产出。每次只提出一个最有价值的追问，也可以确认目前共识。不要展示思维过程、不要输出 JSON、不要假装已经理解用户未说过的内容。用户可以随时要求生成路线，未覆盖的信息只标记为待验证。' },
      ...(input.context ? [{ role: 'system' as const, content: `这是当前已编译的规划上下文，只能把 explicitFacts 视为用户明确提供的信息，hypotheses 必须继续验证：${JSON.stringify(input.context)}` }] : []),
      ...conversation,
      { role: 'user', content: JSON.stringify({ goal: input.goal, requiredTopics: input.requiredTopics.map((topic) => ({ key: topic.key, label: topic.label, status: topic.status })), resume: input.context ? undefined : input.resumeText ? input.resumeText.slice(0, 12000) : null }) },
    ] })
    let result = ''
    if (response.body && response.headers.get('content-type')?.toLowerCase().includes('text/event-stream')) {
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const part = await reader.read(); if (part.done) break; buffer += decoder.decode(part.value, { stream: true })
        const lines = buffer.split(/\r?\n/); buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.startsWith('data:')) continue
          const raw = line.slice(5).trim(); if (!raw || raw === '[DONE]') continue
          try { const delta = stripThinking(contentFrom(JSON.parse(raw))); if (delta) { result += delta; await onDelta(delta) } } catch { /* ignore incomplete provider frames */ }
        }
      }
    } else {
      const value = stripThinking(contentFrom(await response.json())); if (value) { result = value; await onDelta(value) }
    }
    if (!result.trim()) throw new PlanningAgentError('model_empty_output', '规划模型没有返回内容')
    return result.trim()
  }

  private async structured(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<{ value: unknown; raw: string; parseError?: string }> {
    const response = await this.call({ stream: false, temperature: 0.1, response_format: { type: 'json_object' }, messages })
    const raw = stripThinking(contentFrom(await response.json()).replace(/^```json\s*/i, '').replace(/\s*```$/, ''))
    try { return { value: JSON.parse(raw) as unknown, raw } } catch { return { value: null, raw, parseError: 'invalid_json' } }
  }

  async generateRoadmap(input: { goal: string; messages: AgentPlanningMessage[]; context: PlanningContextPacket | null; onPhase: RoadmapPhaseCallback }): Promise<RoadmapPlan> {
    const context = JSON.stringify({ goal: input.goal, context: input.context, messages: input.messages.slice(-10) })
    const phase = async (name: RoadmapPhase, instruction: string, previous: unknown): Promise<{ value: unknown; raw: string; parseError?: string }> => {
      await input.onPhase({ phase: name, status: 'started' })
      const result = await this.structured([
        { role: 'system', content: `你是知行路线规划器，当前阶段是 ${name}。${instruction} 只返回 JSON，不输出解释。路线必须基于输入中的用户目标和明确事实，未明确的内容可以作为通用学习建议，但不能声称用户已经掌握。${name === 'critic' ? '最终输出必须符合 nodes、unitKeys、dependencies 结构。' : ''}` },
        { role: 'user', content: JSON.stringify({ context, previous }) },
      ])
      await input.onPhase({ phase: name, status: 'succeeded', output: result.parseError ? { raw: result.raw, parseError: result.parseError } : result.value })
      return result
    }
    const domains = await phase('domain', '提炼与当前目标相关的能力域，保留 2 到 6 个相互独立的方向。', null)
    const modules = await phase('module', '在能力域下生成有父子关系的能力模块，内容要响应用户对话中的重点。', domains.value)
    const units = await phase('unit', '从能力域和模块中选择未来一到两周最值得推进的 1 到 6 个学习单元。若用户明确要学 MySQL 慢查询、EXPLAIN 或索引优化，必须包含一个对应的实验单元，并将 caseIntent 写为 mysql.slow-query-index。', { domains: domains.value, modules: modules.value })
    const previous = { domains: domains.value, modules: modules.value, units: units.value }
    const final = await phase('critic', `检查路线依赖、时间负荷和对话一致性，必要时调整节点。最终只能返回符合以下完整结构的 JSON：${ROADMAP_JSON_CONTRACT}`, previous)
    const parsed = RoadmapPlanSchema.safeParse(final.value)
    if (parsed.success) return parsed.data

    const validationIssues = parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
    const repair = await this.structured([
      { role: 'system', content: `你是知行路线规划器的 JSON 修复器。只返回完整 JSON，不输出解释。修复草稿时不得改变用户目标，不得添加输入中不存在的用户经历。必须严格符合这个结构：${ROADMAP_JSON_CONTRACT}` },
      { role: 'user', content: JSON.stringify({ context, previous, draft: final.raw, parseError: final.parseError ?? null, validationIssues, contract: ROADMAP_JSON_CONTRACT }) },
    ])
    await input.onPhase({ phase: 'critic', status: 'succeeded', output: { initial: final.parseError ? { raw: final.raw, parseError: final.parseError } : final.value, validationIssues, repaired: repair.parseError ? { raw: repair.raw, parseError: repair.parseError } : repair.value } })
    const repaired = RoadmapPlanSchema.safeParse(repair.value)
    if (!repaired.success) {
      const repairIssues = repaired.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
      throw new PlanningAgentError('roadmap_invalid_output', '路线规划器返回的结构不完整，自动修复也未通过校验', true, { validationIssues, repairIssues, repairAttempted: true, initialOutput: final.raw, repairedOutput: repair.raw, repairParseError: repair.parseError ?? null })
    }
    return repaired.data
  }

  async interpret(input: { userMessage: string; assistantMessage: string; messages: AgentPlanningMessage[]; resumeText?: string | null; context?: PlanningContextPacket | null }): Promise<ProfileDelta> {
    const response = await this.call({ stream: false, temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: '你是学习画像解释器。只返回 JSON，不写解释。根据用户原话提取结构化增量，不把阅读或模型推测写成已掌握。格式：{"coveredTopics":string[],"dimensions":[{"key":string,"level":"unknown|exposed|applied|independent|advanced","confidence":number,"summary":string,"nextValidation":string}],"evidence":[{"topicKey":string|null,"sourceType":"user_message|resume|reading|concept|lab","sourceId":string,"excerpt":string}],"followUpTopic":string|null}。只能引用输入中存在的用户消息或简历。' },
      { role: 'user', content: JSON.stringify({ userMessage: input.userMessage, assistantMessage: input.assistantMessage, context: input.context, messages: input.messages.slice(-12), resume: input.context ? undefined : input.resumeText?.slice(0, 12000) ?? null }) },
    ] })
    let value: unknown
    try { value = JSON.parse(stripThinking(contentFrom(await response.json()).replace(/^```json\s*/i, '').replace(/\s*```$/, ''))) } catch { throw new PlanningAgentError('profile_invalid_json', '画像解释器返回的 JSON 无效') }
    const parsed = ProfileDeltaSchema.safeParse(value); if (!parsed.success) throw new PlanningAgentError('profile_invalid_output', '画像解释器返回的结构不完整')
    return parsed.data
  }
}

export class AgentPlanningService {
  private get db(): Database.Database { return this.repository.db }
  private readonly contextCompiler: PlanningContextCompiler
  private readonly contextLocks = new Map<string, Promise<void>>()
  private readonly sessionLocks = new Map<string, Promise<void>>()
  constructor(private readonly repository: ProductRepository, private readonly provider: PlanningProvider, private readonly config?: Pick<LabConfig, 'modelName'>, private readonly zhihu?: ZhihuOpenApiClient) { this.contextCompiler = new PlanningContextCompiler(this.db) }

  private sessionRow(learnerId: string, sessionId: string): Row {
    const row = this.db.prepare("SELECT * FROM planning_sessions WHERE id = ? AND learner_id = ? AND mode = 'agent'").get(sessionId, learnerId) as Row | undefined
    if (!row) throw new LabError('planning_not_found', '规划会话不存在', 404)
    return row
  }

  private topics(sessionId: string): AgentPlanningTopic[] {
    return (this.db.prepare('SELECT * FROM planning_required_topics WHERE session_id = ? ORDER BY priority ASC').all(sessionId) as Row[]).map((row) => ({ key: text(row, 'topic_key'), label: text(row, 'label'), priority: number(row, 'priority'), status: text(row, 'status') as AgentPlanningTopic['status'], evidenceRefs: json<string[]>(row.evidence_refs_json, []) }))
  }

  private profile(snapshotId: string | null): AgentProfile | null {
    if (!snapshotId) return null
    const row = this.db.prepare('SELECT * FROM learner_profile_snapshots WHERE id = ?').get(snapshotId) as Row | undefined; if (!row) return null
    const dimensions = (this.db.prepare('SELECT * FROM learner_profile_dimensions WHERE snapshot_id = ? ORDER BY dimension_key').all(snapshotId) as Row[]).map((item) => ({ key: text(item, 'dimension_key'), level: text(item, 'level') as ProfileDelta['dimensions'][number]['level'], confidence: number(item, 'confidence'), summary: text(item, 'summary'), nextValidation: text(item, 'next_validation') }))
    const evidence = (this.db.prepare('SELECT * FROM learner_profile_evidence WHERE snapshot_id = ? ORDER BY created_at ASC').all(snapshotId) as Row[]).map((item) => ({ id: text(item, 'id'), topicKey: nullable(item, 'topic_key'), sourceType: text(item, 'source_type'), sourceId: text(item, 'source_id'), excerpt: text(item, 'excerpt'), createdAt: text(item, 'created_at') }))
    return { id: text(row, 'id'), version: number(row, 'version'), summary: json(row.summary_json, {}), dimensions, evidence }
  }

  private sessionFrom(row: Row): AgentPlanningSession {
    const id = text(row, 'id'); const profileSnapshotId = nullable(row, 'profile_snapshot_id')
    const messages = (this.db.prepare('SELECT * FROM planning_messages WHERE session_id = ? ORDER BY sequence ASC').all(id) as Row[]).map((item) => ({ id: text(item, 'id'), sequence: number(item, 'sequence'), role: text(item, 'role') as AgentPlanningMessage['role'], content: text(item, 'content'), metadata: json(item.metadata_json, {}), createdAt: text(item, 'created_at') }))
    const generation = generationFrom(this.db.prepare('SELECT id, status, phase, attempt_count, roadmap_id, failure_code, failure_message, updated_at FROM roadmap_generation_runs WHERE planning_session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(id) as Row | undefined)
    return { id, learnerId: text(row, 'learner_id'), goal: text(row, 'goal'), status: text(row, 'status'), mode: 'agent', agentStatus: text(row, 'agent_status'), revision: number(row, 'revision'), messages, requiredTopics: this.topics(id), profile: this.profile(profileSnapshotId), resume: this.repository.getPlanningResumeAttachment(id, text(row, 'learner_id')), roadmapId: generation?.status === 'succeeded' ? generation.roadmapId : null, roadmapGeneration: generation, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
  }

  createSession(learnerId: string, input: { message: string; clientRequestId: string }): AgentPlanningSession {
    this.repository.ensureLearner(learnerId); if (!input.message.trim()) throw new LabError('invalid_request', '规划内容不能为空', 400)
    const existing = this.db.prepare("SELECT * FROM planning_sessions WHERE learner_id = ? AND mode = 'agent' AND client_request_id = ?").get(learnerId, input.clientRequestId) as Row | undefined
    if (existing) return this.sessionFrom(existing)
    const id = randomUUID(); const now = new Date().toISOString(); const goal = input.message.trim()
    const transaction = this.db.transaction(() => {
      this.db.prepare("INSERT INTO planning_sessions(id, learner_id, template_key, goal, status, current_step, answers_json, revision, client_request_id, created_at, updated_at, mode, agent_status, profile_snapshot_id) VALUES (?, ?, 'senior-backend-ai-v1', ?, 'draft', 0, ?, 1, ?, ?, ?, 'agent', 'active', NULL)").run(id, learnerId, goal, JSON.stringify({ goal }), input.clientRequestId, now, now)
      const insert = this.db.prepare('INSERT INTO planning_required_topics(id, session_id, topic_key, label, priority, status, evidence_refs_json, updated_at) VALUES (?, ?, ?, ?, ?, \'unknown\', \'[]\', ?)')
      for (const [key, label, priority] of REQUIRED_TOPICS) insert.run(randomUUID(), id, key, label, priority, now)
      this.db.prepare('INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, client_request_id, created_at) VALUES (?, ?, 1, \'user\', ?, \'{}\', ?, ?)').run(randomUUID(), id, goal, input.clientRequestId, now)
    })
    try { transaction() } catch (error) { if (error instanceof Error && error.message.includes('UNIQUE')) { const retry = this.db.prepare("SELECT * FROM planning_sessions WHERE learner_id = ? AND mode = 'agent' AND client_request_id = ?").get(learnerId, input.clientRequestId) as Row; return this.sessionFrom(retry) } throw error }
    return this.sessionFrom(this.sessionRow(learnerId, id))
  }

  getSession(learnerId: string, sessionId: string): AgentPlanningSession { return this.sessionFrom(this.sessionRow(learnerId, sessionId)) }

  private invocation(sessionId: string, learnerId: string, clientRequestId: string, kind: 'planner' | 'profile_interpreter'): Row | undefined { return this.db.prepare('SELECT * FROM planning_agent_invocations WHERE session_id = ? AND learner_id = ? AND client_request_id = ? AND kind = ?').get(sessionId, learnerId, clientRequestId, kind) as Row | undefined }

  async createAndStream(learnerId: string, message: string, clientRequestId: string, send: SendEvent): Promise<void> {
    const session = this.createSession(learnerId, { message, clientRequestId }); await this.streamMessage(learnerId, session.id, message, clientRequestId, send)
  }

  async streamMessage(learnerId: string, sessionId: string, message: string, clientRequestId: string, send: SendEvent, retryInvocationId?: string, suppressUserMessage = false): Promise<void> {
    const key = `${learnerId}:${sessionId}`
    if (this.sessionLocks.has(key)) throw new LabError('planning_busy', '当前规划会话正在处理上一条消息，请稍后重试', 409, true)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    this.sessionLocks.set(key, gate)
    try { await this.streamMessageUnsafe(learnerId, sessionId, message, clientRequestId, send, retryInvocationId, suppressUserMessage) } finally { release(); this.sessionLocks.delete(key) }
  }

  private async streamMessageUnsafe(learnerId: string, sessionId: string, message: string, clientRequestId: string, send: SendEvent, retryInvocationId?: string, suppressUserMessage = false): Promise<void> {
    const current = this.sessionRow(learnerId, sessionId); const content = message.trim(); if (!content) throw new LabError('invalid_request', '规划内容不能为空', 400)
    const existing = this.invocation(sessionId, learnerId, clientRequestId, 'planner')
    if (existing?.status === 'running') { await send({ type: 'accepted', invocationId: text(existing, 'id'), sessionId }); return }
    if (existing?.status === 'succeeded') { const last = this.db.prepare("SELECT content FROM planning_messages WHERE session_id = ? AND role = 'assistant' ORDER BY sequence DESC LIMIT 1").get(sessionId) as Row | undefined; const invocationId = text(existing, 'id'); await send({ type: 'accepted', invocationId, sessionId }); if (last) await send({ type: 'assistant_delta', invocationId, delta: text(last, 'content') }); await send({ type: 'completed', invocationId, session: this.getSession(learnerId, sessionId) }); return }
    const invocationId = retryInvocationId ?? (existing ? text(existing, 'id') : randomUUID()); const now = new Date().toISOString(); const started = Date.now()
    const hasMessage = suppressUserMessage || Boolean(this.db.prepare('SELECT 1 FROM planning_messages WHERE session_id = ? AND client_request_id = ?').get(sessionId, clientRequestId))
    const transaction = this.db.transaction(() => {
      const claimed = this.db.prepare("UPDATE planning_sessions SET revision = revision + 1, updated_at = ?, agent_status = 'running' WHERE id = ? AND learner_id = ? AND mode = 'agent' AND agent_status NOT IN ('running', 'generating')").run(now, sessionId, learnerId)
      if (claimed.changes === 0) throw new LabError('planning_busy', '当前规划会话正在处理上一条消息，请稍后重试', 409, true)
      if (!existing) this.db.prepare('INSERT INTO planning_agent_invocations(id, session_id, learner_id, client_request_id, kind, provider, model, status, input_fingerprint, created_at) VALUES (?, ?, ?, ?, \'planner\', ?, ?, \'running\', ?, ?)').run(invocationId, sessionId, learnerId, clientRequestId, this.provider.providerName, this.provider.modelName, fingerprint({ sessionId, content }), now)
      else this.db.prepare("UPDATE planning_agent_invocations SET status = 'running', failure_code = NULL, failure_message = NULL, completed_at = NULL WHERE id = ?").run(invocationId)
      if (!hasMessage) {
        const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM planning_messages WHERE session_id = ?').get(sessionId) as Row
        this.db.prepare('INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, client_request_id, created_at) VALUES (?, ?, ?, \'user\', ?, \'{}\', ?, ?)').run(randomUUID(), sessionId, number(next, 'sequence'), content, clientRequestId, now)
      }
    })
    transaction(); await send({ type: 'accepted', invocationId, sessionId })
    try {
      const messages = this.getSession(learnerId, sessionId).messages; const topics = this.topics(sessionId); const attachedResumeText = resumeText(this.db, sessionId); const context = this.contextCompiler.current(learnerId, sessionId); let assistant = ''
      assistant = await this.provider.stream({ goal: text(current, 'goal'), messages, requiredTopics: topics, resumeText: attachedResumeText, context }, async (delta) => { await send({ type: 'assistant_delta', invocationId, delta }) })
      const delta = await this.provider.interpret({ userMessage: content, assistantMessage: assistant, messages, resumeText: attachedResumeText, context }); const snapshotId = this.saveProfile(learnerId, sessionId, delta, content)
      const messageRow = this.db.prepare('SELECT id FROM planning_messages WHERE session_id = ? AND client_request_id = ? AND role = \'user\' ORDER BY sequence DESC LIMIT 1').get(sessionId, clientRequestId) as Row | undefined ?? (suppressUserMessage ? this.db.prepare("SELECT id FROM planning_messages WHERE session_id = ? AND role = 'user' ORDER BY sequence DESC LIMIT 1").get(sessionId) as Row | undefined : undefined)
      const contextInput = { learnerId, sessionId, goal: text(current, 'goal'), messageId: messageRow ? text(messageRow, 'id') : null, clientRequestId, delta, resumeText: attachedResumeText }
      await this.updateContext(contextInput)
      const completedTopics = new Set(delta.coveredTopics.filter((key) => REQUIRED_TOPICS.some(([topic]) => topic === key))); const updateTopic = this.db.prepare('UPDATE planning_required_topics SET status = ?, evidence_refs_json = ?, updated_at = ? WHERE session_id = ? AND topic_key = ?')
      for (const [key] of REQUIRED_TOPICS) if (completedTopics.has(key)) updateTopic.run('covered', JSON.stringify(delta.evidence.filter((item) => item.topicKey === key).map((item) => item.sourceId)), now, sessionId, key)
      const next = this.nextQuestion(sessionId, delta.followUpTopic ?? null); const readiness = '基于目前的信息，我已经可以生成初版学习路线；你也可以继续补充后再生成。'; if (!assistant.includes('生成初版学习路线')) { assistant = `${assistant}\n\n${readiness}`; await send({ type: 'assistant_delta', invocationId, delta: `\n\n${readiness}` }) }; const sequence = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM planning_messages WHERE session_id = ?').get(sessionId) as Row
      this.db.prepare('INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, created_at) VALUES (?, ?, ?, \'assistant\', ?, ?, ?)').run(randomUUID(), sessionId, number(sequence, 'sequence'), assistant, JSON.stringify({ profileSnapshotId: snapshotId }), now)
      this.db.prepare("UPDATE planning_sessions SET agent_status = 'ready', profile_snapshot_id = ?, status = 'ready', updated_at = ? WHERE id = ?").run(snapshotId, now, sessionId)
      this.db.prepare("UPDATE planning_agent_invocations SET status = 'succeeded', latency_ms = ?, completed_at = ? WHERE id = ?").run(Date.now() - started, new Date().toISOString(), invocationId)
      const result = this.getSession(learnerId, sessionId); const coveredTopics = result.requiredTopics.filter((topic) => topic.status === 'covered').map((topic) => topic.key); const pendingTopics = result.requiredTopics.filter((topic) => topic.status !== 'covered').map((topic) => topic.key); await send({ type: 'profile_updated', invocationId, profileSnapshotId: snapshotId, coveredTopics, pendingTopics, dimensions: result.profile?.dimensions ?? [] }); await send({ type: 'roadmap_readiness', invocationId, readiness: 'ready', coveredTopicCount: coveredTopics.length, pendingTopicCount: pendingTopics.length }); await send({ type: 'next_question', invocationId, question: next.question, topicKey: next.topicKey, canGenerateRoadmap: true }); await send({ type: 'completed', invocationId, session: result })
    } catch (error) {
      const failure = error instanceof PlanningAgentError ? error : new PlanningAgentError('planning_failed', error instanceof Error ? error.message : '规划 Agent 调用失败')
      this.db.prepare('UPDATE planning_agent_invocations SET status = \'failed\', failure_code = ?, failure_message = ?, latency_ms = ?, completed_at = ? WHERE id = ?').run(failure.code, failure.message, Date.now() - started, new Date().toISOString(), invocationId)
      this.db.prepare("UPDATE planning_sessions SET agent_status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), sessionId)
      await send({ type: 'failed', invocationId, code: failure.code, message: failure.message, retryable: failure.retryable })
    }
  }

  private async updateContext(input: Parameters<PlanningContextCompiler['update']>[0]): Promise<PlanningContextPacket> {
    const key = `${input.learnerId}:${input.sessionId}`; const previous = this.contextLocks.get(key) ?? Promise.resolve(); let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve }); const queued = previous.then(() => gate); this.contextLocks.set(key, queued)
    await previous
    try { return this.contextCompiler.update(input) } finally { release(); if (this.contextLocks.get(key) === queued) this.contextLocks.delete(key) }
  }

  private saveProfile(learnerId: string, sessionId: string, delta: ProfileDelta, message: string): string {
    const current = this.db.prepare("SELECT COALESCE(MAX(version), 0) AS version FROM learner_profile_snapshots WHERE learner_id = ?").get(learnerId) as Row; const version = number(current, 'version') + 1; const id = randomUUID(); const now = new Date().toISOString()
    const transaction = this.db.transaction(() => {
      this.db.prepare("UPDATE learner_profile_snapshots SET status = 'superseded' WHERE learner_id = ? AND status = 'current'").run(learnerId)
      this.db.prepare("INSERT INTO learner_profile_snapshots(id, learner_id, planning_session_id, version, status, input_fingerprint, summary_json, created_at) VALUES (?, ?, ?, ?, 'current', ?, ?, ?)").run(id, learnerId, sessionId, version, fingerprint(delta), JSON.stringify({ coveredTopics: delta.coveredTopics, followUpTopic: delta.followUpTopic }), now)
      const insertDimension = this.db.prepare('INSERT INTO learner_profile_dimensions(id, snapshot_id, dimension_key, level, confidence, summary, next_validation) VALUES (?, ?, ?, ?, ?, ?, ?)')
      for (const dimension of delta.dimensions) insertDimension.run(randomUUID(), id, dimension.key, dimension.level, dimension.confidence, dimension.summary, dimension.nextValidation)
      const insertEvidence = this.db.prepare('INSERT INTO learner_profile_evidence(id, snapshot_id, topic_key, source_type, source_id, excerpt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
      if (delta.evidence.length === 0) insertEvidence.run(randomUUID(), id, null, 'user_message', sessionId, message.slice(0, 500), now)
      else for (const evidence of delta.evidence) insertEvidence.run(randomUUID(), id, evidence.topicKey ?? null, evidence.sourceType, evidence.sourceId, evidence.excerpt.slice(0, 2000), now)
    })
    transaction(); return id
  }

  private nextQuestion(sessionId: string, followUpTopic: string | null): { topicKey: string | null; question: string } {
    const topics = this.topics(sessionId); const selected = topics.find((topic) => topic.key === followUpTopic && topic.status !== 'covered') ?? topics.find((topic) => topic.status !== 'covered')
    if (!selected) return { topicKey: null, question: '目前的目标、经历和投入已经有一份初步画像。你可以继续补充，也可以现在生成路线图。' }
    const questions: Record<string, string> = { goal_deadline: '为了让路线更具体，你希望在什么时间范围内达到什么结果？', projects: '说一个你真正参与过的项目：你负责了什么，最后做了什么取舍？', responsibility: '在项目里哪些决策由你独立做，哪些需要依赖他人或既有方案？', strengths_gaps: '你最有把握的能力是什么？最近一次明显卡住的地方又是什么？', time_constraints: '每周稳定能投入多少时间，有没有必须考虑的工作或生活约束？', outcome: '你希望这条路线最终留下什么可以展示或回看的产出？' }
    return { topicKey: selected.key, question: questions[selected.key] ?? `关于${selected.label}，你还愿意补充一个具体例子吗？` }
  }

  async generateRoadmap(learnerId: string, sessionId: string, clientRequestId: string): Promise<AgentRoadmapGeneration> {
    const session = this.sessionRow(learnerId, sessionId); const context = this.contextCompiler.current(learnerId, sessionId); const inputFingerprint = fingerprint({ generatorVersion: 'agent-roadmap-v2', sessionId, contextSnapshotId: context?.snapshotId ?? null, messages: this.getSession(learnerId, sessionId).messages.map((item) => [item.role, item.content]), profile: session.profile_snapshot_id }); const existing = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND (client_request_id = ? OR input_fingerprint = ?) ORDER BY created_at DESC LIMIT 1').get(learnerId, clientRequestId, inputFingerprint) as Row | undefined
    if (existing) return generationFrom(existing)!
    const running = this.db.prepare("SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND planning_session_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1").get(learnerId, sessionId) as Row | undefined
    if (running) return generationFrom(running)!
    const id = randomUUID(); const now = new Date().toISOString()
    try {
      const created = this.db.transaction(() => {
        const claimed = this.db.prepare("UPDATE planning_sessions SET agent_status = 'generating', updated_at = ? WHERE id = ? AND learner_id = ? AND mode = 'agent' AND agent_status NOT IN ('running', 'generating')").run(now, sessionId, learnerId)
        if (claimed.changes === 0) return false
        this.db.prepare("INSERT INTO roadmap_generation_runs(id, learner_id, planning_session_id, input_fingerprint, client_request_id, phase, status, attempt_count, diagnostics_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'domain', 'queued', 0, '{}', ?, ?)").run(id, learnerId, sessionId, inputFingerprint, clientRequestId, now, now)
        return true
      })()
      if (!created) {
        const concurrent = this.db.prepare("SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND planning_session_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1").get(learnerId, sessionId) as Row | undefined
        if (concurrent) return generationFrom(concurrent)!
        throw new LabError('planning_busy', '当前规划会话正在处理上一条消息，请稍后重试', 409, true)
      }
    } catch (error) {
      const concurrent = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND (client_request_id = ? OR input_fingerprint = ?) ORDER BY created_at DESC LIMIT 1').get(learnerId, clientRequestId, inputFingerprint) as Row | undefined
      if (concurrent) return generationFrom(concurrent)!
      throw error
    }
    void this.buildRoadmap(learnerId, sessionId, id, inputFingerprint).catch((error) => console.error('[zhixing-planning] roadmap_worker_unhandled', { generationId: id, sessionId, error: error instanceof Error ? error.message : String(error) }))
    return generationFrom(this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ?').get(id) as Row)!
  }

  getRoadmapGeneration(learnerId: string, id: string): AgentRoadmapGeneration {
    const row = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined; if (!row) throw new LabError('roadmap_generation_not_found', '路线生成任务不存在', 404); return generationFrom(row)!
  }

  async retryRoadmap(learnerId: string, id: string): Promise<AgentRoadmapGeneration> {
    const row = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('roadmap_generation_not_found', '路线生成任务不存在', 404)
    if (!['failed', 'interrupted'].includes(text(row, 'status'))) {
      if (['queued', 'running'].includes(text(row, 'status'))) return generationFrom(row)!
      throw new LabError('invalid_request', '只有失败或中断的路线任务可以重试', 409)
    }
    const sessionId = text(row, 'planning_session_id'); const now = new Date().toISOString()
    const claimed = this.db.transaction(() => {
      const updated = this.db.prepare("UPDATE roadmap_generation_runs SET status = 'queued', phase = 'domain', failure_code = NULL, failure_message = NULL, diagnostics_json = '{}', completed_at = NULL, updated_at = ? WHERE id = ? AND learner_id = ? AND status IN ('failed', 'interrupted')").run(now, id, learnerId)
      if (updated.changes === 0) return false
      const sessionUpdated = this.db.prepare("UPDATE planning_sessions SET agent_status = 'generating', updated_at = ? WHERE id = ? AND learner_id = ? AND mode = 'agent' AND agent_status NOT IN ('running', 'generating')").run(now, sessionId, learnerId)
      if (sessionUpdated.changes === 0) throw new LabError('planning_busy', '当前规划会话正在处理上一条消息，请稍后重试', 409, true)
      return true
    })()
    if (claimed) void this.buildRoadmap(learnerId, sessionId, id, text(row, 'input_fingerprint')).catch((error) => console.error('[zhixing-planning] roadmap_worker_unhandled', { generationId: id, sessionId, error: error instanceof Error ? error.message : String(error) }))
    return this.getRoadmapGeneration(learnerId, id)
  }

  recoverRoadmapGenerations(): void {
    const now = new Date().toISOString()
    const interrupted = this.db.prepare("SELECT id, planning_session_id FROM roadmap_generation_runs WHERE status IN ('queued', 'running')").all() as Row[]
    if (interrupted.length === 0) return
    this.db.transaction(() => {
      this.db.prepare("UPDATE roadmap_generation_runs SET status = 'interrupted', phase = 'failed', failure_code = 'worker_interrupted', failure_message = '服务重启，中断了上一次路线生成，请重试', diagnostics_json = ?, updated_at = ?, completed_at = ? WHERE status IN ('queued', 'running')").run(JSON.stringify({ reason: 'process_restart' }), now, now)
      const updateSession = this.db.prepare("UPDATE planning_sessions SET agent_status = 'failed', updated_at = ? WHERE id = ? AND agent_status = 'generating'")
      for (const row of interrupted) updateSession.run(now, text(row, 'planning_session_id'))
    })()
    console.warn('[zhixing-planning] roadmap_workers_interrupted', { count: interrupted.length })
  }

  isAgentSession(learnerId: string, id: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM planning_sessions WHERE id = ? AND learner_id = ? AND mode = 'agent'").get(id, learnerId)) }

  planningState(learnerId: string): AgentPlanningState {
    this.repository.ensureLearner(learnerId)
    const session = this.db.prepare("SELECT id, goal, status, agent_status, revision, updated_at FROM planning_sessions WHERE learner_id = ? AND mode = 'agent' AND status IN ('draft', 'ready', 'proposed') ORDER BY updated_at DESC, id DESC LIMIT 1").get(learnerId) as Row | undefined
    const generation = session ? this.db.prepare('SELECT id, status, phase, attempt_count, roadmap_id, failure_code, failure_message, updated_at FROM roadmap_generation_runs WHERE planning_session_id = ? ORDER BY created_at DESC, id DESC LIMIT 1').get(text(session, 'id')) as Row | undefined : undefined
    const plan = this.repository.getActivePlan(learnerId)
    return {
      session: session ? { id: text(session, 'id'), goal: text(session, 'goal'), status: text(session, 'status'), agentStatus: text(session, 'agent_status'), revision: number(session, 'revision'), roadmapId: nullable(session, 'roadmap_id'), updatedAt: text(session, 'updated_at') } : null,
      generation: generationFrom(generation),
      currentPlan: plan ? { id: plan.id, title: plan.title, goal: plan.goal, status: plan.status, planState: plan.planState, roadmapId: plan.roadmapId ?? null } : null,
    }
  }

  markRoadmapConfirmed(learnerId: string, sessionId: string): void { this.db.prepare("UPDATE planning_sessions SET status = 'confirmed', agent_status = 'confirmed', updated_at = ? WHERE id = ? AND learner_id = ? AND mode = 'agent'").run(new Date().toISOString(), sessionId, learnerId) }

  retryInvocation(learnerId: string, invocationId: string, send: SendEvent): Promise<void> {
    const row = this.db.prepare("SELECT i.*, m.content FROM planning_agent_invocations i INNER JOIN planning_messages m ON m.session_id = i.session_id AND m.client_request_id = i.client_request_id WHERE i.id = ? AND i.learner_id = ? AND i.kind = 'planner' AND m.role = 'user'").get(invocationId, learnerId) as Row | undefined
    if (!row) throw new LabError('planning_invocation_not_found', '规划调用不存在', 404)
    const requestId = `${text(row, 'client_request_id')}:retry:${Date.now()}`
    return this.streamMessage(learnerId, text(row, 'session_id'), text(row, 'content'), requestId, send, undefined, true)
  }

  private hasMysqlIntent(value: string): boolean {
    return /(mysql|MySQL|慢查询|慢查|explain|执行计划|联合索引|索引优化)/i.test(value)
  }

  private localRoadmap(session: AgentPlanningSession, context: PlanningContextPacket | null): RoadmapPlan {
    const mysql = this.hasMysqlIntent(`${session.goal} ${context?.explicitFacts.map((item) => item.content).join(' ') ?? ''}`)
    const focus = context?.currentFocus || session.goal
    const nodes: RoadmapPlan['nodes'] = [{ key: 'goal', parentKey: null, type: 'domain', title: session.goal.slice(0, 120), summary: '从当前目标出发组织后续能力与实践。', points: ['目标', '约束', '产出'], standard: '能够说明当前目标、现实约束和阶段性产出。', minutes: 60, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: ['goal'] }]
    if (mysql) {
      nodes.push({ key: 'mysql-performance', parentKey: 'goal', type: 'capability', title: '数据访问与性能', summary: focus.slice(0, 500), points: ['现象', '执行计划', '验证'], standard: '能从真实现象出发说明判断、尝试和验证。', minutes: 120, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] })
      nodes.push({ key: 'mysql-slow-query', parentKey: 'mysql-performance', type: 'lab', title: 'MySQL 慢查询与索引', summary: '通过真实实验观察慢查询，使用 EXPLAIN 和索引验证优化判断。', points: ['慢查询', 'EXPLAIN', '索引'], standard: '完成一次慢查询排查，并用实验结果验证结论。', minutes: 120, priority: 1, mode: 'lab', caseIntent: 'mysql.slow-query-index', contextKeys: [] })
      return { nodes, unitKeys: ['mysql-slow-query'], dependencies: [], }
    }
    nodes.push({ key: 'current-focus', parentKey: 'goal', type: 'capability', title: '当前重点', summary: focus.slice(0, 500), points: ['理解问题', '形成方法', '完成产出'], standard: '能围绕当前目标完成一个可回看的最小学习产出。', minutes: 120, priority: 1, mode: 'knowledge', caseIntent: null, contextKeys: [] })
    return { nodes, unitKeys: ['current-focus'], dependencies: [] }
  }

  private normalizeRoadmap(plan: RoadmapPlan, session: AgentPlanningSession, context: PlanningContextPacket | null): RoadmapPlan {
    const allText = `${session.goal} ${context?.explicitFacts.map((item) => item.content).join(' ') ?? ''} ${context?.recentMessages.map((item) => item.content).join(' ') ?? ''}`
    const mysql = this.hasMysqlIntent(allText)
    const nodes = [...plan.nodes]
    const keys = new Set<string>()
    for (const node of nodes) {
      if (keys.has(node.key)) throw new PlanningAgentError('roadmap_duplicate_node', `路线节点重复：${node.key}`, false)
      keys.add(node.key)
      if (node.parentKey === node.key || (node.parentKey && !keys.has(node.parentKey) && !nodes.some((candidate) => candidate.key === node.parentKey))) throw new PlanningAgentError('roadmap_invalid_parent', `路线节点父级不存在：${node.parentKey ?? ''}`, false)
    }
    if (!nodes.some((node) => node.parentKey === null)) throw new PlanningAgentError('roadmap_no_root', '路线没有根节点', false)
    if (mysql && !nodes.some((node) => node.caseIntent === 'mysql.slow-query-index')) {
      const parent = nodes.find((node) => node.type === 'capability') ?? nodes.find((node) => node.parentKey === null)
      if (!parent) throw new PlanningAgentError('roadmap_no_parent', '无法为 MySQL 实验建立路线父节点', false)
      nodes.push({ key: 'mysql-slow-query', parentKey: parent.key, type: 'lab', title: 'MySQL 慢查询与索引', summary: '通过真实实验观察慢查询，使用 EXPLAIN 和索引验证优化判断。', points: ['慢查询', 'EXPLAIN', '索引'], standard: '完成一次慢查询排查，并用实验结果验证结论。', minutes: 120, priority: 1, mode: 'lab', caseIntent: 'mysql.slow-query-index', contextKeys: [] })
    }
    const unitKeys = [...new Set(plan.unitKeys.filter((key) => nodes.some((node) => node.key === key)))]
    if (mysql) unitKeys.unshift('mysql-slow-query')
    if (unitKeys.length === 0) throw new PlanningAgentError('roadmap_no_units', '路线没有可执行的学习单元', false)
    return { nodes: nodes.map((node) => node.caseIntent === 'mysql.slow-query-index' ? { ...node, type: 'lab' as const, mode: 'lab' as const } : node), unitKeys: [...new Set(unitKeys)], dependencies: plan.dependencies.filter((item) => nodes.some((node) => node.key === item.nodeKey) && nodes.some((node) => node.key === item.dependsOnKey)) }
  }

  private async buildRoadmap(learnerId: string, sessionId: string, generationId: string, inputFingerprint: string): Promise<void> {
    const now = new Date().toISOString(); const claimed = this.db.prepare("UPDATE roadmap_generation_runs SET status = 'running', phase = 'domain', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(now, generationId)
    if (claimed.changes === 0) return
    const attemptRow = this.db.prepare('SELECT attempt_count FROM roadmap_generation_runs WHERE id = ?').get(generationId) as Row
    const attemptCount = number(attemptRow, 'attempt_count')
    const startedAt = Date.now()
    let currentPhase: RoadmapPhase | null = null
    const recordPhase = (event: RoadmapPhaseEvent) => {
      const timestamp = new Date().toISOString()
      if (event.status === 'started') {
        this.db.prepare("INSERT INTO roadmap_generation_steps(id, generation_run_id, phase, input_fingerprint, status, output_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', '{}', ?, ?) ON CONFLICT(generation_run_id, phase) DO UPDATE SET status = 'running', input_fingerprint = excluded.input_fingerprint, output_json = '{}', failure_message = NULL, updated_at = excluded.updated_at").run(randomUUID(), generationId, event.phase, fingerprint({ inputFingerprint, phase: event.phase, attemptCount }), timestamp, timestamp)
        this.db.prepare("UPDATE roadmap_generation_runs SET phase = ?, updated_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(event.phase, timestamp, generationId, attemptCount)
        currentPhase = event.phase
      } else {
        this.db.prepare("UPDATE roadmap_generation_steps SET status = 'succeeded', output_json = ?, updated_at = ? WHERE generation_run_id = ? AND phase = ?").run(JSON.stringify(event.output ?? {}), timestamp, generationId, event.phase)
      }
    }
    try {
      const session = this.getSession(learnerId, sessionId); const context = this.contextCompiler.current(learnerId, sessionId)
      let generated: RoadmapPlan
      if (this.provider.generateRoadmap) generated = await this.provider.generateRoadmap({ goal: session.goal, messages: session.messages, context, onPhase: recordPhase })
      else {
        for (const phase of ['domain', 'module', 'unit', 'critic'] as const) { recordPhase({ phase, status: 'started' }); recordPhase({ phase, status: 'succeeded', output: {} }) }
        generated = this.localRoadmap(session, context)
      }
      const plan = this.normalizeRoadmap(generated, session, context)
      const roadmapId = randomUUID(); const generatedAt = new Date().toISOString(); const tx = this.db.transaction(() => {
        this.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, based_on_roadmap_id, created_at, updated_at) VALUES (?, ?, 'agent-roadmap-v2', ?, 'draft', 1, ?, NULL, ?, ?)").run(roadmapId, learnerId, session.goal, JSON.stringify({ sessionId, profileSnapshotId: session.profile?.id ?? null, contextSnapshotId: context?.snapshotId ?? null, mode: 'agent', generatorVersion: 'agent-roadmap-v2', inputFingerprint, unitKeys: plan.unitKeys }), generatedAt, generatedAt)
        const ids = new Map<string, string>(); const remaining = new Map(plan.nodes.map((node, index) => [node.key, { node, index }])); const ordered: Array<{ node: RoadmapPlan['nodes'][number]; index: number }> = []
        while (remaining.size > 0) { const next = [...remaining.values()].find(({ node }) => node.parentKey === null || ids.has(node.parentKey)); if (!next) throw new PlanningAgentError('roadmap_cycle', '路线节点存在循环依赖', false); ordered.push(next); ids.set(next.node.key, randomUUID()); remaining.delete(next.node.key) }
        const insertNode = this.db.prepare('INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const mysql = this.hasMysqlIntent(`${session.goal} ${context?.explicitFacts.map((item) => item.content).join(' ') ?? ''}`); const activeKeys = new Set(plan.unitKeys)
        for (const item of ordered) { const node = item.node; let parent = node.parentKey ? ids.get(node.parentKey) ?? null : null; let caseId: string | null = null; let mode = node.mode; if (node.caseIntent === 'mysql.slow-query-index' && mysql) { caseId = 'mysql-order-list-index-001'; mode = 'lab'; activeKeys.add(node.key) }; insertNode.run(ids.get(node.key), roadmapId, parent, node.key, node.type, node.title, node.summary, JSON.stringify({ keyPoints: node.points, contextKeys: node.contextKeys }), node.standard, node.minutes, node.priority, item.index + 1, mode, caseId, generatedAt) }
        const insertProgress = this.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, completed_at, verified_at, revision, updated_at) VALUES (?, ?, ?, 'agent', NULL, NULL, 1, ?)")
        for (const item of ordered) { let available = item.node.parentKey === null || activeKeys.has(item.node.key); let parent = item.node.parentKey; while (parent) { if (activeKeys.has(parent)) available = true; parent = plan.nodes.find((node) => node.key === parent)?.parentKey ?? null }; insertProgress.run(roadmapId, ids.get(item.node.key), available ? 'available' : 'locked', generatedAt) }
        const insertDependency = this.db.prepare('INSERT OR IGNORE INTO roadmap_node_dependencies(roadmap_id, node_id, depends_on_node_id) VALUES (?, ?, ?)'); for (const dependency of plan.dependencies) { if (ids.has(dependency.nodeKey) && ids.has(dependency.dependsOnKey)) insertDependency.run(roadmapId, ids.get(dependency.nodeKey), ids.get(dependency.dependsOnKey)) }
        const insertEvidence = this.db.prepare('INSERT OR IGNORE INTO roadmap_node_evidence(id, roadmap_id, node_id, source_type, source_id, excerpt, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        for (const item of ordered) { const contextKeys = new Set(item.node.contextKeys); if (item.node.key === 'goal') contextKeys.add('goal'); const evidence = (context?.explicitFacts ?? []).filter((fact) => contextKeys.has(fact.key)); evidence.forEach((fact, position) => { insertEvidence.run(randomUUID(), roadmapId, ids.get(item.node.key), 'planning_context', fact.id, fact.content.slice(0, 2000), position + 1, generatedAt) }) }
        this.db.prepare("UPDATE planning_sessions SET status = 'proposed', agent_status = 'ready', updated_at = ? WHERE id = ? AND learner_id = ?").run(generatedAt, sessionId, learnerId)
        this.db.prepare("UPDATE roadmap_generation_runs SET status = 'succeeded', phase = 'completed', roadmap_id = ?, input_snapshot_json = ?, diagnostics_json = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(roadmapId, JSON.stringify({ sessionId, unitKeys: plan.unitKeys }), JSON.stringify({ provider: this.provider.providerName, model: this.provider.modelName, phase: currentPhase, attemptCount, elapsedMs: Date.now() - startedAt, nodeCount: plan.nodes.length, unitCount: plan.unitKeys.length }), generatedAt, generatedAt, generationId, attemptCount)
      }); tx()
    } catch (error) {
      const message = error instanceof Error ? error.message : '路线生成失败'; const code = error instanceof PlanningAgentError ? error.code : 'roadmap_generation_failed'; const details = error instanceof PlanningAgentError ? error.details : {}
      const outputHashes = [details.initialOutput, details.repairedOutput].filter((value): value is string => typeof value === 'string').map((value) => fingerprint(value))
      const diagnostics = { generationId, sessionId, provider: this.provider.providerName, model: this.provider.modelName, phase: currentPhase ?? 'domain', attemptCount, elapsedMs: Date.now() - startedAt, code, message, responseHashes: outputHashes, details, failedAt: new Date().toISOString() }
      const failedAt = new Date().toISOString()
      this.db.transaction(() => {
        this.db.prepare("UPDATE roadmap_generation_steps SET status = 'failed', failure_message = ?, output_json = CASE WHEN ? = '{}' THEN output_json ELSE ? END, updated_at = ? WHERE generation_run_id = ? AND phase = ?").run(message, JSON.stringify(details), JSON.stringify(details), failedAt, generationId, currentPhase ?? 'domain')
        this.db.prepare("UPDATE roadmap_generation_runs SET status = 'failed', phase = 'failed', failure_code = ?, failure_message = ?, diagnostics_json = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(code, message, JSON.stringify(diagnostics), failedAt, failedAt, generationId, attemptCount)
        this.db.prepare("UPDATE planning_sessions SET agent_status = 'failed', updated_at = ? WHERE id = ? AND learner_id = ? AND agent_status = 'generating'").run(failedAt, sessionId, learnerId)
      })()
      console.warn('[zhixing-planning] roadmap_generation_failed', { generationId, sessionId, phase: currentPhase ?? 'domain', attemptCount, code, message, validationIssues: (details.validationIssues as unknown[]) ?? (details.repairIssues as unknown[]) ?? [] })
    }
  }

  isAgentRoadmap(learnerId: string, roadmapId: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM learning_roadmaps WHERE id = ? AND learner_id = ? AND json_extract(input_snapshot_json, '$.mode') = 'agent'").get(roadmapId, learnerId)) }

  async knowledgeRoute(learnerId: string, roadmapId: string, nodeId: string, refresh = false): Promise<unknown> {
    const node = this.db.prepare('SELECT n.*, r.goal, r.input_snapshot_json FROM roadmap_nodes n INNER JOIN learning_roadmaps r ON r.id = n.roadmap_id WHERE n.id = ? AND n.roadmap_id = ? AND r.learner_id = ?').get(nodeId, roadmapId, learnerId) as Row | undefined; if (!node) throw new LabError('roadmap_node_not_found', '路线节点不存在', 404)
    const profileId = (this.db.prepare("SELECT profile_snapshot_id FROM planning_sessions WHERE learner_id = ? AND mode = 'agent' ORDER BY updated_at DESC LIMIT 1").get(learnerId) as Row | undefined)?.profile_snapshot_id as string | undefined; const roadmapInput = json<{ sessionId?: string }>(node.input_snapshot_json, {}); const context = roadmapInput.sessionId ? this.contextCompiler.current(learnerId, roadmapInput.sessionId) : this.contextCompiler.latestForLearner(learnerId); const profileSummary = context ? JSON.stringify({ goal: context.goal, currentFocus: context.currentFocus, explicitFacts: context.explicitFacts, hypotheses: context.hypotheses, constraints: context.constraints, openQuestions: context.openQuestions }) : ''; const queryFingerprint = fingerprint({ nodeId, profileId, contextSnapshotId: context?.snapshotId ?? null, title: text(node, 'title') }); const existing = refresh ? undefined : this.db.prepare('SELECT * FROM knowledge_route_sets WHERE roadmap_node_id = ? AND query_fingerprint = ? AND status = \'ready\' ORDER BY updated_at DESC LIMIT 1').get(nodeId, queryFingerprint) as Row | undefined
    if (existing) return this.routeFrom(existing)
    if (!this.zhihu?.configured) throw new LabError('zhihu_not_configured', '知乎知识路径尚未配置', 503, true)
    const research = await this.zhihu.research({ goal: text(node, 'goal'), profileSummary, nodeTitle: text(node, 'title') }); const queries = research.split(/[\n。；;]/).map((item) => item.replace(/^[-*\d.、\s]+/, '').trim()).filter((item) => item.length > 4).slice(0, 3); const candidates = (await Promise.all((queries.length > 0 ? queries : [text(node, 'title')]).map((query) => this.zhihu!.search(query, 5)))).flat(); const unique = [...new Map(candidates.map((item) => [item.url, item])).values()].slice(0, 3); if (unique.length === 0) throw new LabError('zhihu_empty_result', '知乎没有返回可用材料', 503, true)
    const setId = randomUUID(); const now = new Date().toISOString(); const tx = this.db.transaction(() => { this.db.prepare("INSERT INTO knowledge_route_sets(id, learner_id, roadmap_node_id, profile_snapshot_id, query_fingerprint, status, research_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?)").run(setId, learnerId, nodeId, profileId ?? null, queryFingerprint, JSON.stringify({ research, queries }), now, now); const insert = this.db.prepare('INSERT INTO knowledge_route_items(id, route_set_id, source_item_id, position, role, reason, learning_question) VALUES (?, ?, ?, ?, ?, ?, ?)'); unique.forEach((item, index) => { const saved = this.repository.saveSource(item); insert.run(randomUUID(), setId, saved.id, index + 1, index === 0 ? 'foundation' : index === 1 ? 'case' : 'extension', `与“${text(node, 'title')}”相关`, `读完后，尝试说明它如何帮助你理解${text(node, 'title')}。`) }) }); tx(); return this.routeFrom(this.db.prepare('SELECT * FROM knowledge_route_sets WHERE id = ?').get(setId) as Row)
  }

  private routeFrom(row: Row): unknown { const items = (this.db.prepare('SELECT k.*, s.title, s.author, s.url, s.excerpt, s.retrieved_at FROM knowledge_route_items k INNER JOIN source_items s ON s.id = k.source_item_id WHERE k.route_set_id = ? ORDER BY k.position').all(text(row, 'id')) as Row[]).map((item) => ({ id: text(item, 'id'), sourceItemId: text(item, 'source_item_id'), position: number(item, 'position'), role: text(item, 'role'), reason: text(item, 'reason'), learningQuestion: text(item, 'learning_question'), source: { title: text(item, 'title'), author: nullable(item, 'author'), url: text(item, 'url'), excerpt: text(item, 'excerpt'), retrievedAt: text(item, 'retrieved_at') } })); return { id: text(row, 'id'), roadmapNodeId: text(row, 'roadmap_node_id'), status: text(row, 'status'), research: json(row.research_json, {}), items } }

  feedback(learnerId: string, routeSetId: string, sourceItemId: string, value: 'read' | 'too_hard' | 'too_easy' | 'irrelevant' | 'helpful'): void {
    const owner = this.db.prepare('SELECT id FROM knowledge_route_sets WHERE id = ? AND learner_id = ?').get(routeSetId, learnerId)
    if (!owner) throw new LabError('knowledge_route_not_found', '知识路径不存在', 404)
    const item = this.db.prepare('SELECT id FROM knowledge_route_items WHERE route_set_id = ? AND source_item_id = ?').get(routeSetId, sourceItemId)
    if (!item) throw new LabError('knowledge_source_not_found', '材料不属于当前知识路径', 404)
    this.db.prepare('INSERT OR IGNORE INTO knowledge_route_feedback(id, learner_id, route_set_id, source_item_id, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, routeSetId, sourceItemId, value, new Date().toISOString())
  }
}
