import type { LabConfig } from './config.js'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { WritingEvidenceItem, WritingEvidencePack, WritingGenerationKind } from './product-types.js'

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

export interface NarrativeWritingAgentInput {
  evidencePack: WritingEvidencePack
  items: WritingEvidenceItem[]
  searchEvidence?: (query: string, limit: number) => WritingEvidenceItem[]
}

export interface NarrativeWritingAgentProvider extends WritingAgentProvider {
  generateNarrative(input: NarrativeWritingAgentInput): Promise<string>
  humanize(markdown: string): Promise<string>
}

const NARRATIVE_WRITING_SYSTEM_PROMPT = `你正在以第一人称写一篇真实实践复盘。
根据当前实践写一篇约 3000 到 4000 字的中文文章。重点写清：用户原本要解决的问题，过程怎样推进，哪些信息改变了判断，做过什么尝试，最后得出了什么结论，以及其中值得理解的知识。

文章不是过程记录的简单罗列。写作时要根据实践中出现的概念、命令、输出和决策，主动补充读者理解当前问题所必需的背景知识：第一次出现重要术语时，用简洁的语言解释它是什么；出现工具输出或指标时，解释关键字段代表什么、应该怎样阅读以及它如何影响判断，例如遇到执行计划时说明关键字段和分析路径；出现方案选择时，解释为什么选择它、还有哪些常见选择、适用条件、失效方式和代价，例如索引、缓存、队列或并发方案。背景知识要紧贴当前叙事，用来解释当前的现象和决策，不要扩写成脱离实践的教科书，也不要为了凑篇幅堆砌概念。上述规则适用于任何技术领域，不要把文章写成某一种数据库、语言或固定案例的模板。

可以使用你已有的通用技术知识补充这些解释，并结合当前实践资料中的具体内容。区分“这次实践实际观察到的结果”和“可以迁移到其他场景的一般原理”：不要把没有发生的操作、没有出现的结果写成这次实践已经验证的事实；必要时用“通常”“一般来说”“可以进一步验证”等自然表达。不要因此省略对读者有帮助的背景解释。

文章结构完全由你决定。不要套固定目录，不要输出写作说明，不要提及 Agent、证据包、工具或内部流程。你可以主动检索当前实践的完整记录。需要保留回查关系时，在对应文字后使用 [[ref:<type>:<id>]]。输出完整 Markdown 正文。`

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

function responseMessage(payload: unknown): { content?: unknown; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }> } {
  const choice = (payload as { choices?: Array<{ message?: { content?: unknown; tool_calls?: unknown } }> }).choices?.[0]
  const message = choice?.message
  if (!message || typeof message !== 'object') throw new WritingAgentError('model_empty_output', '写作 Agent 没有返回消息')
  return message as { content?: unknown; tool_calls?: Array<{ id?: unknown; function?: { name?: unknown; arguments?: unknown } }> }
}

function narrativeContent(value: unknown): string {
  const content = typeof value === 'string' ? value : Array.isArray(value) ? value.filter((part): part is { text?: unknown } => Boolean(part) && typeof part === 'object').map((part) => typeof part.text === 'string' ? part.text : '').join('') : ''
  const cleaned = content.replace(/<think(?:ing)?>([\s\S]*?)<\/(?:think|thinking)>/gi, '').replace(/<\|(?:thinking|reasoning)[\s\S]*?<\|end(?:thinking|reasoning)\|>/gi, '').trim()
  if (!cleaned) throw new WritingAgentError('model_empty_output', '写作 Agent 没有返回文章内容')
  return cleaned.replace(/^```(?:markdown|md)?\s*/i, '').replace(/\s*```$/, '').trim()
}

function skillPrompt(): string {
  const candidates = [
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../vendor/skills/humanizer-zh/SKILL.md'),
    path.resolve(process.cwd(), 'vendor/skills/humanizer-zh/SKILL.md'),
  ]
  for (const candidate of candidates) {
    try { return fs.readFileSync(candidate, 'utf8') } catch { /* build output may use the cwd fallback */ }
  }
  throw new WritingAgentError('humanizer_skill_missing', 'Humanizer-zh skill 未安装', false)
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

  private async complete(messages: Array<Record<string, unknown>>, tools?: Array<Record<string, unknown>>): Promise<unknown> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new WritingAgentError('model_not_configured', '模型服务尚未配置', false)
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    try {
      const response = await fetch(`${this.config.modelBaseUrl.replace(/\/$/, '')}/chat/completions`, {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` },
        body: JSON.stringify({ model: this.config.modelName, temperature: 0.35, stream: false, thinking: { type: 'disabled' }, messages, ...(tools ? { tools, tool_choice: 'auto' } : {}) }),
      })
      if (!response.ok) throw new WritingAgentError(`model_http_${response.status}`, `模型服务返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429)
      return response.json()
    } catch (error) {
      if (error instanceof WritingAgentError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new WritingAgentError('model_timeout', '写作 Agent 请求超时')
      throw new WritingAgentError('model_request_failed', error instanceof Error ? error.message : '写作 Agent 请求失败')
    } finally { clearTimeout(timeout) }
  }

  async generateNarrative(input: NarrativeWritingAgentInput): Promise<string> {
    const itemsByRef = new Map(input.items.map((item) => [`${item.refType}:${item.refId}`, item]))
    const tools = [
      { type: 'function', function: { name: 'search_evidence', description: '在当前实践的证据中检索相关记录', parameters: { type: 'object', properties: { query: { type: 'string' }, limit: { type: 'integer' } }, required: ['query'] } } },
      { type: 'function', function: { name: 'read_evidence', description: '读取指定证据条目的完整内容', parameters: { type: 'object', properties: { refs: { type: 'array', items: { type: 'string' } } }, required: ['refs'] } } },
      { type: 'function', function: { name: 'get_practice_timeline', description: '按时间查看当前实践的过程记录', parameters: { type: 'object', properties: { limit: { type: 'integer' } } } } },
      { type: 'function', function: { name: 'get_related_evidence', description: '读取与一个证据条目相关的记录', parameters: { type: 'object', properties: { ref: { type: 'string' } }, required: ['ref'] } } },
    ] as Array<Record<string, unknown>>
    const messages: Array<Record<string, unknown>> = [
      { role: 'system', content: NARRATIVE_WRITING_SYSTEM_PROMPT },
      { role: 'user', content: JSON.stringify({ practice: input.evidencePack.snapshot && { practiceRunId: (input.evidencePack.snapshot as { practiceRunId?: unknown }).practiceRunId, itemCount: input.items.length }, evidenceIndex: input.items.map((item) => ({ ref: `${item.refType}:${item.refId}`, kind: item.kind, title: item.title, excerpt: item.body.slice(0, 360), createdAt: item.createdAt })), instruction: '先按需反查，再直接输出完整 Markdown。证据索引只用于定位，细节可用工具读取。' }) },
    ]
    for (let round = 0; round < 12; round += 1) {
      const payload = await this.complete(messages, tools); const message = responseMessage(payload); const calls = Array.isArray(message.tool_calls) ? message.tool_calls : []
      if (calls.length === 0) return narrativeContent(message.content)
      console.info('[zhixing-writing] narrative_tools', { round: round + 1, names: calls.map((call) => typeof call.function?.name === 'string' ? call.function.name : 'unknown') })
      messages.push({ role: 'assistant', content: typeof message.content === 'string' ? message.content : null, tool_calls: calls })
      for (const call of calls) {
        const name = typeof call.function?.name === 'string' ? call.function.name : ''
        let args: Record<string, unknown> = {}
        try { args = typeof call.function?.arguments === 'string' ? JSON.parse(call.function.arguments) as Record<string, unknown> : {} } catch { args = {} }
        let result: unknown
        if (name === 'search_evidence') {
          const query = typeof args.query === 'string' ? args.query.toLowerCase() : ''
          const limit = Math.min(Math.max(Number(args.limit) || 8, 1), 12)
          const matches = input.searchEvidence ? input.searchEvidence(query, limit) : input.items.filter((item) => `${item.title}\n${item.body}`.toLowerCase().includes(query)).slice(0, limit)
          result = matches.map((item) => ({ ref: `${item.refType}:${item.refId}`, kind: item.kind, title: item.title, excerpt: item.body.slice(0, 600) }))
        } else if (name === 'read_evidence') {
          const refs = Array.isArray(args.refs) ? args.refs.filter((ref): ref is string => typeof ref === 'string') : []
          result = refs.map((ref) => { const item = itemsByRef.get(ref); return item ? { ref, kind: item.kind, title: item.title, body: item.body, metadata: item.metadata } : { ref, missing: true } })
        } else if (name === 'get_practice_timeline') {
          const limit = Math.min(Math.max(Number(args.limit) || 30, 1), 60)
          result = input.items.slice().sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, limit).map((item) => ({ ref: `${item.refType}:${item.refId}`, kind: item.kind, title: item.title, body: item.body.slice(0, 500), createdAt: item.createdAt }))
        } else if (name === 'get_related_evidence') {
          const ref = typeof args.ref === 'string' ? args.ref : ''
          const item = itemsByRef.get(ref)
          const refs = new Set([ref, ...((item?.metadata.relatedRefs as string[] | undefined) ?? [])])
          result = input.items.filter((candidate) => refs.has(`${candidate.refType}:${candidate.refId}`) || candidate.metadata.relatedRef === ref).slice(0, 20).map((candidate) => ({ ref: `${candidate.refType}:${candidate.refId}`, kind: candidate.kind, title: candidate.title, excerpt: candidate.body.slice(0, 600) }))
        } else result = { error: 'unknown_tool' }
        messages.push({ role: 'tool', tool_call_id: typeof call.id === 'string' ? call.id : `tool-${round}`, name, content: JSON.stringify(result) })
      }
    }
    throw new WritingAgentError('draft_tool_limit', '写作 Agent 的反查次数已达到上限')
  }

  async humanize(markdown: string): Promise<string> {
    const system = `${skillPrompt()}\n\n你现在处理一篇知行生成的中文工程实践复盘。只输出润色后的完整 Markdown，保留 Markdown 结构、代码块和 [[ref:...]] 标记，不要解释改了什么。`
    const payload = await this.complete([{ role: 'system', content: system }, { role: 'user', content: markdown }])
    return narrativeContent(responseMessage(payload).content)
  }
}
