import { createHash } from 'node:crypto'
import type { CaseRequest, CaseSpec, SourceItem } from './product-types.js'
import { parseCaseSpec } from './case-schemas.js'
import type { LabConfig } from './config.js'

export type CaseBuilderAttemptPhase = 'repair'
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
}

export interface CaseBuilderProvider {
  readonly providerName: 'fixture' | 'model'
  readonly modelName?: string
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
