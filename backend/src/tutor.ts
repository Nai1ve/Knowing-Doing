import { z } from 'zod'
import type { LabConfig } from './config.js'
import type { PracticeRun, TutorResponse } from './product-types.js'
import type { TutorContext } from './context.js'

const tutorResponseSchema = z.object({
  response: z.string().min(1),
  intent: z.enum(['clarify', 'triage', 'evidence_request', 'attempt_review', 'tradeoff', 'reflect']),
  currentGap: z.string(),
  nextQuestion: z.string(),
  suggestedActions: z.array(z.string()).min(1).max(3),
  evidenceRefs: z.array(z.string()),
  sourceRefs: z.array(z.object({ sourceId: z.string(), reason: z.string() })),
  provider: z.enum(['model', 'scripted']).optional(),
  sourceStatus: z.enum(['retrieved', 'general_model_knowledge', 'not_needed']).optional(),
})

function fallback(run: PracticeRun, context: TutorContext, message: string): TutorResponse {
  const common = { evidenceRefs: context.rawEvidence.map((item) => item.id), sourceRefs: [], provider: 'scripted' as const, sourceStatus: 'general_model_knowledge' as const }
  if (run.stage === 'observe') return { ...common, response: `先把你的判断记录下来：${message}\n\n当前只知道症状，还没有把症状和一份原始证据对应起来。`, intent: 'clarify', currentGap: '缺少与症状对应的原始慢日志或执行计划。', nextQuestion: '你现在认为哪一条证据最能缩小问题范围？', suggestedActions: ['说明你看到的现象和约束', '提交或请求一段脱敏慢日志'] }
  if (run.stage === 'hypothesize') return { ...common, response: `这个方向可以尝试，但先不要把它当成结论。请说明你准备如何验证它。`, intent: 'evidence_request', currentGap: '缺少能支持或推翻当前假设的最小实验。', nextQuestion: '你准备执行什么动作，成功或失败分别会改变什么判断？', suggestedActions: ['写下假设和预期结果', '执行一条最小 EXPLAIN'] }
  if (run.stage === 'inspect') return { ...common, response: '先由你观察执行计划，不急着背字段定义。把最异常的一项和你的理由说出来。', intent: 'clarify', currentGap: '还没有记录用户对执行计划的观察。', nextQuestion: 'type、key、rows、Extra 中，哪一项最能解释当前现象？为什么？', suggestedActions: ['指出一个异常字段', '说明它与 p99 症状的关联'] }
  if (run.stage === 'attempt') return { ...common, response: '这次尝试已经被记录。结果不等于结论，先比较它和原始基线到底改变了什么。', intent: 'attempt_review', currentGap: '缺少对尝试结果的解释和下一步调整。', nextQuestion: '这次结果支持还是削弱了你的假设？证据在哪里？', suggestedActions: ['对比 EXPLAIN 的 rows/key/Extra', '说明是否改变了结果语义'] }
  if (run.stage === 'verify') return { ...common, response: '现在进入验证，不只看“更快”。需要同时确认结果集语义、成本变化和方案代价。', intent: 'tradeoff', currentGap: '尚未完成结果集、成本和残余风险的联合验证。', nextQuestion: '你用什么证据证明优化后仍然返回同一批业务结果？', suggestedActions: ['运行前后对比查询', '记录基准耗时和扫描成本'] }
  return { ...common, response: '实践已经达到解决态。接下来把根因、证据、失败尝试和残余风险整理成可编辑复盘。', intent: 'reflect', currentGap: '需要整理可公开的工程复盘。', nextQuestion: '如果把这次问题写成知乎文章，最值得保留的判断转折是什么？', suggestedActions: ['查看实践路径', '生成笔记大纲'] }
}

function modelUrl(baseUrl: string): string {
  return `${baseUrl.replace(/\/$/, '')}/chat/completions`
}

export class TutorEngine {
  constructor(private readonly config: Pick<LabConfig, 'modelBaseUrl' | 'modelApiKey' | 'modelName' | 'modelTimeoutMs'>) {}

  async respond(run: PracticeRun, context: TutorContext, message: string): Promise<TutorResponse> {
    if (!this.config.modelBaseUrl || !this.config.modelApiKey) return fallback(run, context, message)
    const controller = new AbortController(); const timeout = setTimeout(() => controller.abort(), this.config.modelTimeoutMs)
    try {
      const response = await fetch(modelUrl(this.config.modelBaseUrl), {
        method: 'POST', signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.config.modelApiKey}` },
        body: JSON.stringify({ model: this.config.modelName, temperature: 0.2, response_format: { type: 'json_object' }, messages: [
          { role: 'system', content: '你是知行 Tutor。只基于给定上下文回答。不得伪造知乎来源、实验结果或推进状态。输出严格 JSON，字段为 response,intent,currentGap,nextQuestion,suggestedActions,evidenceRefs,sourceRefs。' },
          { role: 'user', content: JSON.stringify({ message, context }) },
        ] }),
      })
      if (!response.ok) throw new Error(`model status ${response.status}`)
      const payload = await response.json() as { choices?: Array<{ message?: { content?: string } }> }
      const content = payload.choices?.[0]?.message?.content
      if (!content) throw new Error('model returned empty content')
      const parsed = JSON.parse(content) as unknown
      const validated = tutorResponseSchema.parse(parsed)
      const sourceRefs = validated.sourceRefs.filter((source) => context.availableSourceIds.includes(source.sourceId))
      return { ...validated, sourceRefs, provider: 'model', sourceStatus: sourceRefs.length > 0 ? 'retrieved' : 'general_model_knowledge' }
    } catch {
      return fallback(run, context, message)
    } finally {
      clearTimeout(timeout)
    }
  }
}
