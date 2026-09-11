import { createHash, randomUUID } from 'node:crypto'
import type Database from 'better-sqlite3'
import { z } from 'zod'
import { LabError } from './errors.js'
import { ProductRepository } from './product-repository.js'
import type { LabConfig } from './config.js'
import type { LearnerResumeContext, LearningPlan, SourceItem } from './product-types.js'
import { PlanningContextCompiler, type PlanningContextPacket } from './planning-context.js'
import { ZhihuOpenApiClient, ZhihuOpenApiError } from './zhihu-openapi.js'
import { PracticeEnvironmentCatalog, type AgentPracticeEnvironment } from './practice-environment-catalog.js'

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
  supportedPracticeCandidates: z.array(z.object({ capabilityKey: z.string().min(1), rationale: z.string().min(1).max(500), evidenceRefs: z.array(z.string().min(1)).min(1).max(6) })).max(4).default([]),
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
  mode: z.enum(['knowledge', 'lab', 'workspace', 'unavailable']),
  capabilityKey: z.string().trim().min(1).max(160).nullable().optional(),
  exerciseProfileKey: z.string().trim().min(1).max(160).nullable().optional(),
  caseIntent: z.string().nullable().default(null),
  contextKeys: z.array(z.string()).max(8).default([]),
})
const RoadmapPlanSchema = z.object({
  nodes: z.array(RoadmapNodeDraftSchema).min(1).max(80),
  unitKeys: z.array(z.string()).min(1).max(6),
  dependencies: z.array(z.object({ nodeKey: z.string(), dependsOnKey: z.string() })).max(80).default([]),
}).superRefine((value, context) => {
  const nodes = new Map(value.nodes.map((node) => [node.key, node]))
  value.unitKeys.forEach((key, index) => {
    const node = nodes.get(key)
    if (!node) {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['unitKeys', index], message: `学习单元不存在：${key}` })
    } else if (node.type === 'domain' || node.type === 'capability') {
      context.addIssue({ code: z.ZodIssueCode.custom, path: ['unitKeys', index], message: `能力域和能力分支不能作为学习单元：${key}` })
    }
  })
})

const DomainPhaseSchema = z.object({
  domains: z.array(z.object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    points: z.array(z.string().min(1).max(100)).max(8).default([]),
    standard: z.string().min(1).max(500),
    minutes: z.number().int().positive().max(600),
    priority: z.number().int().positive().max(100),
    contextKeys: z.array(z.string()).max(8).default([]),
  })).min(2).max(6),
})

const ModulePhaseSchema = z.object({
  modules: z.array(z.object({
    key: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
    domainKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
    title: z.string().min(1).max(120),
    summary: z.string().min(1).max(500),
    points: z.array(z.string().min(1).max(100)).max(8).default([]),
    standard: z.string().min(1).max(500),
    minutes: z.number().int().positive().max(600),
    priority: z.number().int().positive().max(100),
    contextKeys: z.array(z.string()).max(8).default([]),
  })).min(1).max(30),
})

const UnitPhaseSchema = z.object({
  units: z.array(RoadmapNodeDraftSchema.extend({
    parentKey: z.string().regex(/^[a-z0-9][a-z0-9-]{1,80}$/),
    type: z.enum(['concept', 'lab', 'project']),
  })).min(1).max(60),
  unitKeys: z.array(z.string()).min(1).max(4),
})

const ExecutionProposalOptionSchema = z.object({
  unitKey: z.string().min(1),
  rationale: z.array(z.string().min(1).max(300)).min(1).max(4),
  orderedInitialUnitKeys: z.array(z.string()).min(1).max(6),
})

const ExecutionProposalSchema = z.object({
  recommendedUnitKey: z.string().min(1),
  options: z.array(ExecutionProposalOptionSchema).min(1).max(3),
})

const PlanAdjustmentProposalSchema = z.object({
  unitKeys: z.array(z.string().min(1)).min(1).max(4),
  rationale: z.array(z.string().min(1).max(300)).min(1).max(4),
  appendGym: z.object({ capabilityKey: z.string().min(1) }).nullable().optional(),
})

const CriticReviewSchema = z.object({
  executionProposal: ExecutionProposalSchema.optional(),
  unitKeys: z.array(z.string()).min(1).max(6).optional(),
  dependencies: z.array(z.object({ nodeKey: z.string(), dependsOnKey: z.string() })).max(80).default([]),
  revisions: z.array(z.object({
    key: z.string(),
    title: z.string().min(1).max(120).optional(),
    summary: z.string().min(1).max(500).optional(),
    standard: z.string().min(1).max(500).optional(),
    points: z.array(z.string().min(1).max(100)).max(8).optional(),
    minutes: z.number().int().positive().max(600).optional(),
    priority: z.number().int().positive().max(100).optional(),
  })).max(80).default([]),
}).superRefine((value, context) => {
  if (!value.executionProposal && (!value.unitKeys || value.unitKeys.length === 0)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['executionProposal'], message: 'critic 必须返回 executionProposal' })
})

type DomainPhase = z.infer<typeof DomainPhaseSchema>
type ModulePhase = z.infer<typeof ModulePhaseSchema>
type UnitPhase = z.infer<typeof UnitPhaseSchema>
type CriticReview = z.infer<typeof CriticReviewSchema>
type ExecutionProposal = z.infer<typeof ExecutionProposalSchema>
type ExecutionProposalOption = z.infer<typeof ExecutionProposalOptionSchema>
type ProfileDeltaInput = z.input<typeof ProfileDeltaSchema>
export type PlanAdjustmentProposal = z.infer<typeof PlanAdjustmentProposalSchema>
type RoadmapPlan = z.infer<typeof RoadmapPlanSchema> & { executionProposal: ExecutionProposal | null }
type RoadmapPhase = 'domain' | 'module' | 'unit' | 'critic'
type RoadmapPhaseEvent = { phase: RoadmapPhase; scopeKey?: string | null; status: 'started' | 'succeeded' | 'failed'; output?: unknown }
type RoadmapPhaseCallback = (event: RoadmapPhaseEvent) => Promise<void> | void
type RoadmapGenerationCache = { domain?: unknown; module?: unknown; units: Record<string, unknown>; critic?: unknown }
type ValidationIssue = { path: string; code: string; message: string }
export type ProfileDelta = z.infer<typeof ProfileDeltaSchema>
function normalizeProfileDelta(value: ProfileDeltaInput): ProfileDelta { return ProfileDeltaSchema.parse(value) }

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
export interface AgentRoadmapGeneration { id: string; status: 'queued' | 'running' | 'succeeded' | 'failed' | 'interrupted'; phase: RoadmapPhase | 'completed' | 'failed'; scopeKey?: string | null; attemptCount: number; roadmapId: string | null; failureCode: string | null; failureMessage: string | null; updatedAt: string }
export interface AgentPlanningSession { id: string; learnerId: string; goal: string; status: string; mode: 'agent'; agentStatus: string; revision: number; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; profile: AgentProfile | null; resume: unknown; roadmapId: string | null; roadmapGeneration: AgentRoadmapGeneration | null; createdAt: string; updatedAt: string }
export interface AgentPlanningState {
  session: { id: string; goal: string; status: string; agentStatus: string; revision: number; roadmapId: string | null; updatedAt: string } | null
  generation: AgentRoadmapGeneration | null
  currentPlan: { id: string; title: string; goal: string; status: string; planState: string; roadmapId: string | null } | null
}
export interface AgentPlanAdjustment {
  id: string
  learnerId: string
  planId: string
  basePlanRevision: number
  status: 'ready' | 'confirmed' | 'failed' | 'superseded'
  request: string
  proposal: PlanAdjustmentProposal
  diff: { before: string[]; after: string[]; rationale: string[] }
  provider: string
  failureCode: string | null
  failureMessage: string | null
  confirmedAt: string | null
  createdAt: string
  updatedAt: string
}

export interface PlanningProvider {
  readonly providerName: string
  readonly modelName: string
  stream(input: { goal: string; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; resumeText?: string | null; context?: PlanningContextPacket | null; practiceEnvironments?: AgentPracticeEnvironment[] }, onDelta: (delta: string) => Promise<void> | void): Promise<string>
  interpret(input: { userMessage: string; assistantMessage: string; messages: AgentPlanningMessage[]; resumeText?: string | null; context?: PlanningContextPacket | null; practiceEnvironments?: AgentPracticeEnvironment[] }): Promise<ProfileDeltaInput>
  generateRoadmap?(input: { goal: string; messages: AgentPlanningMessage[]; context: PlanningContextPacket | null; cached?: RoadmapGenerationCache; onPhase: RoadmapPhaseCallback; practiceEnvironments?: AgentPracticeEnvironment[] }): Promise<RoadmapPlan>
  adjustPlan?(input: { request: string; goal: string; currentUnitKey: string; planUnits: Array<{ nodeKey: string; title: string; status: string }>; candidateNodes: Array<{ nodeKey: string; title: string; nodeType: string }>; context: PlanningContextPacket | null }): Promise<PlanAdjustmentProposal>
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
function phaseResult(value: unknown): unknown {
  if (value && typeof value === 'object' && 'result' in value) return (value as { result: unknown }).result
  return value
}
function text(row: Row, key: string): string { return String(row[key]) }
function nullable(row: Row, key: string): string | null { return row[key] == null ? null : String(row[key]) }
function number(row: Row, key: string): number { return Number(row[key]) }
function json<T>(value: unknown, fallback: T): T { if (typeof value !== 'string') return fallback; try { return JSON.parse(value) as T } catch { return fallback } }
function resumeSnippet(resume: LearnerResumeContext | null, focus: string, limit = 3): string | null {
  if (!resume) return null
  const terms = [...new Set((focus.toLowerCase().match(/[a-z0-9+#.]{2,}|[\u4e00-\u9fff]{2,}/g) ?? []).slice(0, 24))]
  const chunks = [...resume.chunks].map((chunk) => ({ chunk, score: terms.reduce((score, term) => score + (chunk.content.toLowerCase().includes(term) ? 1 : 0), 0) })).sort((left, right) => right.score - left.score || left.chunk.position - right.chunk.position).slice(0, limit)
  return chunks.map(({ chunk }) => `[简历片段 ${chunk.position}] ${chunk.content}`).join('\n\n').slice(0, 6000) || null
}

function resumeEvidence(resume: LearnerResumeContext | null, focus: string): ProfileDelta['evidence'] {
  if (!resume) return []
  const selected = resumeSnippet(resume, focus)
  if (!selected) return []
  const selectedPositions = new Set([...selected.matchAll(/\[简历片段 (\d+)\]/g)].map((match) => Number(match[1])))
  return resume.chunks.filter((chunk) => selectedPositions.has(chunk.position)).map((chunk) => ({ topicKey: null, sourceType: 'resume' as const, sourceId: chunk.id, excerpt: chunk.content }))
}
function generationFrom(row: Row | undefined): AgentRoadmapGeneration | null {
  if (!row) return null
  return { id: text(row, 'id'), status: text(row, 'status') as AgentRoadmapGeneration['status'], phase: text(row, 'phase') as AgentRoadmapGeneration['phase'], scopeKey: nullable(row, 'scope_key'), attemptCount: number(row, 'attempt_count'), roadmapId: nullable(row, 'roadmap_id'), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), updatedAt: text(row, 'updated_at') }
}
function adjustmentFrom(row: Row | undefined): AgentPlanAdjustment {
  if (!row) throw new LabError('plan_adjustment_not_found', '计划调整不存在', 404)
  return {
    id: text(row, 'id'), learnerId: text(row, 'learner_id'), planId: text(row, 'plan_id'), basePlanRevision: number(row, 'base_plan_revision'), status: text(row, 'status') as AgentPlanAdjustment['status'], request: text(row, 'request_text'), proposal: json<PlanAdjustmentProposal>(row.proposal_json, { unitKeys: [], rationale: [] }), diff: json(row.diff_json, { before: [], after: [], rationale: [] }), provider: text(row, 'provider'), failureCode: nullable(row, 'failure_code'), failureMessage: nullable(row, 'failure_message'), confirmedAt: nullable(row, 'confirmed_at'), createdAt: text(row, 'created_at'), updatedAt: text(row, 'updated_at'),
  }
}

const ROADMAP_JSON_CONTRACT = JSON.stringify({
  nodes: [
    { key: 'domain-key', parentKey: null, type: 'domain', title: '能力域', summary: '说明当前能力域与目标的关系', points: ['关键点'], standard: '可观察的完成标准', minutes: 120, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: ['goal'] },
    { key: 'concept-key', parentKey: 'domain-key', type: 'concept', title: '具体学习节点', summary: '说明可以实际推进的学习内容', points: ['观察'], standard: '完成一次可回看的学习活动', minutes: 90, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: ['goal'] },
  ],
  unitKeys: ['concept-key'],
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

  async stream(input: { goal: string; messages: AgentPlanningMessage[]; requiredTopics: AgentPlanningTopic[]; resumeText?: string | null; context?: PlanningContextPacket | null; practiceEnvironments?: AgentPracticeEnvironment[] }, onDelta: (delta: string) => Promise<void> | void): Promise<string> {
    const conversation = input.messages.slice(-8).map((message) => ({ role: message.role, content: message.content }))
    const response = await this.call({ stream: true, temperature: 0.35, messages: [
      { role: 'system', content: '你是知行 Planner。用自然中文与用户讨论学习目标、经历、职责、能力、时间和产出。每次只提出一个最有价值的追问，也可以确认目前共识。不要展示思维过程、不要输出 JSON、不要假装已经理解用户未说过的内容。用户可以随时要求生成路线，未覆盖的信息只标记为待验证。只有下方运行能力目录中的项目可以作为可进入的知行 Gym；其余方向可规划为知识或项目学习，但不要建议用户联系管理员、添加环境或等待人工配置。' },
      ...(input.context ? [{ role: 'system' as const, content: `这是当前已编译的规划上下文，只能把 explicitFacts 视为用户明确提供的信息，hypotheses 必须继续验证：${JSON.stringify(input.context)}` }] : []),
      ...conversation,
      { role: 'user', content: JSON.stringify({ goal: input.goal, requiredTopics: input.requiredTopics.map((topic) => ({ key: topic.key, label: topic.label, status: topic.status })), practiceEnvironments: input.practiceEnvironments ?? [], resume: (input.resumeText ?? input.context?.resumeExcerpt)?.slice(0, 12000) ?? null }) },
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

  private async structuredPhase<T>(input: { name: RoadmapPhase; scopeKey?: string | null; cached?: unknown; instruction: string; previous: unknown; context: string; schema: z.ZodType<T>; contract: string; onPhase: RoadmapPhaseCallback; validate?: (value: T) => ValidationIssue[] }): Promise<T> {
    if (input.cached != null) {
      const cached = input.schema.safeParse(phaseResult(input.cached))
      const issues = cached.success ? (input.validate?.(cached.data) ?? []) : cached.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
      if (cached.success && issues.length === 0) {
        await input.onPhase({ phase: input.name, scopeKey: input.scopeKey, status: 'started' })
        await input.onPhase({ phase: input.name, scopeKey: input.scopeKey, status: 'succeeded', output: { reused: true, result: cached.data } })
        return cached.data
      }
      throw new PlanningAgentError('roadmap_cached_output_invalid', `${input.name} 已成功结果无法复用`, false, { phase: input.name, scopeKey: input.scopeKey, validationIssues: issues })
    }
    await input.onPhase({ phase: input.name, scopeKey: input.scopeKey, status: 'started' })
    const result = await this.structured([
      { role: 'system', content: `你是知行路线规划器，当前阶段是 ${input.name}。${input.instruction} 只返回 JSON，不输出解释。路线只能使用用户目标和明确事实，不能声称用户已经掌握。输出必须严格符合以下 JSON 合约：${input.contract}` },
      { role: 'user', content: JSON.stringify({ context: input.context, previous: input.previous }) },
    ])
    const parsed = input.schema.safeParse(result.value)
    const initialIssues: ValidationIssue[] = parsed.success
      ? (input.validate?.(parsed.data) ?? [])
      : parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
    if (parsed.success && initialIssues.length === 0) {
      await input.onPhase({ phase: input.name, scopeKey: input.scopeKey, status: 'succeeded', output: { result: parsed.data, diagnostics: { repaired: false } } })
      return parsed.data
    }
    const repair = await this.structured([
      { role: 'system', content: `你是知行路线规划器的 ${input.name} 阶段修复器。只返回完整 JSON，不输出解释。不得改变用户目标，不得删除已有的有效父子关系。严格符合：${input.contract}` },
      { role: 'user', content: JSON.stringify({ context: input.context, previous: input.previous, draft: result.raw, parseError: result.parseError ?? null, validationIssues: initialIssues, contract: input.contract }) },
    ])
    const repaired = input.schema.safeParse(repair.value)
    const repairIssues: ValidationIssue[] = repaired.success
      ? (input.validate?.(repaired.data) ?? [])
      : repaired.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message }))
    if (!repaired.success || repairIssues.length > 0) {
      await input.onPhase({ phase: input.name, scopeKey: input.scopeKey, status: 'failed', output: { result: repair.parseError ? null : repair.value, diagnostics: { initial: result.parseError ? { raw: result.raw, parseError: result.parseError } : result.value, validationIssues: initialIssues, repaired: repair.parseError ? { raw: repair.raw, parseError: repair.parseError } : repair.value, repairIssues } } })
      throw new PlanningAgentError('roadmap_invalid_output', `${input.name} 阶段输出无效，自动修复也未通过校验`, true, {
        phase: input.name,
        validationIssues: initialIssues,
        repairIssues,
        initialOutput: result.raw,
        repairedOutput: repair.raw,
      })
    }
    await input.onPhase({ phase: input.name, scopeKey: input.scopeKey, status: 'succeeded', output: { result: repaired.data, diagnostics: { repaired: true, initial: result.parseError ? { raw: result.raw, parseError: result.parseError } : result.value, validationIssues: initialIssues } } })
    return repaired.data
  }

  private compileRoadmap(domain: DomainPhase, modules: ModulePhase, units: UnitPhase, criticValue: unknown): RoadmapPlan {
    const domains: RoadmapPlan['nodes'] = domain.domains.map((item) => ({ key: item.key, parentKey: null, type: 'domain' as const, title: item.title, summary: item.summary, points: item.points, standard: item.standard, minutes: item.minutes, priority: item.priority, mode: 'knowledge' as const, capabilityKey: null, caseIntent: null, contextKeys: item.contextKeys }))
    const domainKeys = new Set(domain.domains.map((item) => item.key))
    const moduleNodes: RoadmapPlan['nodes'] = modules.modules.map((item) => ({ key: item.key, parentKey: item.domainKey, type: 'capability' as const, title: item.title, summary: item.summary, points: item.points, standard: item.standard, minutes: item.minutes, priority: item.priority, mode: 'knowledge' as const, capabilityKey: null, caseIntent: null, contextKeys: item.contextKeys }))
    const moduleKeys = new Set(modules.modules.map((item) => item.key))
    const unitNodes = units.units.map((item) => ({ ...item, parentKey: item.parentKey }))
    const nodeKeys = new Set<string>()
    for (const node of [...domains, ...moduleNodes, ...unitNodes]) {
      if (nodeKeys.has(node.key)) throw new PlanningAgentError('roadmap_duplicate_node', `路线节点重复：${node.key}`, false)
      nodeKeys.add(node.key)
    }
    for (const module of modules.modules) if (!domainKeys.has(module.domainKey)) throw new PlanningAgentError('roadmap_invalid_parent', `能力分支父级不存在：${module.domainKey}`, false)
    for (const unit of units.units) if (!moduleKeys.has(unit.parentKey)) throw new PlanningAgentError('roadmap_invalid_parent', `学习节点父级不存在：${unit.parentKey}`, false)
    const children = new Map<string, RoadmapPlan['nodes']>()
    for (const node of [...moduleNodes, ...unitNodes]) { const list = children.get(node.parentKey!) ?? []; list.push(node); children.set(node.parentKey!, list) }
    for (const item of domains) if ((children.get(item.key) ?? []).length === 0) throw new PlanningAgentError('roadmap_empty_domain', `能力域没有能力分支：${item.key}`, true)
    for (const item of moduleNodes) if ((children.get(item.key) ?? []).length === 0) throw new PlanningAgentError('roadmap_empty_capability', `能力分支没有可执行节点：${item.key}`, true)

    const review = CriticReviewSchema.safeParse(criticValue)
    const legacy = RoadmapPlanSchema.safeParse(criticValue)
    const fallbackKeys = review.success ? (review.data.unitKeys ?? units.unitKeys) : legacy.success ? legacy.data.unitKeys : units.unitKeys
    const dependencies = review.success ? review.data.dependencies : legacy.success ? legacy.data.dependencies : []
    const revisions = review.success ? review.data.revisions : []
    const proposal: ExecutionProposal = review.success && review.data.executionProposal
      ? review.data.executionProposal
      : { recommendedUnitKey: fallbackKeys[0], options: [{ unitKey: fallbackKeys[0], rationale: ['根据当前规划上下文切出近期可执行单元。'], orderedInitialUnitKeys: fallbackKeys }] }
    const allUnitKeys = new Set(unitNodes.map((node) => node.key))
    const proposalIssues: ValidationIssue[] = []
    if (!allUnitKeys.has(proposal.recommendedUnitKey)) proposalIssues.push({ path: 'executionProposal.recommendedUnitKey', code: 'unknown_unit', message: `推荐起点不存在：${proposal.recommendedUnitKey}` })
    const optionKeys = new Set<string>()
    proposal.options.forEach((option, index) => {
      if (optionKeys.has(option.unitKey)) proposalIssues.push({ path: `executionProposal.options.${index}.unitKey`, code: 'duplicate_key', message: `起点选项重复：${option.unitKey}` })
      optionKeys.add(option.unitKey)
      if (!allUnitKeys.has(option.unitKey)) proposalIssues.push({ path: `executionProposal.options.${index}.unitKey`, code: 'unknown_unit', message: `起点选项不存在：${option.unitKey}` })
      if (option.orderedInitialUnitKeys[0] !== option.unitKey) proposalIssues.push({ path: `executionProposal.options.${index}.orderedInitialUnitKeys`, code: 'invalid_order', message: '执行切片的第一项必须是起点选项' })
      option.orderedInitialUnitKeys.forEach((key) => { if (!allUnitKeys.has(key)) proposalIssues.push({ path: `executionProposal.options.${index}.orderedInitialUnitKeys`, code: 'unknown_unit', message: `执行单元不存在：${key}` }) })
    })
    if (!optionKeys.has(proposal.recommendedUnitKey)) proposalIssues.push({ path: 'executionProposal.recommendedUnitKey', code: 'missing_option', message: '推荐起点必须出现在起点选项中' })
    if (proposalIssues.length > 0) throw new PlanningAgentError('roadmap_invalid_execution_proposal', '路线起点提案未通过校验', true, { validationIssues: proposalIssues })
    const selectedOption = proposal.options.find((item) => item.unitKey === proposal.recommendedUnitKey) ?? proposal.options[0]
    const unitKeys = selectedOption.orderedInitialUnitKeys
    const revisionMap = new Map(revisions.map((item) => [item.key, item]))
    const merged = [...domains, ...moduleNodes, ...unitNodes].map((node) => {
      const revision = revisionMap.get(node.key)
      if (!revision) return node
      return { ...node, title: revision.title ?? node.title, summary: revision.summary ?? node.summary, standard: revision.standard ?? node.standard, points: revision.points ?? node.points, minutes: revision.minutes ?? node.minutes, priority: revision.priority ?? node.priority }
    })
    const parsed = RoadmapPlanSchema.safeParse({ nodes: merged, unitKeys, dependencies })
    if (!parsed.success) throw new PlanningAgentError('roadmap_invalid_output', '合并后的路线树未通过结构校验', true, { validationIssues: parsed.error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })) })
    return { ...parsed.data, executionProposal: proposal }
  }

  async generateRoadmap(input: { goal: string; messages: AgentPlanningMessage[]; context: PlanningContextPacket | null; cached?: RoadmapGenerationCache; onPhase: RoadmapPhaseCallback; practiceEnvironments?: AgentPracticeEnvironment[] }): Promise<RoadmapPlan> {
    const context = JSON.stringify({ goal: input.goal, context: input.context, messages: input.messages.slice(-10), practiceEnvironments: input.practiceEnvironments ?? [] })
    const domains = await this.structuredPhase({ name: 'domain', cached: input.cached?.domain, instruction: '提炼 2 到 6 个能力域。每个能力域只描述长期方向，不直接承担学习单元。', previous: null, context, schema: DomainPhaseSchema, contract: '{"domains":[{"key":"backend-depth","title":"能力域","summary":"能力域说明","points":["关键点"],"standard":"完成标准","minutes":120,"priority":1,"contextKeys":["goal"]}]}', onPhase: input.onPhase, validate: (value) => {
      const seen = new Set<string>(); const issues: ValidationIssue[] = []
      value.domains.forEach((item, index) => { if (seen.has(item.key)) issues.push({ path: `domains.${index}.key`, code: 'duplicate_key', message: `能力域 key 重复：${item.key}` }); seen.add(item.key) })
      return issues
    } })
    const modules = await this.structuredPhase({ name: 'module', cached: input.cached?.module, instruction: '针对每个能力域生成至少一个能力分支，确保每个 domain 都有子节点。', previous: domains, context, schema: ModulePhaseSchema, contract: '{"modules":[{"key":"backend-performance","domainKey":"backend-depth","title":"能力分支","summary":"能力分支说明","points":["关键点"],"standard":"完成标准","minutes":120,"priority":1,"contextKeys":["goal"]}]}', onPhase: input.onPhase, validate: (value) => {
      const domainKeys = new Set(domains.domains.map((item) => item.key)); const covered = new Set(value.modules.map((item) => item.domainKey)); const seen = new Set(domainKeys); const issues: ValidationIssue[] = []
      domains.domains.forEach((item, index) => { if (!covered.has(item.key)) issues.push({ path: `domains.${index}`, code: 'missing_child', message: `能力域必须至少有一个能力分支：${item.key}` }) })
      value.modules.forEach((item, index) => { if (!domainKeys.has(item.domainKey)) issues.push({ path: `modules.${index}.domainKey`, code: 'invalid_parent', message: `能力分支父级不存在：${item.domainKey}` }); if (seen.has(item.key)) issues.push({ path: `modules.${index}.key`, code: 'duplicate_key', message: `能力节点 key 重复：${item.key}` }); seen.add(item.key) })
      return issues
    } })
    const unitOutputs: UnitPhase[] = []
    const generatedParents = new Set<string>()
    for (const module of modules.modules) {
      const units = await this.structuredPhase({ name: 'unit', scopeKey: module.key, cached: input.cached?.units[module.key], instruction: `只为能力分支 ${module.key} 生成 1 到 4 个具体的 concept、lab 或 project 节点。所有节点 parentKey 必须等于 ${module.key}，不要生成其他分支的节点。选出本分支中未来 1 到 2 周最值得推进的 1 到 4 个 unitKeys。若使用知行 Gym，capabilityKey、caseIntent 和 mode 必须严格来自 context.practiceEnvironments；目录外内容必须使用 knowledge。`, previous: { domains, module }, context, schema: UnitPhaseSchema, contract: '{"units":[{"key":"backend-performance-unit","parentKey":"backend-performance","type":"concept","title":"具体学习节点","summary":"节点说明","points":["观察"],"standard":"完成标准","minutes":120,"priority":1,"mode":"knowledge","capabilityKey":null,"caseIntent":null,"contextKeys":["goal"]}],"unitKeys":["backend-performance-unit"]}', onPhase: input.onPhase, validate: (value) => {
        const seen = new Set<string>(); const issues: ValidationIssue[] = []
        const allowedParentKeys = new Set(modules.modules.map((item) => item.key))
        value.units.forEach((item, index) => { if (!allowedParentKeys.has(item.parentKey)) issues.push({ path: `units.${index}.parentKey`, code: 'invalid_parent', message: `学习节点父级不存在：${item.parentKey}` }); if (seen.has(item.key)) issues.push({ path: `units.${index}.key`, code: 'duplicate_key', message: `学习节点 key 重复：${item.key}` }); seen.add(item.key) })
        value.unitKeys.forEach((key, index) => { if (!seen.has(key)) issues.push({ path: `unitKeys.${index}`, code: 'unknown_unit', message: `当前单元不存在：${key}` }) })
        return issues
      } })
      unitOutputs.push(units); units.units.forEach((item) => generatedParents.add(item.parentKey))
      if (generatedParents.size === modules.modules.length) break
    }
    const units: UnitPhase = { units: unitOutputs.flatMap((item) => item.units), unitKeys: unitOutputs.flatMap((item) => item.unitKeys).slice(0, 6) }
    if (generatedParents.size !== modules.modules.length) throw new PlanningAgentError('roadmap_empty_capability', '存在未生成学习节点的能力分支', true)
    const critic = await this.structuredPhase({ name: 'critic', cached: input.cached?.critic, instruction: '只审阅合并后的完整路线。不能删除能力域、能力分支、叶节点或改变父子关系。只返回 executionProposal、依赖和已有节点的有限字段修订。executionProposal 必须提供推荐起点和最多两个合法备选，每个选项的 orderedInitialUnitKeys 第一项必须是自身 unitKey。', previous: { domains, modules, units }, context, schema: CriticReviewSchema, contract: '{"executionProposal":{"recommendedUnitKey":"backend-performance-unit","options":[{"unitKey":"backend-performance-unit","rationale":["基于明确目标和当前约束"],"orderedInitialUnitKeys":["backend-performance-unit"]}]},"dependencies":[],"revisions":[]}', onPhase: input.onPhase })
    return this.compileRoadmap(domains, modules, units, critic)
  }

  async adjustPlan(input: { request: string; goal: string; currentUnitKey: string; planUnits: Array<{ nodeKey: string; title: string; status: string }>; candidateNodes: Array<{ nodeKey: string; title: string; nodeType: string }>; context: PlanningContextPacket | null }): Promise<PlanAdjustmentProposal> {
    const contract = '{"unitKeys":["具体学习节点 key"],"rationale":["引用目标、约束、经历或依赖关系说明调整原因"]}'
    const messages: Array<{ role: 'system' | 'user'; content: string }> = [
      { role: 'system', content: `你是知行规划助手，只为已经确认的计划生成受控调整建议。只能从 candidateNodes 中选择节点，不能改变路线树，不能删除已完成或已有实践证据的单元。第一项必须是当前执行起点；只有用户明确要求且当前起点没有实践时才允许更换。只返回 JSON，严格符合：${contract}` },
      { role: 'user', content: JSON.stringify({ request: input.request, goal: input.goal, currentUnitKey: input.currentUnitKey, planUnits: input.planUnits, candidateNodes: input.candidateNodes, context: input.context }) },
    ]
    const first = await this.structured(messages)
    const parsed = PlanAdjustmentProposalSchema.safeParse(first.value)
    if (parsed.success) return parsed.data
    const repair = await this.structured([
      { role: 'system', content: `修复规划调整 JSON。只返回 JSON，不增加说明。${contract}` },
      { role: 'user', content: JSON.stringify({ draft: first.raw, parseError: first.parseError ?? null, validationIssues: parsed.error.issues, candidateNodes: input.candidateNodes, currentUnitKey: input.currentUnitKey }) },
    ])
    const repaired = PlanAdjustmentProposalSchema.safeParse(repair.value)
    if (!repaired.success) throw new PlanningAgentError('plan_adjustment_invalid_output', '规划助手返回的调整建议无效', true, { validationIssues: repaired.error.issues })
    return repaired.data
  }

  async interpret(input: { userMessage: string; assistantMessage: string; messages: AgentPlanningMessage[]; resumeText?: string | null; context?: PlanningContextPacket | null; practiceEnvironments?: AgentPracticeEnvironment[] }): Promise<ProfileDelta> {
    const response = await this.call({ stream: false, temperature: 0, response_format: { type: 'json_object' }, messages: [
      { role: 'system', content: '你是学习画像解释器。只返回 JSON，不写解释。根据用户原话提取结构化增量，不把阅读或模型推测写成已掌握。格式：{"coveredTopics":string[],"dimensions":[{"key":string,"level":"unknown|exposed|applied|independent|advanced","confidence":number,"summary":string,"nextValidation":string}],"evidence":[{"topicKey":string|null,"sourceType":"user_message|resume|reading|concept|lab","sourceId":string,"excerpt":string}],"supportedPracticeCandidates":[{"capabilityKey":"目录中的 planningKey","rationale":string,"evidenceRefs":string[]}],"followUpTopic":string|null}。supportedPracticeCandidates 只能从输入的 practiceEnvironments 选择，且必须有用户原话或简历证据，evidenceRefs 必须引用输入中的 sourceId。' },
      { role: 'user', content: JSON.stringify({ userMessage: input.userMessage, assistantMessage: input.assistantMessage, context: input.context, messages: input.messages.slice(-12), practiceEnvironments: input.practiceEnvironments ?? [], resume: (input.resumeText ?? input.context?.resumeExcerpt)?.slice(0, 12000) ?? null }) },
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
  private readonly practiceEnvironments: PracticeEnvironmentCatalog
  private readonly contextLocks = new Map<string, Promise<void>>()
  private readonly sessionLocks = new Map<string, Promise<void>>()
  constructor(private readonly repository: ProductRepository, private readonly provider: PlanningProvider, private readonly config?: Pick<LabConfig, 'modelName'>, private readonly zhihu?: ZhihuOpenApiClient) { this.contextCompiler = new PlanningContextCompiler(this.db); this.practiceEnvironments = new PracticeEnvironmentCatalog(this.db) }

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
    this.repository.linkCurrentResumeToSession(learnerId, id)
    return this.sessionFrom(this.sessionRow(learnerId, id))
  }

  getSession(learnerId: string, sessionId: string): AgentPlanningSession { return this.sessionFrom(this.sessionRow(learnerId, sessionId)) }

  async attachResume(learnerId: string, sessionId: string): Promise<PlanningContextPacket | null> {
    const session = this.sessionRow(learnerId, sessionId)
    const resume = this.repository.getPlanningResumeContext(sessionId, learnerId)
    if (!resume) return this.contextCompiler.current(learnerId, sessionId)
    const excerpt = resumeSnippet(resume, text(session, 'goal'))
    const packet = await this.updateContext({
      learnerId,
      sessionId,
      goal: text(session, 'goal'),
      messageId: null,
      clientRequestId: `resume:${resume.attachment.id}:${resume.attachment.version}`,
      resumeText: excerpt,
      delta: { coveredTopics: [], dimensions: [], followUpTopic: null, evidence: resumeEvidence(resume, text(session, 'goal')) },
    })
    this.db.prepare('UPDATE planning_sessions SET updated_at = ? WHERE id = ? AND learner_id = ?').run(new Date().toISOString(), sessionId, learnerId)
    return packet
  }

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
      const messages = this.getSession(learnerId, sessionId).messages; const topics = this.topics(sessionId); const attachedResume = this.repository.getPlanningResumeContext(sessionId, learnerId); const attachedResumeText = resumeSnippet(attachedResume, `${text(current, 'goal')} ${content}`); const context = this.contextCompiler.current(learnerId, sessionId); let assistant = ''
        const practiceEnvironments = this.practiceEnvironments.agentContext()
        assistant = await this.provider.stream({ goal: text(current, 'goal'), messages, requiredTopics: topics, resumeText: attachedResumeText, context, practiceEnvironments }, async (delta) => { await send({ type: 'assistant_delta', invocationId, delta }) })
        const interpreted = normalizeProfileDelta(await this.provider.interpret({ userMessage: content, assistantMessage: assistant, messages, resumeText: attachedResumeText, context, practiceEnvironments }))
      const delta: ProfileDelta = attachedResume
        ? { ...interpreted, evidence: [...interpreted.evidence.filter((item) => item.sourceType !== 'resume'), ...resumeEvidence(attachedResume, `${text(current, 'goal')} ${content}`)] }
        : interpreted
      const snapshotId = this.saveProfile(learnerId, sessionId, delta, content)
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
      const candidates = delta.supportedPracticeCandidates.filter((candidate) => this.practiceEnvironments.get(candidate.capabilityKey) != null)
      this.db.prepare("INSERT INTO learner_profile_snapshots(id, learner_id, planning_session_id, version, status, input_fingerprint, summary_json, created_at) VALUES (?, ?, ?, ?, 'current', ?, ?, ?)").run(id, learnerId, sessionId, version, fingerprint(delta), JSON.stringify({ coveredTopics: delta.coveredTopics, followUpTopic: delta.followUpTopic, supportedPracticeCandidates: candidates }), now)
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

  async generateRoadmap(learnerId: string, sessionId: string, clientRequestId: string, replaceCurrent = false): Promise<AgentRoadmapGeneration> {
    const session = this.sessionRow(learnerId, sessionId); const context = this.contextCompiler.current(learnerId, sessionId); const activePlan = this.repository.getActivePlan(learnerId); const inputFingerprint = fingerprint({ generatorVersion: 'agent-roadmap-v2', sessionId, contextSnapshotId: context?.snapshotId ?? null, messages: this.getSession(learnerId, sessionId).messages.map((item) => [item.role, item.content]), profile: session.profile_snapshot_id, replaceCurrent, activeRoadmapId: replaceCurrent ? activePlan?.roadmapId ?? null : null }); const existing = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND (client_request_id = ? OR input_fingerprint = ?) ORDER BY created_at DESC LIMIT 1').get(learnerId, clientRequestId, inputFingerprint) as Row | undefined
    if (existing) return generationFrom(existing)!
    const running = this.db.prepare("SELECT * FROM roadmap_generation_runs WHERE learner_id = ? AND planning_session_id = ? AND status IN ('queued', 'running') ORDER BY created_at DESC LIMIT 1").get(learnerId, sessionId) as Row | undefined
    if (running) return generationFrom(running)!
    const id = randomUUID(); const now = new Date().toISOString()
    try {
      const created = this.db.transaction(() => {
        const claimed = this.db.prepare("UPDATE planning_sessions SET agent_status = 'generating', updated_at = ? WHERE id = ? AND learner_id = ? AND mode = 'agent' AND agent_status NOT IN ('running', 'generating')").run(now, sessionId, learnerId)
        if (claimed.changes === 0) return false
        this.db.prepare("INSERT INTO roadmap_generation_runs(id, learner_id, planning_session_id, input_fingerprint, client_request_id, phase, status, attempt_count, diagnostics_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, 'domain', 'queued', 0, ?, ?, ?)").run(id, learnerId, sessionId, inputFingerprint, clientRequestId, JSON.stringify(replaceCurrent ? { replaceCurrent: true, targetPlanId: activePlan?.id ?? null, targetRoadmapId: activePlan?.roadmapId ?? null } : {}), now, now)
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

  async repairCurrentRoadmap(learnerId: string, sessionId: string, clientRequestId: string): Promise<AgentRoadmapGeneration> {
    const plan = this.repository.getActivePlan(learnerId)
    if (!plan?.roadmapId) throw new LabError('roadmap_not_found', '当前 learner 没有可替换的 Agent 路线', 404)
    const session = this.sessionRow(learnerId, sessionId)
    const roadmap = this.db.prepare("SELECT id, input_snapshot_json FROM learning_roadmaps WHERE id = ? AND learner_id = ? AND status = 'active' AND template_key = 'agent-roadmap-v2'").get(plan.roadmapId, learnerId) as Row | undefined
    const roadmapInput = json<{ sessionId?: string }>(roadmap?.input_snapshot_json, {})
    if (!roadmap || roadmapInput.sessionId !== sessionId) throw new LabError('roadmap_replace_session_mismatch', '规划会话不属于当前 Agent 路线，不能直接替换', 409)
    const referenced = this.db.prepare('SELECT 1 FROM plan_units u INNER JOIN practice_runs p ON p.plan_unit_id = u.id WHERE u.plan_id = ? LIMIT 1').get(plan.id)
    if (referenced) throw new LabError('roadmap_replace_has_practice', '当前计划已经存在实践记录，不能直接替换路线', 409)
    const generation = await this.generateRoadmap(learnerId, sessionId, clientRequestId, true)
    const row = this.db.prepare('SELECT client_request_id FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(generation.id, learnerId) as Row | undefined
    if (['failed', 'interrupted'].includes(generation.status) && (row ? text(row, 'client_request_id') : null) !== clientRequestId) return this.retryRoadmap(learnerId, generation.id, { replaceCurrent: true, targetPlanId: plan.id, targetRoadmapId: plan.roadmapId })
    return generation
  }

  getRoadmapGeneration(learnerId: string, id: string): AgentRoadmapGeneration {
    const row = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined; if (!row) throw new LabError('roadmap_generation_not_found', '路线生成任务不存在', 404); return generationFrom(row)!
  }

  async retryRoadmap(learnerId: string, id: string, replacementTarget?: { replaceCurrent: boolean; targetPlanId: string; targetRoadmapId: string }): Promise<AgentRoadmapGeneration> {
    const row = this.db.prepare('SELECT * FROM roadmap_generation_runs WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    if (!row) throw new LabError('roadmap_generation_not_found', '路线生成任务不存在', 404)
    if (!['failed', 'interrupted'].includes(text(row, 'status'))) {
      if (['queued', 'running'].includes(text(row, 'status'))) return generationFrom(row)!
      throw new LabError('invalid_request', '只有失败或中断的路线任务可以重试', 409)
    }
    const sessionId = text(row, 'planning_session_id'); const now = new Date().toISOString()
    const previousDiagnostics = json<{ replaceCurrent?: boolean; targetPlanId?: string | null; targetRoadmapId?: string | null }>(row.diagnostics_json, {})
    const target = replacementTarget ?? { replaceCurrent: previousDiagnostics.replaceCurrent ?? false, targetPlanId: previousDiagnostics.targetPlanId ?? null, targetRoadmapId: previousDiagnostics.targetRoadmapId ?? null }
    const claimed = this.db.transaction(() => {
      const updated = this.db.prepare("UPDATE roadmap_generation_runs SET status = 'queued', phase = 'domain', failure_code = NULL, failure_message = NULL, diagnostics_json = ?, completed_at = NULL, updated_at = ? WHERE id = ? AND learner_id = ? AND status IN ('failed', 'interrupted')").run(JSON.stringify({ replaceCurrent: target.replaceCurrent, targetPlanId: target.targetPlanId, targetRoadmapId: target.targetRoadmapId, retryOf: id }), now, id, learnerId)
      if (updated.changes === 0) return false
      const sessionUpdated = this.db.prepare("UPDATE planning_sessions SET agent_status = 'generating', updated_at = ? WHERE id = ? AND learner_id = ? AND mode = 'agent' AND agent_status <> 'running'").run(now, sessionId, learnerId)
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

  private generationCache(generationId: string, diagnostics: { phase?: RoadmapPhase; scopeKey?: string | null }): RoadmapGenerationCache {
    const cache: RoadmapGenerationCache = { units: {} }
    const rows = this.db.prepare("SELECT phase, scope_key, output_json FROM roadmap_generation_phase_attempts WHERE generation_run_id = ? AND status = 'succeeded' ORDER BY phase, scope_key, attempt_no DESC").all(generationId) as Row[]
    const seen = new Set<string>()
    for (const row of rows) {
      const phase = text(row, 'phase') as RoadmapPhase
      const scope = nullable(row, 'scope_key')
      const key = `${phase}:${scope ?? ''}`
      if (seen.has(key)) continue
      seen.add(key)
      const value = phaseResult(json(row.output_json, null))
      if (value == null) continue
      if (phase === 'domain' && scope == null) cache.domain = value
      else if (phase === 'module' && scope == null) cache.module = value
      else if (phase === 'unit' && scope != null) cache.units[scope] = value
      else if (phase === 'critic' && scope == null) cache.critic = value
    }
    if (!diagnostics.phase) return cache
    if (diagnostics.phase === 'domain') return { units: {} }
    if (diagnostics.phase === 'module') return { domain: cache.domain, units: {} }
    if (diagnostics.phase === 'unit' && diagnostics.scopeKey) delete cache.units[diagnostics.scopeKey]
    if (diagnostics.phase === 'critic') delete cache.critic
    return cache
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

  async createPlanAdjustment(learnerId: string, planId: string, request: string, clientRequestId: string): Promise<AgentPlanAdjustment> {
    const plan = this.repository.getPlanForLearner(planId, learnerId)
    if (!plan || plan.status !== 'active' || !plan.roadmapId) throw new LabError('plan_adjustment_not_allowed', '只有当前 Agent 计划可以请求调整', 409)
    const existing = this.db.prepare('SELECT * FROM plan_adjustments WHERE plan_id = ? AND client_request_id = ?').get(planId, clientRequestId) as Row | undefined
    if (existing) return adjustmentFrom(existing)
    const cleanRequest = request.trim()
    if (!cleanRequest) throw new LabError('invalid_request', '调整内容不能为空', 400)
    const units = this.db.prepare('SELECT u.id, u.status, n.node_key, n.title, EXISTS(SELECT 1 FROM practice_runs p WHERE p.plan_unit_id = u.id) AS has_practice FROM plan_units u INNER JOIN roadmap_nodes n ON n.id = u.roadmap_node_id WHERE u.plan_id = ? ORDER BY u.position').all(planId) as Row[]
    const current = units.find((unit) => text(unit, 'status') === 'current')
    if (!current) throw new LabError('plan_adjustment_no_current', '当前计划没有可调整的起点', 409)
    const candidates = this.db.prepare("SELECT n.node_key, n.title, n.node_type, n.capability_key, n.case_id, COALESCE(p.status, 'locked') AS progress_status FROM roadmap_nodes n LEFT JOIN roadmap_node_progress p ON p.roadmap_id = n.roadmap_id AND p.node_id = n.id WHERE n.roadmap_id = ? AND n.node_type IN ('concept', 'lab', 'project') ORDER BY n.position").all(plan.roadmapId) as Row[]
    const requestedGym = this.practiceEnvironments.recommend(cleanRequest)
    const roadmapInput = json<{ sessionId?: string }>((this.db.prepare('SELECT input_snapshot_json FROM learning_roadmaps WHERE id = ? AND learner_id = ?').get(plan.roadmapId, learnerId) as Row | undefined)?.input_snapshot_json, {})
    const context = roadmapInput.sessionId ? this.contextCompiler.current(learnerId, roadmapInput.sessionId) : null
    let proposal: PlanAdjustmentProposal
    if (this.provider.adjustPlan) {
      proposal = await this.provider.adjustPlan({ request: cleanRequest, goal: plan.goal, currentUnitKey: text(current, 'node_key'), planUnits: units.map((unit) => ({ nodeKey: text(unit, 'node_key'), title: text(unit, 'title'), status: text(unit, 'status') })), candidateNodes: candidates.map((node) => ({ nodeKey: text(node, 'node_key'), title: text(node, 'title'), nodeType: text(node, 'node_type') })), context })
    } else {
      const target = candidates.find((node) => cleanRequest.includes(text(node, 'node_key')) || cleanRequest.includes(text(node, 'title')))
      if (!target && !requestedGym) throw new LabError('plan_adjustment_provider_unavailable', '当前规划助手不支持生成这类调整', 503, true)
      const upcoming = units.filter((unit) => text(unit, 'status') === 'upcoming').map((unit) => text(unit, 'node_key'))
      const targetKey = target ? text(target, 'node_key') : requestedGym!.planningKey
      proposal = { unitKeys: [targetKey, ...upcoming.filter((key) => key !== targetKey)].slice(0, 4), rationale: ['根据用户提出的调整方向重新排序当前可执行单元。'] }
    }
    const existingGym = requestedGym ? candidates.find((node) => text(node, 'capability_key') === requestedGym.capabilityKey) : null
    if (requestedGym && !existingGym) proposal = { ...proposal, unitKeys: [requestedGym.planningKey, ...proposal.unitKeys.filter((key) => key !== requestedGym.planningKey)].slice(0, 4), appendGym: { capabilityKey: requestedGym.planningKey } }
    const candidateByKey = new Map(candidates.map((node) => [text(node, 'node_key'), node]))
    const selected = [...new Set(proposal.unitKeys)]
    if (selected.length !== proposal.unitKeys.length || selected.length === 0) throw new LabError('plan_adjustment_invalid_output', '调整建议包含重复或空的学习单元', 409)
    for (const [index, key] of selected.entries()) {
      const node = candidateByKey.get(key)
      const appendedGym = proposal.appendGym && proposal.appendGym.capabilityKey === requestedGym?.planningKey && key === requestedGym.planningKey
      if ((!node && !appendedGym) || (node && text(node, 'progress_status') === 'locked' && !units.some((unit) => text(unit, 'node_key') === key))) throw new LabError('plan_adjustment_invalid_output', `调整建议包含不可执行节点：${key}`, 409)
      if (index === 0 && Boolean(current.has_practice) && key !== text(current, 'node_key')) throw new LabError('plan_adjustment_current_started', '当前单元已经有实践记录，不能更换起点', 409)
    }
    const now = new Date().toISOString(); const id = randomUUID(); const diff = { before: units.map((unit) => text(unit, 'node_key')), after: selected, rationale: proposal.rationale }
    try {
      this.db.prepare('INSERT INTO plan_adjustments(id, learner_id, plan_id, client_request_id, base_plan_revision, status, request_text, diff_json, proposal_json, provider, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'ready\', ?, ?, ?, ?, ?, ?)').run(id, learnerId, planId, clientRequestId, plan.revision, cleanRequest, JSON.stringify(diff), JSON.stringify(proposal), this.provider.adjustPlan ? this.provider.providerName : 'rules', now, now)
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE')) { const retry = this.db.prepare('SELECT * FROM plan_adjustments WHERE plan_id = ? AND client_request_id = ?').get(planId, clientRequestId) as Row | undefined; if (retry) return adjustmentFrom(retry) }
      throw error
    }
    return adjustmentFrom(this.db.prepare('SELECT * FROM plan_adjustments WHERE id = ?').get(id) as Row)
  }

  getPlanAdjustment(learnerId: string, id: string): AgentPlanAdjustment {
    const row = this.db.prepare('SELECT * FROM plan_adjustments WHERE id = ? AND learner_id = ?').get(id, learnerId) as Row | undefined
    return adjustmentFrom(row)
  }

  confirmPlanAdjustment(learnerId: string, id: string): LearningPlan {
    const adjustment = this.getPlanAdjustment(learnerId, id); if (adjustment.status === 'confirmed') return this.repository.getPlanForLearner(adjustment.planId, learnerId); if (adjustment.status !== 'ready') throw new LabError('plan_adjustment_not_ready', '调整草案不能确认', 409)
    const now = new Date().toISOString(); const tx = this.db.transaction(() => {
      const plan = this.db.prepare("SELECT * FROM learning_plans WHERE id = ? AND learner_id = ? AND status = 'active'").get(adjustment.planId, learnerId) as Row | undefined
      if (!plan) throw new LabError('plan_adjustment_not_allowed', '当前计划不存在或已经失效', 409)
      if (number(plan, 'revision') !== adjustment.basePlanRevision) throw new LabError('plan_revision_conflict', '计划已经更新，请刷新后重新生成调整', 409)
      const units = this.db.prepare('SELECT u.*, n.node_key, n.title AS node_title, n.summary AS node_summary, n.learning_mode AS node_learning_mode, n.case_id AS node_case_id, n.estimated_minutes AS node_minutes, EXISTS(SELECT 1 FROM practice_runs p WHERE p.plan_unit_id = u.id) AS has_practice FROM plan_units u INNER JOIN roadmap_nodes n ON n.id = u.roadmap_node_id WHERE u.plan_id = ? ORDER BY u.position').all(adjustment.planId) as Row[]
      const current = units.find((unit) => text(unit, 'status') === 'current'); const desired = adjustment.proposal.unitKeys
      if (!current) throw new LabError('plan_adjustment_no_current', '当前计划没有可调整的起点', 409)
      if (Boolean(current.has_practice) && text(current, 'node_key') !== desired[0]) throw new LabError('plan_adjustment_current_started', '当前单元已经有实践记录，不能更换起点', 409)
      if (adjustment.proposal.appendGym) {
        const capability = this.practiceEnvironments.get(adjustment.proposal.appendGym.capabilityKey)
        if (!capability || !desired.includes(capability.planningKey)) throw new LabError('plan_adjustment_invalid_output', '调整草案包含不支持的实验能力', 409)
        const existing = this.db.prepare('SELECT id FROM roadmap_nodes WHERE roadmap_id = ? AND node_key = ?').get(plan.roadmap_id, capability.planningKey) as Row | undefined
        if (!existing) {
          const parent = this.db.prepare("SELECT id FROM roadmap_nodes WHERE roadmap_id = ? AND node_type = 'capability' ORDER BY CASE WHEN lower(title) LIKE '%性能%' OR lower(title) LIKE '%数据%' OR lower(title) LIKE '%后端%' THEN 0 ELSE 1 END, position LIMIT 1").get(plan.roadmap_id) as Row | undefined
          if (!parent) throw new LabError('plan_adjustment_invalid_output', '当前路线没有可承载实验的能力分支', 409)
          const position = number(this.db.prepare('SELECT COALESCE(MAX(position), 0) + 1 AS position FROM roadmap_nodes WHERE roadmap_id = ?').get(plan.roadmap_id) as Row, 'position')
          const nodeId = randomUUID()
          this.db.prepare('INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, exercise_profile_key, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 120, 1, ?, ?, ?, ?, NULL, ?)').run(nodeId, plan.roadmap_id, text(parent, 'id'), capability.planningKey, capability.learningMode === 'lab' ? 'lab' : 'concept', capability.displayName, `由你请求并经规划助手确认后加入的${capability.displayName}。`, JSON.stringify({ keyPoints: [capability.displayName] }), '完成案例要求的观察、修改或验证。', position, capability.learningMode, capability.capabilityKey, capability.exerciseProfileKey, now)
          this.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, completed_at, verified_at, revision, updated_at) VALUES (?, ?, 'available', 'plan_adjustment', NULL, NULL, 1, ?)").run(plan.roadmap_id, nodeId, now)
          this.db.prepare("INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, 'roadmap_adjusted', ?, ?)").run(randomUUID(), learnerId, plan.roadmap_id, nodeId, JSON.stringify({ adjustmentId: adjustment.id, capabilityKey: capability.planningKey }), now)
        }
      }
      const nodeRows = this.db.prepare("SELECT n.*, COALESCE(p.status, 'locked') AS progress_status FROM roadmap_nodes n LEFT JOIN roadmap_node_progress p ON p.roadmap_id = n.roadmap_id AND p.node_id = n.id WHERE n.roadmap_id = ? AND n.node_key IN (" + desired.map(() => '?').join(',') + ')').all(plan.roadmap_id, ...desired) as Row[]
      const nodes = new Map(nodeRows.map((node) => [text(node, 'node_key'), node]))
      if (nodes.size !== desired.length || [...nodes.values()].some((node) => !['concept', 'lab', 'project'].includes(text(node, 'node_type')) || (text(node, 'progress_status') === 'locked' && !units.some((unit) => text(unit, 'node_key') === text(node, 'node_key'))))) throw new LabError('plan_adjustment_invalid_output', '调整草案包含不可执行节点', 409)
      const protectedUnits = units.filter((unit) => text(unit, 'status') === 'completed' || Boolean(unit.has_practice)); const protectedKeys = new Set(protectedUnits.map((unit) => text(unit, 'node_key')))
      const missingProtected = [...protectedKeys].filter((key) => !desired.includes(key) && !units.some((unit) => text(unit, 'status') === 'completed' && text(unit, 'node_key') === key))
      if (missingProtected.length > 0) throw new LabError('plan_adjustment_protected_unit', '调整不能删除已完成或已有实践证据的单元', 409)
      const changed = this.db.prepare("UPDATE learning_plans SET revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'active' AND revision = ?").run(now, adjustment.planId, learnerId, adjustment.basePlanRevision)
      if (changed.changes === 0) throw new LabError('plan_revision_conflict', '计划已经更新，请刷新后重新生成调整', 409)
      this.db.prepare("UPDATE plan_units SET status = 'upcoming' WHERE plan_id = ? AND status = 'current' AND id NOT IN (SELECT id FROM plan_units WHERE plan_id = ? AND status = 'completed')").run(adjustment.planId, adjustment.planId)
      const desiredSet = new Set(desired)
      for (const unit of units) if (!protectedKeys.has(text(unit, 'node_key')) && !desiredSet.has(text(unit, 'node_key'))) {
        this.db.prepare('UPDATE plan_start_decisions SET plan_unit_id = NULL WHERE plan_id = ? AND plan_unit_id = ?').run(adjustment.planId, text(unit, 'id'))
        this.db.prepare('DELETE FROM plan_units WHERE id = ? AND plan_id = ?').run(text(unit, 'id'), adjustment.planId)
      }
      const refreshed = this.db.prepare('SELECT u.id, n.node_key FROM plan_units u INNER JOIN roadmap_nodes n ON n.id = u.roadmap_node_id WHERE u.plan_id = ?').all(adjustment.planId) as Row[]; const byKey = new Map(refreshed.map((unit) => [text(unit, 'node_key'), text(unit, 'id')]))
      const insert = this.db.prepare('INSERT INTO plan_units(id, plan_id, roadmap_node_id, position, title, objective, case_id, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, \'[]\')')
      desired.forEach((key, index) => { const node = nodes.get(key)!; const existingId = byKey.get(key); if (existingId) this.db.prepare('UPDATE plan_units SET position = ?, title = ?, objective = ?, case_id = ?, status = ?, availability = \'available\', learning_mode = ?, estimated_minutes = ?, rationale = ? WHERE id = ? AND plan_id = ?').run(index + 1, text(node, 'title'), text(node, 'summary'), node.case_id ?? null, index === 0 ? 'current' : 'upcoming', text(node, 'learning_mode'), number(node, 'estimated_minutes'), adjustment.proposal.rationale.join(' '), existingId, adjustment.planId); else { const unitId = randomUUID(); insert.run(unitId, adjustment.planId, text(node, 'id'), index + 1, text(node, 'title'), text(node, 'summary'), node.case_id ?? null, index === 0 ? 'current' : 'upcoming', 'available', text(node, 'learning_mode'), number(node, 'estimated_minutes'), adjustment.proposal.rationale.join(' ')); byKey.set(key, unitId) } })
      const startId = byKey.get(desired[0]); const startNode = nodes.get(desired[0])!
      const decision = this.db.prepare('SELECT id FROM plan_start_decisions WHERE plan_id = ?').get(adjustment.planId) as Row | undefined
      if (decision) this.db.prepare("UPDATE plan_start_decisions SET roadmap_node_id = ?, plan_unit_id = ?, source = 'learner_selected', rationale_snapshot_json = ?, plan_revision = ?, created_at = ? WHERE plan_id = ?").run(text(startNode, 'id'), startId, JSON.stringify(adjustment.proposal), number(plan, 'revision') + 1, now, adjustment.planId)
      else this.db.prepare('INSERT INTO plan_start_decisions(id, learner_id, plan_id, roadmap_id, roadmap_node_id, plan_unit_id, source, rationale_snapshot_json, plan_revision, created_at) VALUES (?, ?, ?, ?, ?, ?, \'learner_selected\', ?, ?, ?)').run(randomUUID(), learnerId, adjustment.planId, plan.roadmap_id, text(startNode, 'id'), startId, JSON.stringify(adjustment.proposal), number(plan, 'revision') + 1, now)
      this.db.prepare("UPDATE plan_adjustments SET status = 'confirmed', confirmed_at = ?, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'ready'").run(now, now, id, learnerId)
      this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, ?, NULL, \'plan_adjusted\', ?, ?)').run(randomUUID(), learnerId, adjustment.planId, startId, JSON.stringify({ adjustmentId: id, unitKeys: desired }), now)
    })
    tx(); return this.repository.getPlanForLearner(adjustment.planId, learnerId)
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

  private hasPythonListIntent(value: string): boolean {
    return /(python\s*list|python\s*列表|python.*列表|列表|list|切片|可变性)/i.test(value)
  }

  private recommendedGym(session: AgentPlanningSession, context: PlanningContextPacket | null) {
    const facts = context?.explicitFacts ?? []
    const evidenceText = facts.map((item) => item.content).join(' ')
    const allText = `${session.goal} ${evidenceText}`
    const explicit = this.practiceEnvironments.recommend(allText)
    if (explicit) return explicit
    const backendGoal = /(后端|backend)/i.test(session.goal)
    const trustedBackendEvidence = facts.some((item) => item.sourceRefs.some((reference) => reference.startsWith('resume:')) && /(后端|服务|接口|数据库|mysql|性能|系统|java|go|python)/i.test(item.content))
    return backendGoal && trustedBackendEvidence ? this.practiceEnvironments.get('mysql.slow-query-index') : null
  }

  private addGymCandidate(plan: RoadmapPlan, session: AgentPlanningSession, context: PlanningContextPacket | null): RoadmapPlan {
    const capability = this.recommendedGym(session, context)
    if (!capability) return plan
    const nodes = [...plan.nodes]
    let gym = nodes.find((node) => node.caseIntent === capability.caseIntent) ?? null
    if (!gym) {
      const parent = nodes.find((node) => node.type === 'capability' && /(数据|性能|数据库|稳定|后端|data|performance)/i.test(`${node.key} ${node.title}`)) ?? nodes.find((node) => node.type === 'capability')
      if (!parent) return plan
      gym = {
        key: capability.planningKey,
        parentKey: parent.key,
        type: capability.learningMode === 'lab' ? 'lab' : 'concept',
        title: capability.displayName,
        summary: capability.agentSummary,
        points: [capability.displayName],
        standard: '完成案例要求的观察、修改或验证。',
        minutes: 120,
        priority: 1,
        mode: capability.learningMode,
        capabilityKey: capability.capabilityKey,
        exerciseProfileKey: capability.exerciseProfileKey,
        caseIntent: capability.caseIntent,
        contextKeys: context?.explicitFacts.filter((item) => item.sourceRefs.some((reference) => reference.startsWith('resume:')) || item.key === 'goal').slice(0, 4).map((item) => item.key) ?? ['goal'],
      }
      nodes.push(gym)
    }
    const baseProposal = plan.executionProposal ?? { recommendedUnitKey: plan.unitKeys[0], options: [{ unitKey: plan.unitKeys[0], rationale: ['基于当前目标和已确认信息安排。'], orderedInitialUnitKeys: plan.unitKeys.slice(0, 4) }] }
    const alreadyOffered = baseProposal.options.some((option) => option.unitKey === gym!.key)
    const gymOption: ExecutionProposalOption = {
      unitKey: gym.key,
      rationale: ['目标与可信经历显示这里适合作为近期实践起点。', `该起点使用已注册的${capability.displayName}，并要求用真实执行结果验证。`],
      orderedInitialUnitKeys: [gym.key],
    }
    const options = alreadyOffered ? baseProposal.options : [...baseProposal.options.slice(0, 2), gymOption]
    const explicitMatch = this.practiceEnvironments.recommend(`${session.goal} ${(context?.explicitFacts ?? []).map((item) => item.content).join(' ')}`)?.planningKey === capability.planningKey
    const executionProposal = { recommendedUnitKey: explicitMatch ? gym.key : baseProposal.recommendedUnitKey, options }
    if (!executionProposal.options.some((option) => option.unitKey === executionProposal.recommendedUnitKey)) executionProposal.options.unshift(gymOption)
    return { ...plan, nodes, unitKeys: [...new Set([...plan.unitKeys, gym.key])], executionProposal }
  }

  private localRoadmap(session: AgentPlanningSession, context: PlanningContextPacket | null): RoadmapPlan {
    const allText = `${session.goal} ${context?.explicitFacts.map((item) => item.content).join(' ') ?? ''}`
    const mysql = this.hasMysqlIntent(allText) && this.practiceEnvironments.get('mysql.slow-query-index') != null
    const pythonList = this.hasPythonListIntent(allText) && this.practiceEnvironments.get('python.collections.list') != null
    const focus = context?.currentFocus || session.goal
    const nodes: RoadmapPlan['nodes'] = [{ key: 'goal', parentKey: null, type: 'domain', title: session.goal.slice(0, 120), summary: '从当前目标出发组织后续能力与实践。', points: ['目标', '约束', '产出'], standard: '能够说明当前目标、现实约束和阶段性产出。', minutes: 60, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: ['goal'] }]
    if (mysql) {
      nodes.push({ key: 'mysql-performance', parentKey: 'goal', type: 'capability', title: '数据访问与性能', summary: focus.slice(0, 500), points: ['现象', '执行计划', '验证'], standard: '能从真实现象出发说明判断、尝试和验证。', minutes: 120, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: [] })
      nodes.push({ key: 'mysql-slow-query', parentKey: 'mysql-performance', type: 'lab', title: 'MySQL 慢查询与索引', summary: '通过真实实验观察慢查询，使用 EXPLAIN 和索引验证优化判断。', points: ['慢查询', 'EXPLAIN', '索引'], standard: '完成一次慢查询排查，并用实验结果验证优化判断。', minutes: 120, priority: 1, mode: 'lab', capabilityKey: 'mysql.slow-query', caseIntent: 'mysql.slow-query-index', contextKeys: [] })
      return { nodes, unitKeys: ['mysql-slow-query'], dependencies: [], executionProposal: null }
    }
    if (pythonList) {
      nodes.push({ key: 'python-collections', parentKey: 'goal', type: 'capability', title: 'Python 容器与数据操作', summary: focus.slice(0, 500), points: ['创建', '索引', '切片', '可变性'], standard: '能在代码中正确创建、读取、切片和修改 list，并通过测试说明行为。', minutes: 90, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: [] })
      nodes.push({ key: 'python-list', parentKey: 'python-collections', type: 'concept', title: 'Python list：创建、索引、切片与可变性', summary: '通过一个可运行案例观察 list 的创建、索引、切片和原地修改。', points: ['创建', '索引', '切片', '可变性'], standard: '完成 Python list 工作区案例，并能解释测试结果。', minutes: 120, priority: 1, mode: 'workspace', capabilityKey: 'python.collections.list', caseIntent: 'python.collections.list', contextKeys: [] })
      return { nodes, unitKeys: ['python-list'], dependencies: [], executionProposal: null }
    }
    nodes.push({ key: 'current-focus', parentKey: 'goal', type: 'concept', title: '当前重点', summary: focus.slice(0, 500), points: ['理解问题', '形成方法', '完成产出'], standard: '能围绕当前目标完成一个可回看的最小学习产出。', minutes: 120, priority: 1, mode: 'knowledge', capabilityKey: null, caseIntent: null, contextKeys: [] })
    return { nodes, unitKeys: ['current-focus'], dependencies: [], executionProposal: null }
  }

  private normalizeRoadmap(plan: RoadmapPlan, session: AgentPlanningSession, context: PlanningContextPacket | null): RoadmapPlan {
    const allText = `${session.goal} ${context?.explicitFacts.map((item) => item.content).join(' ') ?? ''} ${context?.recentMessages.map((item) => item.content).join(' ') ?? ''}`
    const mysql = this.hasMysqlIntent(allText)
    const pythonList = this.hasPythonListIntent(allText)
    const withGym = this.addGymCandidate(plan, session, context)
    const nodes = [...withGym.nodes]
    const keys = new Set<string>()
    for (const node of nodes) {
      if (keys.has(node.key)) throw new PlanningAgentError('roadmap_duplicate_node', `路线节点重复：${node.key}`, false)
      keys.add(node.key)
      if (node.parentKey === node.key || (node.parentKey && !keys.has(node.parentKey) && !nodes.some((candidate) => candidate.key === node.parentKey))) throw new PlanningAgentError('roadmap_invalid_parent', `路线节点父级不存在：${node.parentKey ?? ''}`, false)
    }
    if (!nodes.some((node) => node.parentKey === null)) throw new PlanningAgentError('roadmap_no_root', '路线没有根节点', false)
    if (mysql && this.practiceEnvironments.get('mysql.slow-query-index') && !nodes.some((node) => node.caseIntent === 'mysql.slow-query-index')) throw new PlanningAgentError('roadmap_missing_capability', '上下文包含 MySQL 慢查询意图，但模型没有生成对应实验节点', true)
    if (pythonList && this.practiceEnvironments.get('python.collections.list') && !nodes.some((node) => node.caseIntent === 'python.collections.list')) throw new PlanningAgentError('roadmap_missing_capability', '上下文包含 Python list 意图，但模型没有生成对应工作区节点', true)
    const invalidUnitKeys = withGym.unitKeys.filter((key) => {
      const node = nodes.find((candidate) => candidate.key === key)
      return !node || node.type === 'domain' || node.type === 'capability'
    })
    if (invalidUnitKeys.length > 0) throw new PlanningAgentError('roadmap_unit_not_actionable', `路线单元必须指向具体学习节点：${invalidUnitKeys.join(', ')}`, true)
    const unitKeys = [...new Set(withGym.unitKeys.filter((key) => nodes.some((node) => node.key === key)))]
    if (unitKeys.length === 0) throw new PlanningAgentError('roadmap_no_units', '路线没有可执行的学习单元', false)
    return { nodes: nodes.map((node) => {
      const capability = node.caseIntent ? this.practiceEnvironments.get(node.caseIntent) : node.capabilityKey ? this.practiceEnvironments.byCapability(node.capabilityKey) : null
      if (capability) return { ...node, type: capability.learningMode === 'lab' ? 'lab' as const : node.type, mode: capability.learningMode, capabilityKey: capability.capabilityKey, exerciseProfileKey: capability.exerciseProfileKey, caseIntent: capability.caseIntent }
      if (node.mode === 'lab' || node.mode === 'workspace') return { ...node, type: 'concept' as const, mode: 'knowledge' as const, capabilityKey: null, caseIntent: null }
      return node
    }), unitKeys: [...new Set(unitKeys)], dependencies: withGym.dependencies.filter((item) => nodes.some((node) => node.key === item.nodeKey) && nodes.some((node) => node.key === item.dependsOnKey)), executionProposal: withGym.executionProposal }
  }

  private async buildRoadmap(learnerId: string, sessionId: string, generationId: string, inputFingerprint: string): Promise<void> {
    const now = new Date().toISOString(); const claimed = this.db.prepare("UPDATE roadmap_generation_runs SET status = 'running', phase = 'domain', attempt_count = attempt_count + 1, updated_at = ? WHERE id = ? AND status = 'queued'").run(now, generationId)
    if (claimed.changes === 0) return
    const attemptRow = this.db.prepare('SELECT attempt_count FROM roadmap_generation_runs WHERE id = ?').get(generationId) as Row
    const attemptCount = number(attemptRow, 'attempt_count')
    const startedAt = Date.now()
    let currentPhase: RoadmapPhase | null = null
    let currentScope: string | null = null
    const phaseAttempts = new Map<string, number>()
    const recordPhase = (event: RoadmapPhaseEvent) => {
      const timestamp = new Date().toISOString()
      const scope = event.scopeKey ?? null
      const attemptKey = `${event.phase}:${scope ?? ''}`
      if (event.status === 'started') {
        const previous = this.db.prepare('SELECT COALESCE(MAX(attempt_no), 0) AS attempt_no FROM roadmap_generation_phase_attempts WHERE generation_run_id = ? AND phase = ? AND scope_key IS ?').get(generationId, event.phase, scope) as Row
        const attemptNo = number(previous, 'attempt_no') + 1
        phaseAttempts.set(attemptKey, attemptNo)
        this.db.prepare('INSERT INTO roadmap_generation_phase_attempts(id, generation_run_id, phase, scope_key, attempt_no, status, input_fingerprint, output_json, validation_issues_json, provider, model, started_at, created_at, updated_at) VALUES (?, ?, ?, ?, ?, \'running\', ?, \'{}\', \'[]\', ?, ?, ?, ?, ?)').run(randomUUID(), generationId, event.phase, scope, attemptNo, fingerprint({ inputFingerprint, phase: event.phase, scopeKey: scope }), this.provider.providerName, this.provider.modelName, timestamp, timestamp, timestamp)
        this.db.prepare("INSERT INTO roadmap_generation_steps(id, generation_run_id, phase, input_fingerprint, status, output_json, created_at, updated_at) VALUES (?, ?, ?, ?, 'running', '{}', ?, ?) ON CONFLICT(generation_run_id, phase) DO UPDATE SET status = 'running', input_fingerprint = excluded.input_fingerprint, output_json = '{}', failure_message = NULL, updated_at = excluded.updated_at").run(randomUUID(), generationId, event.phase, fingerprint({ inputFingerprint, phase: event.phase, scopeKey: scope, attemptCount }), timestamp, timestamp)
        this.db.prepare("UPDATE roadmap_generation_runs SET phase = ?, scope_key = ?, updated_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(event.phase, scope, timestamp, generationId, attemptCount)
        currentPhase = event.phase
        currentScope = scope
      } else {
        const attemptNo = phaseAttempts.get(attemptKey)
        if (attemptNo != null) this.db.prepare('UPDATE roadmap_generation_phase_attempts SET status = ?, output_json = ?, latency_ms = ?, completed_at = ?, updated_at = ? WHERE generation_run_id = ? AND phase = ? AND scope_key IS ? AND attempt_no = ? AND status = \'running\'').run(event.status === 'succeeded' ? 'succeeded' : 'failed', JSON.stringify(event.output ?? {}), Date.now() - startedAt, timestamp, timestamp, generationId, event.phase, scope, attemptNo)
        this.db.prepare("UPDATE roadmap_generation_steps SET status = ?, output_json = ?, updated_at = ? WHERE generation_run_id = ? AND phase = ?").run(event.status, JSON.stringify(event.output ?? {}), timestamp, generationId, event.phase)
      }
    }
    try {
      const session = this.getSession(learnerId, sessionId); const context = this.contextCompiler.current(learnerId, sessionId); const generationRow = this.db.prepare('SELECT diagnostics_json FROM roadmap_generation_runs WHERE id = ?').get(generationId) as Row | undefined; const generationConfig = json<{ replaceCurrent?: boolean; targetPlanId?: string | null; targetRoadmapId?: string | null; phase?: RoadmapPhase; scopeKey?: string | null }>(generationRow?.diagnostics_json, {}); const cached = this.generationCache(generationId, generationConfig)
      let generated: RoadmapPlan
      if (this.provider.generateRoadmap) generated = await this.provider.generateRoadmap({ goal: session.goal, messages: session.messages, context, cached, onPhase: recordPhase, practiceEnvironments: this.practiceEnvironments.agentContext() })
      else {
        for (const phase of ['domain', 'module', 'unit', 'critic'] as const) { recordPhase({ phase, status: 'started' }); recordPhase({ phase, status: 'succeeded', output: {} }) }
        generated = this.localRoadmap(session, context)
      }
      const plan = this.normalizeRoadmap(generated, session, context)
      const roadmapId = randomUUID(); const generatedAt = new Date().toISOString(); const tx = this.db.transaction(() => {
        this.db.prepare("INSERT INTO learning_roadmaps(id, learner_id, template_key, goal, status, revision, input_snapshot_json, execution_proposal_json, based_on_roadmap_id, created_at, updated_at) VALUES (?, ?, 'agent-roadmap-v2', ?, 'draft', 1, ?, ?, ?, ?, ?)").run(roadmapId, learnerId, session.goal, JSON.stringify({ sessionId, profileSnapshotId: session.profile?.id ?? null, contextSnapshotId: context?.snapshotId ?? null, mode: 'agent', generatorVersion: 'agent-roadmap-v2', inputFingerprint, unitKeys: plan.unitKeys }), JSON.stringify(plan.executionProposal), generationConfig.replaceCurrent ? generationConfig.targetRoadmapId ?? null : null, generatedAt, generatedAt)
        const ids = new Map<string, string>(); const remaining = new Map(plan.nodes.map((node, index) => [node.key, { node, index }])); const ordered: Array<{ node: RoadmapPlan['nodes'][number]; index: number }> = []
        while (remaining.size > 0) { const next = [...remaining.values()].find(({ node }) => node.parentKey === null || ids.has(node.parentKey)); if (!next) throw new PlanningAgentError('roadmap_cycle', '路线节点存在循环依赖', false); ordered.push(next); ids.set(next.node.key, randomUUID()); remaining.delete(next.node.key) }
        const insertNode = this.db.prepare('INSERT INTO roadmap_nodes(id, roadmap_id, parent_id, node_key, node_type, title, summary, knowledge_card_json, completion_standard, estimated_minutes, priority, position, learning_mode, capability_key, exercise_profile_key, case_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)')
        const activeKeys = new Set(plan.unitKeys)
        for (const item of ordered) { const node = item.node; const parent = node.parentKey ? ids.get(node.parentKey) ?? null : null; const capability = node.caseIntent ? this.practiceEnvironments.get(node.caseIntent) : node.capabilityKey ? this.practiceEnvironments.byCapability(node.capabilityKey) : null; const mode = capability?.learningMode ?? node.mode; const capabilityKey = capability?.capabilityKey ?? node.capabilityKey ?? null; const exerciseProfileKey = capability?.exerciseProfileKey ?? node.exerciseProfileKey ?? null; if (capability) activeKeys.add(node.key); insertNode.run(ids.get(node.key), roadmapId, parent, node.key, node.type, node.title, node.summary, JSON.stringify({ keyPoints: node.points, contextKeys: node.contextKeys, caseIntent: capability?.caseIntent ?? node.caseIntent }), node.standard, node.minutes, node.priority, item.index + 1, mode, capabilityKey, exerciseProfileKey, generatedAt) }
        const insertProgress = this.db.prepare("INSERT INTO roadmap_node_progress(roadmap_id, node_id, status, source, completed_at, verified_at, revision, updated_at) VALUES (?, ?, ?, 'agent', NULL, NULL, 1, ?)")
        for (const item of ordered) { let available = item.node.parentKey === null || activeKeys.has(item.node.key); let parent = item.node.parentKey; while (parent) { if (activeKeys.has(parent)) available = true; parent = plan.nodes.find((node) => node.key === parent)?.parentKey ?? null }; insertProgress.run(roadmapId, ids.get(item.node.key), available ? 'available' : 'locked', generatedAt) }
        const insertDependency = this.db.prepare('INSERT OR IGNORE INTO roadmap_node_dependencies(roadmap_id, node_id, depends_on_node_id) VALUES (?, ?, ?)'); for (const dependency of plan.dependencies) { if (ids.has(dependency.nodeKey) && ids.has(dependency.dependsOnKey)) insertDependency.run(roadmapId, ids.get(dependency.nodeKey), ids.get(dependency.dependsOnKey)) }
        const insertEvidence = this.db.prepare('INSERT OR IGNORE INTO roadmap_node_evidence(id, roadmap_id, node_id, source_type, source_id, excerpt, position, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
        for (const item of ordered) { const contextKeys = new Set(item.node.contextKeys); if (item.node.key === 'goal') contextKeys.add('goal'); const evidence = (context?.explicitFacts ?? []).filter((fact) => contextKeys.has(fact.key)); evidence.forEach((fact, position) => { insertEvidence.run(randomUUID(), roadmapId, ids.get(item.node.key), 'planning_context', fact.id, fact.content.slice(0, 2000), position + 1, generatedAt) }) }
        if (generationConfig.replaceCurrent) {
          const targetPlanId = generationConfig.targetPlanId
          const targetRoadmapId = generationConfig.targetRoadmapId
          const current = targetPlanId && targetRoadmapId ? this.db.prepare("SELECT id, roadmap_id FROM learning_plans WHERE id = ? AND learner_id = ? AND status = 'active'").get(targetPlanId, learnerId) as Row | undefined : undefined
          if (!current || text(current, 'roadmap_id') !== targetRoadmapId) throw new PlanningAgentError('roadmap_replace_target_changed', '当前路线在生成期间已经发生变化，请重新执行修复', true)
          this.db.prepare("UPDATE learning_roadmaps SET status = 'archived', updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'active'").run(generatedAt, targetRoadmapId, learnerId)
          this.db.prepare("UPDATE learning_roadmaps SET status = 'active', updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'draft'").run(generatedAt, roadmapId, learnerId)
          this.db.prepare("UPDATE learning_plans SET roadmap_id = ?, revision = revision + 1, updated_at = ? WHERE id = ? AND learner_id = ? AND status = 'active'").run(roadmapId, generatedAt, targetPlanId, learnerId)
          this.db.prepare('UPDATE plan_start_decisions SET plan_unit_id = NULL WHERE plan_id = ? AND plan_unit_id NOT IN (SELECT DISTINCT plan_unit_id FROM practice_runs WHERE plan_unit_id IS NOT NULL)').run(targetPlanId)
          this.db.prepare('DELETE FROM plan_units WHERE plan_id = ? AND id NOT IN (SELECT DISTINCT plan_unit_id FROM practice_runs WHERE plan_unit_id IS NOT NULL)').run(targetPlanId)
          const insertReplacementUnit = this.db.prepare('INSERT INTO plan_units(id, plan_id, roadmap_node_id, position, title, objective, case_id, exercise_profile_key, status, availability, learning_mode, estimated_minutes, rationale, completed_at, source_refs_json) VALUES (?, ?, ?, ?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, NULL, \'[]\')')
          const selectedReplacementNodes = plan.unitKeys.map((key) => ordered.find((item) => item.node.key === key)?.node).filter((node): node is RoadmapPlan['nodes'][number] => Boolean(node))
          selectedReplacementNodes.forEach((node, index) => insertReplacementUnit.run(randomUUID(), targetPlanId, ids.get(node.key), index + 1, node.title, node.summary, node.exerciseProfileKey ?? (node.caseIntent ? this.practiceEnvironments.get(node.caseIntent)?.exerciseProfileKey ?? null : null), index === 0 ? 'current' : 'upcoming', 'available', node.mode, node.minutes, '根据完整路线树自动切出的当前学习单元。'))
          this.db.prepare('INSERT INTO roadmap_events(id, learner_id, roadmap_id, node_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, \'roadmap_replaced\', ?, ?)').run(randomUUID(), learnerId, roadmapId, JSON.stringify({ previousRoadmapId: targetRoadmapId, planId: targetPlanId, generationId }), generatedAt)
          this.db.prepare('INSERT INTO plan_events(id, learner_id, plan_id, plan_unit_id, practice_run_id, type, payload_json, created_at) VALUES (?, ?, ?, NULL, NULL, \'plan_replanned\', ?, ?)').run(randomUUID(), learnerId, targetPlanId, JSON.stringify({ previousRoadmapId: targetRoadmapId, roadmapId, generationId }), generatedAt)
          this.db.prepare("UPDATE planning_sessions SET status = 'confirmed', agent_status = 'confirmed', updated_at = ? WHERE id = ? AND learner_id = ?").run(generatedAt, sessionId, learnerId)
        } else {
          this.db.prepare("UPDATE planning_sessions SET status = 'proposed', agent_status = 'ready', updated_at = ? WHERE id = ? AND learner_id = ?").run(generatedAt, sessionId, learnerId)
        }
        this.db.prepare("UPDATE roadmap_generation_runs SET status = 'succeeded', phase = 'completed', roadmap_id = ?, input_snapshot_json = ?, diagnostics_json = ?, updated_at = ?, completed_at = ? WHERE id = ? AND status = 'running' AND attempt_count = ?").run(roadmapId, JSON.stringify({ sessionId, unitKeys: plan.unitKeys }), JSON.stringify({ provider: this.provider.providerName, model: this.provider.modelName, phase: currentPhase, attemptCount, elapsedMs: Date.now() - startedAt, nodeCount: plan.nodes.length, unitCount: plan.unitKeys.length }), generatedAt, generatedAt, generationId, attemptCount)
      }); tx()
    } catch (error) {
      const message = error instanceof Error ? error.message : '路线生成失败'; const code = error instanceof PlanningAgentError ? error.code : 'roadmap_generation_failed'; const details = error instanceof PlanningAgentError ? error.details : {}
      const outputHashes = [details.initialOutput, details.repairedOutput].filter((value): value is string => typeof value === 'string').map((value) => fingerprint(value))
      const runConfig = json<{ replaceCurrent?: boolean; targetPlanId?: string | null; targetRoadmapId?: string | null }>((this.db.prepare('SELECT diagnostics_json FROM roadmap_generation_runs WHERE id = ?').get(generationId) as Row | undefined)?.diagnostics_json, {})
      const diagnostics = { replaceCurrent: runConfig.replaceCurrent ?? false, targetPlanId: runConfig.targetPlanId ?? null, targetRoadmapId: runConfig.targetRoadmapId ?? null, generationId, sessionId, provider: this.provider.providerName, model: this.provider.modelName, phase: currentPhase ?? 'domain', scopeKey: currentScope, attemptCount, elapsedMs: Date.now() - startedAt, code, message, responseHashes: outputHashes, details, failedAt: new Date().toISOString() }
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
