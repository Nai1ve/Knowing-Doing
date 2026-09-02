import type { LabConfig } from './config.js'
import type { WritingEvidencePack, WritingGenerationKind } from './product-types.js'

export interface WritingAgentSection {
  sectionKey: string
  title: string
  content: string
  required: boolean
  evidenceRefs: string[]
  sourceRefs: string[]
  blocks?: WritingAgentBlock[]
}

export interface WritingAgentBlock {
  content: string
  blockType?: 'paragraph' | 'code' | 'quote'
  evidenceRefs: string[]
  sourceRefs: string[]
  referenceRoles?: Record<string, 'lab' | 'source' | 'inherited'>
}

export interface WritingAgentClaim {
  sectionKey: string
  text: string
  kind: 'observed' | 'inferred' | 'source_based' | 'reflection' | 'recommendation'
  evidenceRefs: string[]
  sourceRefs: string[]
}

export interface WritingAgentDraft {
  title: string
  summary: string
  sections: WritingAgentSection[]
  claims: WritingAgentClaim[]
}

export class WritingAgentError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true) {
    super(message)
    this.name = 'WritingAgentError'
  }
}

export interface WritingAgentInput {
  kind: WritingGenerationKind
  evidencePack: WritingEvidencePack
  outline?: WritingAgentDraft
}

export interface WritingAgentProvider {
  readonly providerName: string
  readonly modelName: string
  generate(input: WritingAgentInput): Promise<WritingAgentDraft>
}

function normalizeJson(value: string): string {
  return value.replace(/<think(?:ing)?>([\s\S]*?)<\/(?:think|thinking)>/gi, '').replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function contentFrom(payload: unknown): string {
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown } }> }).choices?.[0]
  const content = choice?.message?.content
  if (typeof content === 'string') return content
  if (Array.isArray(content)) return content.filter((part): part is { type?: unknown; text?: unknown } => Boolean(part) && typeof part === 'object').map((part) => typeof part.text === 'string' ? part.text : '').join('')
  throw new WritingAgentError('model_empty_output', '写作 Agent 没有返回内容')
}

export class DeepSeekWritingAgent implements WritingAgentProvider {
  readonly providerName = 'deepseek'
  readonly modelName: string

  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) {
    this.modelName = config.modelName
  }

  async generate(input: WritingAgentInput): Promise<WritingAgentDraft> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new WritingAgentError('model_not_configured', '模型服务尚未配置', false)
    const controller = new AbortController(); const startedAt = Date.now(); const timeout = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    const system = input.kind === 'outline'
      ? '你是知行的工程写作大纲 Agent。只使用给定证据包，生成中文 JSON。不得新增事实、数字、SQL 结果或来源。所有事实性内容必须引用 evidenceRefs 或 sourceRefs；知乎来源只能解释原理，不能证明实验结论。'
      : '你是知行的工程文章 Agent。只使用给定证据包和已确认大纲，生成中文 JSON。保持用户的真实判断和实验边界，不新增事实、数字、SQL 结果或来源。所有事实性内容必须引用 evidenceRefs 或 sourceRefs。'
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` },
        body: JSON.stringify({ model: this.config.modelName, temperature: 0.15, stream: false, thinking: { type: 'disabled' }, response_format: { type: 'json_object' }, messages: [
            { role: 'system', content: `${system} 返回对象格式：{title,summary,sections:[{sectionKey,title,content,required,evidenceRefs,sourceRefs,blocks:[{content,blockType,evidenceRefs,sourceRefs,referenceRoles}]}],claims:[{sectionKey,text,kind,evidenceRefs,sourceRefs}]}。sections 必须包含以下 10 个必需章节，sectionKey 必须逐字使用英文键名且不可合并、改名或省略：context（问题背景）、symptom（现象与线索）、hypothesis（我的初始判断）、evidence（证据与排查）、attempts（尝试与判断转折）、solution（最终方案）、verification（结果验证）、principles（原理与可迁移方法）、boundaries（适用边界与代价）、reproduction（可复现步骤）。sources（来源与证据索引）是可选章节，可以省略。每个章节都必须有 title、content、required、evidenceRefs、sourceRefs、blocks 字段；blocks 必须按文章阅读顺序拆分段落，每个事实性 block 至少有一条引用。evidenceRefs 只能引用证据包节点，sourceRefs 只能引用证据包来源，referenceRoles 中 lab/source/inherited 只能描述引用类型，不得新增引用。没有依据的内容请明确写成待验证项并附可用引用。不要返回 Markdown 代码围栏、思维过程或其他字段。` },
          { role: 'user', content: JSON.stringify({ kind: input.kind, evidencePack: input.evidencePack.snapshot, outline: input.outline ?? null }) },
        ] }),
      })
      if (!response.ok) throw new WritingAgentError(`model_http_${response.status}`, `模型服务返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429)
      const parsed = JSON.parse(normalizeJson(contentFrom(await response.json()))) as unknown
      if (!parsed || typeof parsed !== 'object') throw new WritingAgentError('model_invalid_json', '写作 Agent 返回的 JSON 无效')
      return parsed as WritingAgentDraft
    } catch (error) {
      if (error instanceof WritingAgentError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new WritingAgentError('model_timeout', '写作 Agent 请求超时')
      if (error instanceof SyntaxError) throw new WritingAgentError('model_invalid_json', '写作 Agent 返回的内容不是有效 JSON')
      throw new WritingAgentError('model_request_failed', error instanceof Error ? error.message : '写作 Agent 请求失败')
    } finally {
      clearTimeout(timeout)
      console.info('[zhixing-writing]', { kind: input.kind, model: this.config.modelName, elapsedMs: Date.now() - startedAt })
    }
  }
}
