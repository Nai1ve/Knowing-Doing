import { createHash } from 'node:crypto'
import { z } from 'zod'
import type { LabConfig } from './config.js'
import type { MySqlExerciseRequest, MySqlExerciseSpec } from './product-types.js'

const promptVersion = 'case-design-v1'
const narrativeSchema = z.object({
  candidateKey: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(240),
  scenario: z.string().trim().min(1).max(4000),
  learningGoal: z.string().trim().min(1).max(1200),
  tasks: z.array(z.object({ key: z.string().trim().min(1).max(80), instruction: z.string().trim().min(1).max(1000), expectedObservation: z.string().trim().min(1).max(1000) })).min(2).max(5),
  verification: z.object({ signals: z.array(z.string().trim().min(1).max(200)).min(1).max(8) }),
  tutorContext: z.object({ concepts: z.array(z.string().trim().min(1).max(200)).min(1).max(8), likelyMisconceptions: z.array(z.string().trim().min(1).max(300)).max(8), evidenceToNotice: z.array(z.string().trim().min(1).max(300)).min(1).max(8) }),
})

const contract = JSON.stringify({
  candidateKey: '一个输入 candidates 中的 key',
  title: '案例标题', scenario: '场景叙事，不含 SQL、DDL、Docker 或答案', learningGoal: '可验证的学习目标',
  tasks: [{ key: 'observe', instruction: '引导用户使用平台提供的操作观察现象', expectedObservation: '要记录的现象' }, { key: 'compare', instruction: '引导用户验证假设', expectedObservation: '前后差异' }],
  verification: { signals: ['可观察的成功信号'] },
  tutorContext: { concepts: ['概念'], likelyMisconceptions: ['误区'], evidenceToNotice: ['需要观察的证据'] },
})

export type CaseDesignCard = {
  nodeId: string
  title: string
  summary: string
  completionStandard: string
  knowledgeCard: { keyPoints?: string[]; examples?: string[]; prerequisites?: string[] }
  evidence: Array<{ sourceType: string; sourceId: string; excerpt: string }>
  learnerProfile: Array<{ key: string; level: string; summary: string }>
}

export type CaseEnvironmentCandidate = {
  key: string
  capabilityKey: string
  environmentKey: string
  environmentVersion: string
  runtimeKind: string
  exerciseProfileKey: string | null
  displayName: string
  summary: string
}

export type CaseDesignAttempt = { phase: 'design' | 'repair'; status: 'running' | 'succeeded' | 'failed'; rawOutput?: string; validationIssues?: unknown[]; failureCode?: string; failureMessage?: string; latencyMs?: number }
export interface CaseDesignProvider {
  readonly modelName: string
  design(input: { card: CaseDesignCard; candidates: CaseEnvironmentCandidate[]; materializationByCandidate: Record<string, MySqlExerciseRequest> }, onAttempt?: (event: CaseDesignAttempt) => void): Promise<{ candidate: CaseEnvironmentCandidate; spec: MySqlExerciseSpec; rawDesign: string }>
  fingerprint(value: unknown): string
}

export class CaseDesignError extends Error {
  constructor(public readonly code: string, message: string, public readonly details: Record<string, unknown> = {}) { super(message); this.name = 'CaseDesignError' }
}

function content(payload: unknown): string {
  const value = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]?.message?.content
  return typeof value === 'string' ? value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '') : ''
}
function zodIssues(error: z.ZodError) { return error.issues.map((issue) => ({ path: issue.path.join('.'), code: issue.code, message: issue.message })) }
function parse(raw: string) {
  try {
    const parsed = narrativeSchema.safeParse(JSON.parse(raw))
    return parsed.success ? { value: parsed.data, issues: [] } : { value: null, issues: zodIssues(parsed.error) }
  } catch (error) { return { value: null, issues: [{ path: '', code: 'invalid_json', message: error instanceof Error ? error.message : 'invalid_json' }] } }
}

/**
 * Designs a case from a frozen card and platform-owned environment candidates.
 * It may choose a candidate, never infrastructure, SQL, or unrestricted assets.
 */
export class CaseDesignAgent implements CaseDesignProvider {
  readonly providerName = 'model' as const
  readonly modelName: string
  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) { this.modelName = config.modelName }

  private async call(system: string, input: unknown): Promise<{ raw: string; latencyMs: number }> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new CaseDesignError('model_not_configured', 'Case Agent 未配置模型')
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.modelTimeoutMs); const started = Date.now()
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` }, body: JSON.stringify({ model: this.config.modelName, temperature: 0.2, stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(input) }] }) })
      if (!response.ok) throw new CaseDesignError(`model_http_${response.status}`, `Case Agent 返回 HTTP ${response.status}`)
      const raw = content(await response.json())
      if (!raw) throw new CaseDesignError('model_empty_output', 'Case Agent 没有返回内容')
      return { raw, latencyMs: Date.now() - started }
    } catch (error) {
      if (error instanceof CaseDesignError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new CaseDesignError('model_timeout', 'Case Agent 请求超时')
      throw new CaseDesignError('model_request_failed', error instanceof Error ? error.message : 'Case Agent 请求失败')
    } finally { clearTimeout(timer) }
  }

  async design(input: { card: CaseDesignCard; candidates: CaseEnvironmentCandidate[]; materializationByCandidate: Record<string, MySqlExerciseRequest> }, onAttempt?: (event: CaseDesignAttempt) => void): Promise<{ candidate: CaseEnvironmentCandidate; spec: MySqlExerciseSpec; rawDesign: string }> {
    if (input.candidates.length === 0) throw new CaseDesignError('environment_unavailable', '当前学习卡片没有可用的实践环境')
    const payload = { card: input.card, candidates: input.candidates.map(({ key, capabilityKey, environmentKey, environmentVersion, runtimeKind, exerciseProfileKey, displayName, summary }) => ({ key, capabilityKey, environmentKey, environmentVersion, runtimeKind, exerciseProfileKey, displayName, summary })) }
    const system = `你是知行通用 Case Agent。你只能从 candidates 中选择一个环境，并围绕冻结学习卡片设计案例。平台负责 Docker、SQL、数据集、故障注入和参考答案。不得输出 Docker、镜像、网络、权限、密钥、SQL、DDL、任意脚本或参考答案。只返回完整 JSON，严格符合：${contract}`
    onAttempt?.({ phase: 'design', status: 'running' })
    let first: { raw: string; latencyMs: number }
    try { first = await this.call(system, payload) } catch (error) {
      const failure = error instanceof CaseDesignError ? error : new CaseDesignError('model_request_failed', 'Case Agent 请求失败')
      onAttempt?.({ phase: 'design', status: 'failed', failureCode: failure.code, failureMessage: failure.message })
      throw failure
    }
    const firstParsed = parse(first.raw)
    if (firstParsed.value) return this.accept(firstParsed.value, first.raw, first.latencyMs, input, onAttempt)
    onAttempt?.({ phase: 'design', status: 'failed', rawOutput: first.raw, validationIssues: firstParsed.issues, failureCode: 'structured_output_invalid', failureMessage: 'Case Agent 初稿未通过 JSON 合约校验', latencyMs: first.latencyMs })
    onAttempt?.({ phase: 'repair', status: 'running' })
    let repaired: { raw: string; latencyMs: number }
    try { repaired = await this.call(`${system} 你正在修复无效初稿。只返回符合完整合约的 JSON。`, { payload, draft: first.raw, validationIssues: firstParsed.issues, contract }) } catch (error) {
      const failure = error instanceof CaseDesignError ? error : new CaseDesignError('model_request_failed', 'Case Agent 修复请求失败')
      onAttempt?.({ phase: 'repair', status: 'failed', failureCode: failure.code, failureMessage: failure.message })
      throw failure
    }
    const repairedParsed = parse(repaired.raw)
    if (repairedParsed.value) return this.accept(repairedParsed.value, repaired.raw, repaired.latencyMs, input, onAttempt, 'repair')
    onAttempt?.({ phase: 'repair', status: 'failed', rawOutput: repaired.raw, validationIssues: repairedParsed.issues, failureCode: 'structured_output_invalid', failureMessage: 'Case Agent 修复稿未通过 JSON 合约校验', latencyMs: repaired.latencyMs })
    throw new CaseDesignError('case_design_invalid_output', 'Case Agent 输出无法通过结构校验', { initialOutput: first.raw, initialIssues: firstParsed.issues, repairedOutput: repaired.raw, repairIssues: repairedParsed.issues })
  }

  private accept(value: z.infer<typeof narrativeSchema>, raw: string, latencyMs: number, input: { candidates: CaseEnvironmentCandidate[]; materializationByCandidate: Record<string, MySqlExerciseRequest> }, onAttempt?: (event: CaseDesignAttempt) => void, phase: 'design' | 'repair' = 'design') {
    const candidate = input.candidates.find((item) => item.key === value.candidateKey)
    const request = candidate ? input.materializationByCandidate[candidate.key] : null
    if (!candidate || !request || !candidate.exerciseProfileKey) {
      const issues = [{ path: 'candidateKey', code: 'unregistered_environment', message: 'Agent 选择了目录外的环境。' }]
      onAttempt?.({ phase, status: 'failed', rawOutput: raw, validationIssues: issues, failureCode: 'environment_selection_invalid', failureMessage: 'Case Agent 选择了未注册环境', latencyMs })
      throw new CaseDesignError('environment_selection_invalid', 'Case Agent 选择了未注册环境', { validationIssues: issues })
    }
    const spec: MySqlExerciseSpec = { specVersion: 3, kind: 'mysql_data_diagnosis', capabilityKey: request.capabilityKey, exerciseProfileKey: candidate.exerciseProfileKey, materialization: request, title: value.title, scenario: value.scenario, learningGoal: value.learningGoal, tasks: value.tasks, verification: value.verification, tutorContext: value.tutorContext }
    onAttempt?.({ phase, status: 'succeeded', rawOutput: raw, latencyMs })
    return { candidate, spec, rawDesign: raw }
  }

  fingerprint(value: unknown): string { return createHash('sha256').update(JSON.stringify(value)).digest('hex') }
}
