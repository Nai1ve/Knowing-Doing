import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { LabError } from './errors.js'
import { TEMPLATE_NODES, type TemplateNode } from './planning.js'
import { ProductRepository } from './product-repository.js'
import type { LabConfig } from './config.js'
import type { SourceItem } from './product-types.js'
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
export type ProfileDelta = z.infer<typeof ProfileDeltaSchema>

export type PlanningStreamEvent =
  | { type: 'accepted'; invocationId: string; sessionId: string }
  | { type: 'assistant_delta'; invocationId: string; delta: string }
  | { type: 'profile_updated'; invocationId: string; profileSnapshotId: string; coveredTopics: string[]; pendingTopics: string[]; dimensions: ProfileDelta['dimensions'] }
  | { type: 'next_question'; invocationId: string; question: string; topicKey: string | null; canGenerateRoadmap: boolean }
  | { type: 'completed'; invocationId: string; session: AgentPlanningSession }
  | { type: 'failed'; invocationId: string; code: string; message: string; retryable: boolean }

export interface AgentPlanningMessage { id: string; sequence: number; role: 'user' | 'assistant' | 'system'; content: string; metadata: Record<string, unknown>; createdAt: string }
export interface AgentPlanningTopic { key: string; label: string; priority: number; status: 'unknown' | 'covered' | 'needs_follow_up'; evidenceRefs: string[] }
export interface AgentProfileDimension { key: string; level: ProfileDelta['dimensions'][number]['level']; confidence: number; summary: string; nextValidation: string }
export interface AgentProfile { id: string; version: number; summary: Record<string, unknown>; dimensions: AgentProfileDimension[]; evidence: Array<{ id: string; topicKey: string | null; sourceType: string; sourceId: string; excerpt: string; createdAt: string }> }
export interface AgentPlanningSession { id: string; learnerId: string; goal: string; status: string; mode: 'agent'; agentStatus: string; revision: number; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; profile: AgentProfile | null; resume: unknown; roadmapId: string | null; createdAt: string; updatedAt: string }

export interface PlanningProvider {
  readonly providerName: string
  readonly modelName: string
  stream(input: { goal: string; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; resumeText?: string | null }, onDelta: (delta: string) => Promise<void> | void): Promise<string>
  interpret(input: { userMessage: string; assistantMessage: string; messages: AgentPlanningMessage[]; resumeText?: string | null }): Promise<ProfileDelta>
}

export class PlanningAgentError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true) { super(message); this.name = 'PlanningAgentError' }
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

  async stream(input: { goal: string; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; resumeText?: string | null }, onDelta: (delta: string) => Promise<void> | void): Promise<string> {
    const response = await this.call({ stream: true, temperature: 0.35, messages: [
      { role: 'system', content: '你是知行 Planner。用自然中文与用户讨论学习目标、经历、职责、能力、时间和产出。每次只提出一个最有价值的追问，也可以确认目前共识。不要展示思维过程、不要输出 JSON、不要假装已经理解用户未说过的内容。用户可以随时要求生成路线，未覆盖的信息只标记为待验证。' },
      ...input.messages.map((message) => ({ role: message.role, content: message.content })),
      { role: 'user', content: JSON.stringify({ goal: input.goal, requiredTopics: input.requiredTopics.map((topic) => ({ key: topic.key, label: topic.label, status: topic.status })), resume: input.resumeText ? input.resumeText.slice(0, 12000) : null }) },
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

  async interpret(input: { userMessage: string; assistantMessage: string; messages: AgentPlanningMessage[]; resumeText?: string | null }): Promise<ProfileDelta> {
    const response = await this.call({ stream: false, temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: '你是学习画像解释器。只返回 JSON，不写解释。根据用户原话提取结构化增量，不把阅读或模型推测写成已掌握。格式：{"coveredTopics":string[],"dimensions":[{"key":string,"level":"unknown|exposed|applied|independent|advanced","confidence":number,"summary":string,"nextValidation":string}],"evidence":[{"topicKey":string|null,"sourceType":"user_message|resume|reading|concept|lab","sourceId":string,"excerpt":string}],"followUpTopic":string|null}。只能引用输入中存在的用户消息或简历。' },
      { role: 'user', content: JSON.stringify({ userMessage: input.userMessage, assistantMessage: input.assistantMessage, messages: input.messages.slice(-12), resume: input.resumeText?.slice(0, 12000) ?? null }) },
    ] })
    let value: unknown
    try { value = JSON.parse(stripThinking(contentFrom(await response.json()).replace(/^```json\s*/i, '').replace(/\s*```$/, ''))) } catch { throw new PlanningAgentError('profile_invalid_json', '画像解释器返回的 JSON 无效') }
    const parsed = ProfileDeltaSchema.safeParse(value); if (!parsed.success) throw new PlanningAgentError('profile_invalid_output', '画像解释器返回的结构不完整')
    return parsed.data
  }
}

export class AgentPlanningService {
  private get db(): Database.Database { return this.repository.db }
  constructor(private readonly repository: ProductRepository, private readonly provider: PlanningProvider, private readonly config?: Pick<LabConfig, 'modelName'>, private readonly zhihu?: ZhihuOpenApiClient) {}

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
    const roadmap = this.db.prepare("SELECT roadmap_id FROM roadmap_generation_runs WHERE planning_session_id = ? AND status = 'succeeded' ORDER BY created_at DESC LIMIT 1").get(id) as Row | undefined
    return { id, learnerId: text(row, 'learner_id'), goal: text(row, 'goal'), status: text(row, 'status'), mode: 'agent', agentStatus: text(row, 'agent_status'), revision: number(row, 'revision'), messages, requiredTopics: this.topics(id), profile: this.profile(profileSnapshotId), resume: this.repository.getPlanningResumeAttachment(id, text(row, 'learner_id')), roadmapId: roadmap ? nullable(roadmap, 'roadmap_id') : null, createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at') }
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
    const current = this.sessionRow(learnerId, sessionId); const content = message.trim(); if (!content) throw new LabError('invalid_request', '规划内容不能为空', 400)
    const existing = this.invocation(sessionId, learnerId, clientRequestId, 'planner')
    if (existing?.status === 'running') { await send({ type: 'accepted', invocationId: text(existing, 'id'), sessionId }); return }
    if (existing?.status === 'succeeded') { const last = this.db.prepare("SELECT content FROM planning_messages WHERE session_id = ? AND role = 'assistant' ORDER BY sequence DESC LIMIT 1").get(sessionId) as Row | undefined; const invocationId = text(existing, 'id'); await send({ type: 'accepted', invocationId, sessionId }); if (last) await send({ type: 'assistant_delta', invocationId, delta: text(last, 'content') }); await send({ type: 'completed', invocationId, session: this.getSession(learnerId, sessionId) }); return }
    const invocationId = retryInvocationId ?? (existing ? text(existing, 'id') : randomUUID()); const now = new Date().toISOString(); const started = Date.now()
    const hasMessage = suppressUserMessage || Boolean(this.db.prepare('SELECT 1 FROM planning_messages WHERE session_id = ? AND client_request_id = ?').get(sessionId, clientRequestId))
    const transaction = this.db.transaction(() => {
      if (!existing) this.db.prepare('INSERT INTO planning_agent_invocations(id, session_id, learner_id, client_request_id, kind, provider, model, status, input_fingerprint, created_at) VALUES (?, ?, ?, ?, \'planner\', ?, ?, \'running\', ?, ?)').run(invocationId, sessionId, learnerId, clientRequestId, this.provider.providerName, this.provider.modelName, fingerprint({ sessionId, content }), now)
      else this.db.prepare("UPDATE planning_agent_invocations SET status = 'running', failure_code = NULL, failure_message = NULL, completed_at = NULL WHERE id = ?").run(invocationId)
      if (!hasMessage) {
        const next = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM planning_messages WHERE session_id = ?').get(sessionId) as Row
        this.db.prepare('INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, client_request_id, created_at) VALUES (?, ?, ?, \'user\', ?, \'{}\', ?, ?)').run(randomUUID(), sessionId, number(next, 'sequence'), content, clientRequestId, now)
      }
      this.db.prepare("UPDATE planning_sessions SET revision = revision + 1, updated_at = ?, agent_status = 'running' WHERE id = ? AND learner_id = ?").run(now, sessionId, learnerId)
    })
    transaction(); await send({ type: 'accepted', invocationId, sessionId })
    try {
      const messages = this.getSession(learnerId, sessionId).messages; const topics = this.topics(sessionId); const attachedResumeText = resumeText(this.db, sessionId); let assistant = ''
      assistant = await this.provider.stream({ goal: text(current, 'goal'), messages, requiredTopics: topics, resumeText: attachedResumeText }, async (delta) => { await send({ type: 'assistant_delta', invocationId, delta }) })
      const delta = await this.provider.interpret({ userMessage: content, assistantMessage: assistant, messages, resumeText: attachedResumeText }); const snapshotId = this.saveProfile(learnerId, sessionId, delta, content)
      const completedTopics = new Set(delta.coveredTopics.filter((key) => REQUIRED_TOPICS.some(([topic]) => topic === key))); const updateTopic = this.db.prepare('UPDATE planning_required_topics SET status = ?, evidence_refs_json = ?, updated_at = ? WHERE session_id = ? AND topic_key = ?')
      for (const [key] of REQUIRED_TOPICS) if (completedTopics.has(key)) updateTopic.run('covered', JSON.stringify(delta.evidence.filter((item) => item.topicKey === key).map((item) => item.sourceId)), now, sessionId, key)
      const next = this.nextQuestion(sessionId, delta.followUpTopic ?? null); const sequence = this.db.prepare('SELECT COALESCE(MAX(sequence), 0) + 1 AS sequence FROM planning_messages WHERE session_id = ?').get(sessionId) as Row
      this.db.prepare('INSERT INTO planning_messages(id, session_id, sequence, role, content, metadata_json, created_at) VALUES (?, ?, ?, \'assistant\', ?, ?, ?)').run(randomUUID(), sessionId, number(sequence, 'sequence'), assistant, JSON.stringify({ profileSnapshotId: snapshotId }), now)
      this.db.prepare("UPDATE planning_sessions SET agent_status = 'ready', profile_snapshot_id = ?, status = 'ready', updated_at = ? WHERE id = ?").run(snapshotId, now, sessionId)
      this.db.prepare("UPDATE planning_agent_invocations SET status = 'succeeded', latency_ms = ?, completed_at = ? WHERE id = ?").run(Date.now() - started, new Date().toISOString(), invocationId)
      const result = this.getSession(learnerId, sessionId); await send({ type: 'profile_updated', invocationId, profileSnapshotId: snapshotId, coveredTopics: result.requiredTopics.filter((topic) => topic.status === 'covered').map((topic) => topic.key), pendingTopics: result.requiredTopics.filter((topic) => topic.status !== 'covered').map((topic) => topic.key), dimensions: result.profile?.dimensions ?? [] }); await send({ type: 'next_question', invocationId, question: next.question, topicKey: next.topicKey, canGenerateRoadmap: true }); await send({ type: 'completed', invocationId, session: result })
    } catch (error) {
      const failure = error instanceof PlanningAgentError ? error : new PlanningAgentError('planning_failed', error instanceof Error ? error.message : '规划 Agent 调用失败')
      this.db.prepare('UPDATE planning_agent_invocations SET status = \'failed\', failure_code = ?, failure_message = ?, latency_ms = ?, completed_at = ? WHERE id = ?').run(failure.code, failure.message, Date.now() - started, new Date().toISOString(), invocationId)
      this.db.prepare("UPDATE planning_sessions SET agent_status = 'failed', updated_at = ? WHERE id = ?").run(new Date().toISOString(), sessionId)
      await send({ type: 'failed', invocationId, code: failure.code, message: failure.message, retryable: failure.retryable })
    }
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

  async generateRoadmap(learnerId: string, sessionId: string, clientRequestId: string): Promise<{ id: string; status: string; phase: string; roadmapId: string | null }> {
    const session = this.sessionRow(learnerId, sessionId); const inputFingerprint = fingerprint({ sessionId, messages: this.getSession(learnerId, sessionId).messages.map((item) => [item.role, item.content]), profile: session.profile_snapshot_id }); const existing = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND input_fingerprint = ?').get(learnerId, inputFingerprint) as Row | undefined
    if (existing) return { id: text(existing, 'id'), status: text(existing, 'status'), phase: text(existing, 'phase'), roadmapId: nullable(existing, 'roadmap_id') }
    const id = randomUUID(); const now = new Date().toISOString(); this.db.prepare("INSERT INTO roadmap_generation_runs(id, learner_id, planning_session_id, input_fingerprint, phase, status, attempt_count, created_at, updated_at) VALUES (?, ?, ?, ?, 'domain', 'queued', 0, ?, ?)").run(id, learnerId, sessionId, inputFingerprint, now, now)
    void this.buildRoadmap(learnerId, sessionId, id, inputFingerprint).catch(() => undefined)
    return { id, status: 'queued', phase: 'domain', roadmapId: null }
  }

  getRoadmapGeneration(learnerId: string, id: string): Row {
    const row = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined; if (!row) throw new LabError('roadmap_generation_not_found', '路线生成任务不存在', 404); return { id: text(row, 'id'), status: text(row, 'status'), phase: text(row, 'phase'), roadmapId: nullable(row, 'roadmap_id'), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message') }
  }

  async retryRoadmap(learnerId: string, id: string): Promise<Row> {
    const row = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('roadmap_generation_not_found', '路线生成任务不存在', 404)
    if (text(row, 'status') !== 'failed') throw new LabError('invalid_request', '只有失败的路线任务可以重试', 409)
    this.db.prepare("UPDATE roadmap_generation_runs SET status = 'queued', phase = 'domain', failure_code = NULL, failure_message = NULL, updated_at = ? WHERE id = ? AND learner_id = ?").run(new Date().toISOString(), id, learnerId)
    void this.buildRoadmap(learnerId, text(row, 'planning_session_id'), id, text(row, 'input_fingerprint')).catch(() => undefined)
    return this.getRoadmapGeneration(learnerId, id)
  }

  isAgentSession(learnerId: string, id: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM planning_sessions WHERE id = ? AND learner_id = ? AND mode = 'agent'").get(id, learnerId)) }

  markRoadmapConfirmed(learnerId: string, sessionId: string): void { this.db.prepare("UPDATE planning_sessions SET status = 'confirmed', agent_status = 'confirmed', updated_at = ? WHERE id = ? AND learner_id = ? AND mode = 'agent'").run(new Date().toISOString(), sessionId, learnerId) }

  retryInvocation(learnerId: string, invocationId: string, send: SendEvent): Promise<void> {
    const row = this.db.prepare("SELECT i.*, m.content FROM planning_agent_invocations i INNER JOIN planning_messages m ON m.session_id = i.session_id AND m.client_request_id = i.client_request_id WHERE i.id = ? AND i.learner_id = ? AND i.kind = 'planner' AND m.role = 'user'").get(invocationId, learnerId) as Row | undefined
    if (!row) throw new LabError('planning_invocation_not_found', '规划调用不存在', 404)
    const requestId = `${text(row, 'client_request_id')}:retry:${Date.now()}`
    return this.streamMessage(learnerId, text(row, 'session_id'), text(row, 'content'), requestId, send, undefined, true)
  }

  private async buildRoadmap(learnerId: string, sessionId: string, generationId: string, inputFingerprint: string): Promise<void> {
    const now = new Date().toISOString(); this.db.prepare("UPDATE roadmap_generation_runs SET status = 'running', phase = 'domain', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(now, generationId)
    try {
      const session = this.getSession(learnerId, sessionId); const answers = { priority_domain: session.goal.toLowerCase().includes('ai') ? 'AI 应用工程' : '后端系统能力', mastered_node_keys: [] }; const roadmapId = randomUUID();
      const tx = this.db.transaction(() => {
        this.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, based_on_roadmap_id, created_at, updated_at) VALUES (?, ?, 'senior-backend-ai-v1', ?, 'draft', 1, ?, NULL, ?, ?)").run(roadmapId, learnerId, session.goal, JSON.stringify({ sessionId, profileSnapshotId: session.profile?.id ?? null, mode: 'agent', inputFingerprint }), now, now)
        const ids = new Map<string, string>(); const insertNode = this.db.prepare('INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const ordered = [...TEMPLATE_NODES].sort((a, b) => (a.parentKey ? 1 : 0) - (b.parentKey ? 1 : 0)); for (const node of ordered) { const nodeId = randomUUID(); ids.set(node.key, nodeId); insertNode.run(nodeId, roadmapId, node.parentKey ? ids.get(node.parentKey) ?? null : null, node.key, node.type, node.title, node.summary, JSON.stringify({ keyPoints: node.points }), node.standard, node.minutes, node.priority, TEMPLATE_NODES.indexOf(node) + 1, node.mode, node.caseId ?? null, now) }
        const preferred = answers.priority_domain.includes('AI') ? 'model-structured' : 'data-performance'; const insertProgress = this.db.prepare('INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, completed_at, verified_at, revision, updated_at) VALUES (?, ?, ?, \'rule\', NULL, NULL, 1, ?)')
        for (const node of TEMPLATE_NODES) { const available = node.parentKey === null || node.key === preferred || node.parentKey === preferred; insertProgress.run(roadmapId, ids.get(node.key), available ? 'available' : 'locked', now) }
        this.db.prepare("UPDATE planning_sessions SET status = 'proposed', agent_status = 'ready', updated_at = ? WHERE id = ?").run(now, sessionId); this.db.prepare("UPDATE roadmap_generation_runs SET status = 'succeeded', phase = 'completed', roadmap_id = ?, updated_at = ?, completed_at = ? WHERE id = ?").run(roadmapId, now, now, generationId)
      }); tx()
    } catch (error) { this.db.prepare("UPDATE roadmap_generation_runs SET status = 'failed', phase = 'failed', failure_code = ?, failure_message = ?, updated_at = ? WHERE id = ?").run('roadmap_generation_failed', error instanceof Error ? error.message : '路线生成失败', new Date().toISOString(), generationId) }
  }

  isAgentRoadmap(learnerId: string, roadmapId: string): boolean { return Boolean(this.db.prepare("SELECT 1 FROM learning_roadmaps WHERE id = ? AND learner_id = ? AND json_extract(input_snapshot_json, '$.mode') = 'agent'").get(roadmapId, learnerId)) }

  async knowledgeRoute(learnerId: string, roadmapId: string, nodeId: string, refresh = false): Promise<unknown> {
    const node = this.db.prepare('SELECT n.*, r.goal FROM roadmap_nodes n INNER JOIN learning_roadmaps r ON r.id = n.roadmap_id WHERE n.id = ? AND n.roadmap_id = ? AND r.learner_id = ?').get(nodeId, roadmapId, learnerId) as Row | undefined; if (!node) throw new LabError('roadmap_node_not_found', '路线节点不存在', 404)
    const profileId = (this.db.prepare("SELECT profile_snapshot_id FROM planning_sessions WHERE learner_id = ? AND mode = 'agent' ORDER BY updated_at DESC LIMIT 1").get(learnerId) as Row | undefined)?.profile_snapshot_id as string | undefined; const queryFingerprint = fingerprint({ nodeId, profileId, title: text(node, 'title') }); const existing = refresh ? undefined : this.db.prepare('SELECT * FROM knowledge_route_sets WHERE roadmap_node_id = ? AND query_fingerprint = ? AND status = \'ready\' ORDER BY updated_at DESC LIMIT 1').get(nodeId, queryFingerprint) as Row | undefined
    if (existing) return this.routeFrom(existing)
    if (!this.zhihu?.configured) throw new LabError('zhihu_not_configured', '知乎知识路径尚未配置', 503, true)
    const research = await this.zhihu.research({ goal: text(node, 'goal'), profileSummary: profileId ?? '', nodeTitle: text(node, 'title') }); const queries = research.split(/[\n。；;]/).map((item) => item.replace(/^[-*\d.、\s]+/, '').trim()).filter((item) => item.length > 4).slice(0, 3); const candidates = (await Promise.all((queries.length > 0 ? queries : [text(node, 'title')]).map((query) => this.zhihu!.search(query, 5)))).flat(); const unique = [...new Map(candidates.map((item) => [item.url, item])).values()].slice(0, 3); if (unique.length === 0) throw new LabError('zhihu_empty_result', '知乎没有返回可用材料', 503, true)
    const setId = randomUUID(); const now = new Date().toISOString(); const tx = this.db.transaction(() => { this.db.prepare("INSERT INTO knowledge_route_sets(id, learner_id, roadmap_node_id, profile_snapshot_id, query_fingerprint, status, research_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'ready', ?, ?, ?)").run(setId, learnerId, nodeId, profileId ?? null, queryFingerprint, JSON.stringify({ research, queries }), now, now); const insert = this.db.prepare('INSERT INTO knowledge_route_items(id, route_set_id, source_item_id, position, role, reason, learning_question) VALUES (?, ?, ?, ?, ?, ?, ?)'); unique.forEach((item, index) => { const saved = this.repository.saveSource(item); insert.run(randomUUID(), setId, saved.id, index + 1, index === 0 ? 'foundation' : index === 1 ? 'case' : 'extension', `与“${text(node, 'title')}”相关`, `读完后，尝试说明它如何帮助你理解${text(node, 'title')}。`) }) }); tx(); return this.routeFrom(this.db.prepare('SELECT * FROM knowledge_route_sets WHERE id = ?').get(setId) as Row)
  }

  private routeFrom(row: Row): unknown { const items = (this.db.prepare('SELECT k.*, s.title, s.author, s.url, s.excerpt, s.retrieved_at FROM knowledge_route_items k INNER JOIN source_items s ON s.id = k.source_item_id WHERE k.route_set_id = ? ORDER BY k.position').all(text(row, 'id')) as Row[]).map((item) => ({ id: text(item, 'id'), sourceItemId: text(item, 'source_item_id'), position: number(item, 'position'), role: text(item, 'role'), reason: text(item, 'reason'), learningQuestion: text(item, 'learning_question'), source: { title: text(item, 'title'), author: nullable(item, 'author'), url: text(item, 'url'), excerpt: text(item, 'excerpt'), retrievedAt: text(item, 'retrieved_at') } })); return { id: text(row, 'id'), roadmapNodeId: text(row, 'roadmap_node_id'), status: text(row, 'status'), research: json(row.research_json, {}), items } }

  feedback(learnerId: string, routeSetId: string, sourceItemId: string, value: 'read' | 'too_hard' | 'too_easy' | 'irrelevant' | 'helpful'): void { const owner = this.db.prepare('SELECT id FROM knowledge_route_sets WHERE id = ? AND learner_id = ?').get(routeSetId, learnerId); if (!owner) throw new LabError('knowledge_route_not_found', '知识路径不存在', 404); this.db.prepare('INSERT OR IGNORE INTO knowledge_route_feedback(id, learner_id, route_set_id, source_item_id, feedback, created_at) VALUES (?, ?, ?, ?, ?, ?)').run(randomUUID(), learnerId, routeSetId, sourceItemId, value, new Date().toISOString()) }
}
