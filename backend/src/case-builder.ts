import { createHash } from 'node:crypto'
import type { CaseRequest, CaseSpec, SourceItem } from './product-types.js'
import { parseCaseGenerationOutput, parseCaseSpec } from './case-schemas.js'
import type { LabConfig } from './config.js'
import { resolveEnvironmentCommand } from './environment-registry.js'
import type { CaseBlueprint, CaseIntent, ReferenceSolution } from './product-types.js'

export type CaseBuilderAttemptPhase = 'intent' | 'blueprint' | 'generate' | 'repair'
export type CaseBuilderAttemptStatus = 'running' | 'succeeded' | 'failed'
export interface CaseBuilderContext {
  roadmapNode: { id: string; title: string; summary: string; completionStandard: string; capabilityKey: string }
  roadmapRationale: Array<{ sourceType: string; sourceId: string; excerpt: string }>
  learnerProfile: { snapshotId: string | null; dimensions: Array<{ key: string; level: string; confidence: number; summary: string }> }
}

export interface CaseBuilderAttemptEvent {
  phase: CaseBuilderAttemptPhase
  status: CaseBuilderAttemptStatus
  modelName?: string
  promptVersion?: string
  contextFingerprint?: string
  responseFingerprint?: string
  diagnostics?: Record<string, unknown>
}

export interface CaseBuilderInput {
  request: CaseRequest
  source: SourceItem | null
  context?: CaseBuilderContext
  onAttempt?: (event: CaseBuilderAttemptEvent) => void
  onReferenceSolution?: (solution: ReferenceSolution) => void
}

export interface CaseBuilderProvider {
  readonly providerName: 'fixture' | 'model'
  readonly modelName?: string
  readonly staged?: boolean
  build(input: CaseBuilderInput): Promise<CaseSpec>
}

export class CaseBuilderError extends Error {
  constructor(public readonly code: string, message = code) { super(message); this.name = 'CaseBuilderError' }
}

export class FixtureCaseBuilder implements CaseBuilderProvider {
  readonly providerName = 'fixture' as const

  async build(input: CaseBuilderInput): Promise<CaseSpec> {
    const context = input.request.input.kind === 'brief'
      ? input.request.input.brief ?? '完成一次 Python 测试修复实践。'
      : `参考材料：${input.source?.title ?? '已选知乎材料'}\n${input.source?.excerpt ?? ''}`
    return parseCaseSpec({
      title: '订单汇总器中的边界条件修复',
      scenario: `你接手了一个负责汇总订单金额的 Python 小模块。当前实现可以处理大多数订单，但边界条件测试失败。请先运行测试、阅读已有实现，再用最小修改修复问题。\n\n本次输入：${context.slice(0, 1200)}`,
      learningGoal: input.request.desiredOutcome?.trim() || '通过阅读代码、运行测试和小步修改，完成一次可验证的 Python 问题修复。',
      difficulty: input.request.difficulty ?? 'applied',
      environment: { key: 'python-pytest-v1', version: '1', templateKey: 'python-pytest-v1', services: [] },
      starterFiles: [
        { path: 'README.md', content: '# 订单汇总器\n\n先运行 `pytest -q`，观察失败测试，再定位实现问题。\n' },
        { path: 'src/order_summary.py', content: "from decimal import Decimal\n\ndef summarize_orders(orders: list[dict]) -> dict:\n    paid = [order for order in orders if order.get('status') == 'PAID']\n    total = sum(Decimal(str(order.get('amount', 0))) for order in paid)\n    return {'count': len(paid), 'total': str(total)}\n" },
        { path: 'tests/test_order_summary.py', content: "from src.order_summary import summarize_orders\n\ndef test_only_paid_orders_are_summarized():\n    assert summarize_orders([\n        {'status': 'PAID', 'amount': '10.50'},\n        {'status': 'PENDING', 'amount': '99.00'},\n    ]) == {'count': 1, 'total': '10.50'}\n\ndef test_missing_amount_is_not_silently_accepted():\n    assert summarize_orders([{'status': 'PAID'}]) == {'count': 0, 'total': '0'}\n" },
      ],
      tasks: [
        { key: 'observe', instruction: '运行测试并记录第一个失败现象，先不要修改代码。', recommendedCommands: ['pytest -q'], expectedObservation: '测试会指出缺少金额的 PAID 订单不应被计入。' },
        { key: 'inspect', instruction: '阅读实现与测试，说明输入缺失字段时当前逻辑如何计算。', recommendedCommands: ['pytest -q'], expectedObservation: '当前实现把缺失金额当成 0，但仍把订单计数为已支付。' },
        { key: 'fix', instruction: '用最小改动修复实现，并重新运行测试验证。', recommendedCommands: ['pytest -q'], expectedObservation: '所有测试通过，count 与 total 同时符合预期。' },
      ],
      verification: { commands: ['pytest -q'], successSignals: ['2 passed', 'passed'] },
      tutorContext: { concepts: ['边界条件', '测试驱动修复', 'Decimal 金额计算'], likelyMisconceptions: ['把测试通过当成无需理解原因', '只修 total 而忽略 count'], evidenceToNotice: ['首次失败输出', '修改前后文件差异', '最终 pytest 输出'] },
    })
  }
}

function responseContent(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
  const value = choice?.message?.content
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return value.map((part) => part && typeof part === 'object' && typeof (part as { text?: unknown }).text === 'string' ? (part as { text: string }).text : '').join('')
  return ''
}

function cleanJson(value: string): string {
  return value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function hash(value: unknown): string { return createHash('sha256').update(typeof value === 'string' ? value : JSON.stringify(value)).digest('hex') }

export class ModelCaseBuilder implements CaseBuilderProvider {
  readonly providerName = 'model' as const
  private readonly promptVersion = 'case-builder-python-v1'

  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) {}

  private async call(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<{ raw: string; responseFingerprint: string }> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new CaseBuilderError('model_not_configured', '案例模型尚未配置')
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal,
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` },
        body: JSON.stringify({ model: this.config.modelName, temperature: 0.2, stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, messages }),
      })
      if (!response.ok) throw new CaseBuilderError(`model_http_${response.status}`, `案例模型返回 HTTP ${response.status}`)
      const rawResponse = await response.json()
      const raw = cleanJson(responseContent(rawResponse))
      if (!raw) throw new CaseBuilderError('model_empty_output', '案例模型没有返回内容')
      return { raw, responseFingerprint: hash(raw) }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new CaseBuilderError('model_timeout', '案例模型请求超时')
      throw error
    } finally { clearTimeout(timer) }
  }

  async build(input: CaseBuilderInput): Promise<CaseSpec> {
    const context = JSON.stringify({ request: input.request, source: input.source, context: input.context ?? null })
    const system = '你是知行的案例构建器。只为服务端已经选定的 python-pytest-v1 环境构造真实可实践的工程案例。只输出完整 CaseSpec JSON，不输出解释、Markdown、Dockerfile、Compose、shell、镜像、宿主机路径、网络配置、密钥或未经允许的命令。environment 必须保留 key=python-pytest-v1、version=1；不得自行更换运行环境。案例必须能通过阅读代码、运行 pytest、修改代码、再次验证完成。'
    const result = await this.call([{ role: 'system', content: system }, { role: 'user', content: context }])
    try {
      return parseCaseSpec(JSON.parse(result.raw))
    } catch (firstError) {
      const diagnostics = firstError instanceof Error ? firstError.message : 'invalid_case_spec'
      input.onAttempt?.({ phase: 'repair', status: 'running', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint: hash(context), responseFingerprint: result.responseFingerprint, diagnostics: { validationError: diagnostics } })
      try {
        const repair = await this.call([
          { role: 'system', content: `${system} 严格修复 JSON 结构，保持案例目标，不要添加任何环境权限。` },
          { role: 'user', content: JSON.stringify({ draft: result.raw, validationError: diagnostics }) },
        ])
        const spec = parseCaseSpec(JSON.parse(repair.raw))
        input.onAttempt?.({ phase: 'repair', status: 'succeeded', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint: hash(context), responseFingerprint: repair.responseFingerprint })
        return spec
      } catch (repairError) {
        input.onAttempt?.({ phase: 'repair', status: 'failed', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint: hash(context), responseFingerprint: result.responseFingerprint, diagnostics: { validationError: repairError instanceof Error ? repairError.message : 'invalid_case_spec' } })
        throw new CaseBuilderError('case_invalid_output', '案例模型输出无法通过结构校验')
      }
    }
  }
}

export class StagedModelCaseBuilder implements CaseBuilderProvider {
  readonly providerName = 'model' as const
  readonly staged = true as const
  private readonly promptVersion = 'case-builder-staged-v1'

  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) {}

  private async call(messages: Array<{ role: 'system' | 'user'; content: string }>): Promise<{ raw: string; responseFingerprint: string }> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new CaseBuilderError('model_not_configured', '案例模型尚未配置')
    const controller = new AbortController(); const timer = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, { method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` }, body: JSON.stringify({ model: this.config.modelName, temperature: 0.2, stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, messages }) })
      if (!response.ok) throw new CaseBuilderError(`model_http_${response.status}`, `案例模型返回 HTTP ${response.status}`)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: unknown } }> }
      const value = payload.choices?.[0]?.message?.content
      const raw = typeof value === 'string' ? value.trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim() : ''
      if (!raw) throw new CaseBuilderError('model_empty_output', '案例模型没有返回内容')
      return { raw, responseFingerprint: hash(raw) }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') throw new CaseBuilderError('model_timeout', '案例模型请求超时')
      throw error
    } finally { clearTimeout(timer) }
  }

  private async phase<T>(phase: 'intent' | 'blueprint' | 'generate', system: string, payload: unknown, parse: (value: unknown) => T, input: CaseBuilderInput, contextFingerprint: string, repair = false): Promise<T> {
    input.onAttempt?.({ phase, status: 'running', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint })
    let result: { raw: string; responseFingerprint: string }
    try {
      result = await this.call([{ role: 'system', content: system }, { role: 'user', content: JSON.stringify(payload) }])
    } catch (error) {
      input.onAttempt?.({ phase, status: 'failed', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, diagnostics: { error: error instanceof Error ? error.message : 'phase_failed' } })
      throw error instanceof CaseBuilderError ? error : new CaseBuilderError(`case_${phase}_failed`, `${phase} 阶段请求失败`)
    }
    try {
      const parsed = parse(JSON.parse(result.raw))
      input.onAttempt?.({ phase, status: 'succeeded', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, responseFingerprint: result.responseFingerprint })
      return parsed
    } catch (error) {
      const validationError = error instanceof Error ? error.message : 'invalid_output'
      input.onAttempt?.({ phase, status: 'failed', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, responseFingerprint: result.responseFingerprint, diagnostics: { validationError } })
      if (!repair) throw new CaseBuilderError(`case_${phase}_invalid_output`, `${phase} 阶段输出无法通过结构校验`)
      input.onAttempt?.({ phase: 'repair', status: 'running', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, responseFingerprint: result.responseFingerprint, diagnostics: { validationError } })
      try {
        const repaired = await this.call([
          { role: 'system', content: `${system}\n\n你正在修复一次结构校验失败的输出。只输出完整 JSON，不要解释。完整合约：${CASE_GENERATION_CONTRACT}` },
          { role: 'user', content: JSON.stringify({ draft: result.raw, validationError }) },
        ])
        const parsed = parse(JSON.parse(repaired.raw))
        input.onAttempt?.({ phase: 'repair', status: 'succeeded', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, responseFingerprint: repaired.responseFingerprint })
        input.onAttempt?.({ phase, status: 'succeeded', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, responseFingerprint: repaired.responseFingerprint, diagnostics: { repaired: true } })
        return parsed
      } catch (repairError) {
        input.onAttempt?.({ phase: 'repair', status: 'failed', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint, diagnostics: { validationError: repairError instanceof Error ? repairError.message : 'repair_failed' } })
        throw new CaseBuilderError('case_invalid_output', '案例模型输出在一次修复后仍无法通过结构校验')
      }
    }
  }

  async build(input: CaseBuilderInput): Promise<CaseSpec> {
    const { compileCaseContext, contextForPrompt } = await import('./case-context.js')
    const { parseCaseBlueprint, parseCaseIntent } = await import('./case-agent-schemas.js')
    const context = compileCaseContext(input); const promptContext = contextForPrompt(context)
    const intent = await this.phase<CaseIntent>('intent', '你是案例意图分析器。根据冻结上下文提炼一个可实践的工程问题。只输出 CaseIntent JSON，不选择或修改运行环境，不输出 Docker 或基础设施配置。', promptContext, parseCaseIntent, input, context.fingerprint)
    const blueprint = await this.phase<CaseBlueprint>('blueprint', '你是案例蓝图设计器。根据冻结上下文和 CaseIntent 设计任务顺序、案例资产和验证计划。只能使用服务端提供的运行环境能力，命令必须使用逻辑 command key。只输出 CaseBlueprint JSON。', { context: promptContext, intent }, parseCaseBlueprint, input, context.fingerprint)
    try {
      for (const commandKey of blueprint.verificationPlan.commandKeys) {
        if (!resolveEnvironmentCommand(context.environment.key, context.environment.version, commandKey)) throw new Error(`unsupported_command_key:${commandKey}`)
      }
      for (const asset of blueprint.assetPlan) {
        const supported = asset.kind === 'file' || asset.kind === 'fixture'
          ? context.environment.initializationContract.supportsStarterFiles
          : asset.kind === 'schema'
            ? context.environment.initializationContract.supportsSchemaSeed
            : asset.kind === 'dataset_seed'
              ? context.environment.initializationContract.supportsDatasetSeed
              : context.environment.initializationContract.supportsFaultSeed
        if (!supported) throw new Error(`unsupported_asset_kind:${asset.kind}`)
      }
    } catch (error) {
      input.onAttempt?.({ phase: 'blueprint', status: 'failed', modelName: this.config.modelName, promptVersion: this.promptVersion, contextFingerprint: context.fingerprint, diagnostics: { validationError: error instanceof Error ? error.message : 'invalid_blueprint_boundary' } })
      throw new CaseBuilderError('blueprint_boundary_violation', error instanceof Error ? error.message : '案例蓝图超出环境能力')
    }
    const generated = await this.phase<{ spec: CaseSpec; referenceSolution: ReferenceSolution | null }>('generate', '你是案例实现器。根据冻结上下文、CaseIntent 和 CaseBlueprint 生成案例。只输出包含 exerciseSpec 和可选 referenceSolution 的 JSON；referenceSolution 仅供服务端预检，不能写入 starterFiles，也不能包含 Docker 或宿主机配置。环境必须原样使用上下文中的 key 和 version；不得输出 Dockerfile、Compose、镜像、宿主机路径、网络配置、密钥或任意 shell。exerciseSpec 的命令使用环境允许的逻辑 command key。', { context: promptContext, intent, blueprint, outputContract: CASE_GENERATION_CONTRACT }, (value) => {
      const parsed = parseCaseGenerationOutput(value)
      if (parsed.spec.environment.key !== context.environment.key || parsed.spec.environment.version !== context.environment.version) throw new Error('environment_substitution_rejected')
      return parsed
    }, input, context.fingerprint, true)
    if (generated.referenceSolution) input.onReferenceSolution?.(generated.referenceSolution)
    return generated.spec
  }
}

const CASE_GENERATION_CONTRACT = '{"exerciseSpec":{"title":"string","scenario":"string","learningGoal":"string","difficulty":"introductory|applied|advanced","environment":{"key":"string","version":"string","templateKey":"string","services":["string"]},"starterFiles":[{"path":"relative .py/.json/.md/.txt path","content":"string"}],"tasks":[{"key":"string","instruction":"string","recommendedCommands":["registered command key"],"expectedObservation":"string"}],"verification":{"commands":["registered command key"],"successSignals":["string"]},"tutorContext":{"concepts":["string"],"likelyMisconceptions":["string"],"evidenceToNotice":["string"]}},"referenceSolution":{"files":[{"path":"relative path","content":"private solution file"}],"verificationCommandKeys":["registered command key"]}}'
