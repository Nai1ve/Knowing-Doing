import type { LabConfig } from './config.js'
import type { PracticeRun, SourceItem, TutorResponse, TutorSource } from './product-types.js'
import type { TutorContext } from './context.js'

export interface TutorGenerated {
  response: string
  sourceRefs: Array<{ sourceId: string; reason: string }>
}

export class TutorProviderError extends Error {
  constructor(public readonly code: string, message: string, public readonly retryable = true, public readonly statusCode?: number) {
    super(message)
    this.name = 'TutorProviderError'
  }
}

function modelUrl(baseUrl: string): string { return `${baseUrl.replace(/\/$/, '')}/chat/completions` }

function stageGuidance(stage: PracticeRun['stage']): Pick<TutorResponse, 'intent' | 'nextQuestion' | 'suggestedActions'> {
  if (stage === 'observe') return { intent: 'clarify', nextQuestion: '你观察到的现象，能由哪一条原始证据直接支持？', suggestedActions: ['描述现象与约束', '指出最值得先验证的证据'] }
  if (stage === 'hypothesize') return { intent: 'evidence_request', nextQuestion: '你的假设是什么，哪一个最小实验可以支持或推翻它？', suggestedActions: ['写下假设与预期', '执行一条最小 EXPLAIN'] }
  if (stage === 'inspect') return { intent: 'clarify', nextQuestion: '执行计划中哪一项最能解释当前现象？为什么？', suggestedActions: ['指出 type、key、rows 或 Extra 的异常', '把字段和 p99 联系起来'] }
  if (stage === 'attempt') return { intent: 'attempt_review', nextQuestion: '这次结果支持还是削弱了你的假设？和原始基线相比改变了什么？', suggestedActions: ['对比基线与当前 EXPLAIN', '说明结果语义是否改变'] }
  if (stage === 'verify') return { intent: 'tradeoff', nextQuestion: '你用什么证据证明优化后结果一致、成本下降且代价可接受？', suggestedActions: ['对比结果集与成本', '记录索引代价和残余风险'] }
  return { intent: 'reflect', nextQuestion: '这次实践中最值得写进工程复盘的判断转折是什么？', suggestedActions: ['整理根因与证据', '生成可编辑复盘大纲'] }
}

function workspaceGuidance(stage: PracticeRun['stage']): Pick<TutorResponse, 'intent' | 'nextQuestion' | 'suggestedActions'> {
  if (stage === 'observe') return { intent: 'clarify', nextQuestion: '你先观察到了什么？请把现象和代码位置对应起来。', suggestedActions: ['指出失败测试或异常输出', '说明你准备先观察哪段代码'] }
  if (stage === 'hypothesize') return { intent: 'evidence_request', nextQuestion: '你认为失败的直接原因是什么？哪一个最小改动或测试可以验证它？', suggestedActions: ['写下假设与预期', '先运行案例提供的 pytest 命令'] }
  if (stage === 'inspect') return { intent: 'clarify', nextQuestion: '当前实现和测试的约束分别是什么？哪一项决定了修复方式？', suggestedActions: ['定位输入边界', '对照测试断言与实现'] }
  if (stage === 'attempt') return { intent: 'attempt_review', nextQuestion: '这次修改后的测试结果说明了什么？还有哪些边界没有验证？', suggestedActions: ['比较修改前后的输出', '补充一个最小边界测试'] }
  if (stage === 'verify') return { intent: 'tradeoff', nextQuestion: '你准备怎样证明修复既满足目标，又没有破坏原有行为？', suggestedActions: ['运行完整 pytest', '记录关键测试和结果'] }
  return { intent: 'reflect', nextQuestion: '这次案例中最值得迁移到其他代码的问题解决方法是什么？', suggestedActions: ['整理根因与验证', '记录仍需进一步练习的地方'] }
}

function mysqlGymGuidance(context: TutorContext): Pick<TutorResponse, 'intent' | 'nextQuestion' | 'suggestedActions'> {
  const gym = context.mysqlGym
  if (!gym) return stageGuidance(context.hot.stage as PracticeRun['stage'])
  const task = gym.currentTask
  return {
    intent: task ? 'clarify' : 'reflect',
    nextQuestion: task?.instruction ?? `请用当前案例的证据说明：${gym.node.completionStandard}`,
    suggestedActions: task ? [task.expectedObservation, ...gym.case.tutorContext.evidenceToNotice.slice(0, 2)] : gym.verificationSignals.slice(0, 3),
  }
}

function stripThinking(value: string): string {
  const endTokens = ['<｜end▁of▁thinking｜>', '</think>', '</thinking>']
  let result = value
  const end = endTokens.map((token) => result.lastIndexOf(token)).sort((a, b) => b - a)[0] ?? -1
  if (end >= 0) result = result.slice(end + endTokens.find((token) => result.lastIndexOf(token) === end)!.length)
  const starts = ['<think>', '<thinking>']
  const start = starts.map((token) => result.indexOf(token)).filter((index) => index >= 0).sort((a, b) => a - b)[0]
  if (start !== undefined) result = result.slice(0, start)
  return result.replace(/<\/?think(?:ing)?>/gi, '').trim()
}

function preserveCodeWhitespace(value: string, trim = false): string {
  let fence: '`' | '~' | null = null
  const normalized = value.split('\n').map((line) => {
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})/)
    if (fence) {
      if (marker && marker[1][0] === fence) fence = null
      return line
    }
    if (marker) {
      fence = marker[1][0] as '`' | '~'
      return line
    }
    if (/^( {4}|\t)/.test(line)) return line
    return line.replace(/[ \t]{2,}/g, ' ')
  }).join('\n')
  return trim ? normalized.trim() : normalized
}

function extractSourceRefs(value: string, sources: SourceItem[]): TutorGenerated {
  const sourceMap = new Map(sources.map((source) => [source.id, source]))
  const refs: Array<{ sourceId: string; reason: string }> = []
  const response = preserveCodeWhitespace(value.replace(/\[\[source:([^\]]+)\]\]/g, (_match, sourceId: string) => {
    const source = sourceMap.get(sourceId)
    if (source) refs.push({ sourceId, reason: `用于补充“${source.title}”中的相关经验，仍需以 Lab 证据为准。` })
    return ''
  }), true)
  return { response, sourceRefs: refs.filter((ref, index) => refs.findIndex((item) => item.sourceId === ref.sourceId) === index) }
}

function streamVisible(value: string): string {
  return preserveCodeWhitespace(value.replace(/\[\[source:[^\]]+\]\]/g, '').replace(/\[\[source:[^\]]*$/, ''))
}

function sourcesForPrompt(sources: SourceItem[]): Array<Pick<SourceItem, 'id' | 'title' | 'author' | 'url' | 'excerpt' | 'retrievedAt'>> {
  return sources.slice(0, 3).map(({ id, title, author, url, excerpt, retrievedAt }) => ({ id, title, author, url, excerpt: excerpt.slice(0, 1800), retrievedAt }))
}

export function tutorResponseFromGenerated(run: PracticeRun, context: TutorContext, generated: TutorGenerated, sources: SourceItem[], retrievalStatus: 'retrieved' | 'empty' | 'unavailable' = sources.length > 0 ? 'retrieved' : 'empty'): TutorResponse {
  const guidance = context.workspace ? workspaceGuidance(run.stage) : context.mysqlGym ? mysqlGymGuidance(context) : stageGuidance(run.stage)
  return { response: generated.response, ...guidance, currentGap: context.hot.currentGap ?? '还需要一份可验证的实验或解释证据。', evidenceRefs: context.rawEvidence.map((item) => item.id), sourceRefs: generated.sourceRefs, provider: 'model', sourceStatus: generated.sourceRefs.length > 0 || sources.length > 0 ? 'retrieved' : retrievalStatus === 'unavailable' ? 'unavailable' : 'not_needed' }
}

export class TutorEngine {
  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) {}

  get providerName(): string { return 'deepseek' }
  get configuredModelName(): string { return this.config.modelName }

  async generate(run: PracticeRun, context: TutorContext, message: string, sources: SourceItem[], onDelta?: (delta: string) => void): Promise<TutorGenerated> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) throw new TutorProviderError('model_not_configured', '模型服务尚未配置', false)
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    const startedAt = Date.now()
    try {
      const response = await fetch(modelUrl(this.config.modelBaseUrl), {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` },
        body: JSON.stringify({ model: this.config.modelName, temperature: 0.2, stream: true, thinking: { type: 'disabled' }, messages: [
          { role: 'system', content: context.workspace ? '你是知行代码工作区 Tutor。请用中文自然语言回答，不要输出 JSON、思维过程或固定模板。只根据当前案例、代码文件、pytest 输出、实践事件和给定来源回答：帮助用户观察代码行为、提出可验证假设、设计最小修改和验证步骤。不要替用户写文件，不要把测试通过直接宣布为能力掌握，不得伪造知乎来源。需要引用来源时，在对应句末使用 [[source:来源id]]；不需要引用时不要添加标记。' : context.mysqlGym ? '你是知行 MySQL Gym Tutor。只围绕冻结的路线卡片、当前案例任务、用户已经执行的 SQL/EXPLAIN 与可见验证目标回答。引导用户观察 type、key、rows、Extra 或当前卡片指定的证据，提出可检验的假设。不得泄露参考索引、参考修复 SQL、容器信息、内部凭据或直接给出答案；不要把一次执行宣布为能力掌握。用中文自然语言回答，不输出 JSON 或思维过程。需要引用来源时使用 [[source:来源id]]。' : '你是知行 Tutor。请用中文自然语言回答，不要输出 JSON、思维过程或固定模板。只根据实践上下文和给定来源回答：帮助用户观察、提出可验证假设、设计最小实验并解释证据。不要替用户宣布实验成功，不得伪造知乎来源。需要引用来源时，在对应句末使用 [[source:来源id]]；不需要引用时不要添加标记。' },
          { role: 'user', content: JSON.stringify({ message, context: { ...context, availableSourceIds: sources.map((source) => source.id), sources: sourcesForPrompt(sources) } }) },
        ] }),
      })
      if (!response.ok) throw new TutorProviderError(`model_http_${response.status}`, `模型服务返回 HTTP ${response.status}`, response.status >= 500 || response.status === 429, response.status)
      if (!response.body) throw new TutorProviderError('model_empty_stream', '模型没有返回可读取的流', true)
      const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let raw = ''; let emitted = ''
      const consume = (line: string) => {
        if (!line.startsWith('data:')) return
        const data = line.slice(5).trim()
        if (!data || data === '[DONE]') return
        let payload: unknown
        try { payload = JSON.parse(data) } catch { throw new TutorProviderError('model_invalid_stream', '模型流返回了无法解析的数据', true) }
        const choice = (payload as { choices?: Array<{ delta?: { content?: unknown; reasoning_content?: unknown } }> }).choices?.[0]
        const content = choice?.delta?.content
        if (typeof content !== 'string') return
        raw += content
        const visible = streamVisible(stripThinking(raw))
        if (visible.length > emitted.length && visible.startsWith(emitted)) { const delta = visible.slice(emitted.length); emitted = visible; onDelta?.(delta) }
      }
      while (true) {
        const chunk = await reader.read()
        if (chunk.done) break
        buffer += decoder.decode(chunk.value, { stream: true })
        let lineEnd = buffer.indexOf('\n')
        while (lineEnd >= 0) { consume(buffer.slice(0, lineEnd).replace(/\r$/, '')); buffer = buffer.slice(lineEnd + 1); lineEnd = buffer.indexOf('\n') }
      }
      if (buffer.trim()) consume(buffer.trim())
      const visible = stripThinking(raw)
      if (!visible) throw new TutorProviderError('model_empty_answer', '模型返回了空回答', true)
      let answer = visible
      if (visible.trimStart().startsWith('{')) {
        try {
          const legacy = JSON.parse(visible) as { response?: unknown }
          if (typeof legacy.response !== 'string' || !legacy.response.trim()) throw new Error('missing response')
          answer = legacy.response
        } catch { throw new TutorProviderError('model_non_natural_output', '模型返回格式无法规范化为自然语言回答', true) }
      }
      return extractSourceRefs(answer, sources)
    } catch (error) {
      if (error instanceof TutorProviderError) throw error
      if (error instanceof Error && error.name === 'AbortError') throw new TutorProviderError('model_timeout', '模型请求超时', true)
      throw new TutorProviderError('model_request_failed', error instanceof Error ? error.message : '模型请求失败', true)
    } finally {
      clearTimeout(timeout)
      console.info('[zhixing-tutor]', { runId: run.id, caseId: run.caseId, stage: run.stage, model: this.config.modelName, elapsedMs: Date.now() - startedAt })
    }
  }

  async respond(run: PracticeRun, context: TutorContext, message: string, sources: SourceItem[] = []): Promise<TutorResponse> {
    return tutorResponseFromGenerated(run, context, await this.generate(run, context, message, sources), sources)
  }
}
