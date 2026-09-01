import type { LabExecutionResult } from './domain.js'
import type { Artifact, CaseStage, PracticeCompletion, PracticeEvent, PracticeRun } from './product-types.js'

export interface CoachDecision {
  nextStage: CaseStage
  outcome: 'no_change' | 'progressed' | 'resolved'
  reason: string
  judgmentChange: string | null
  nextGap: string
}

function hasEvent(events: PracticeEvent[], type: PracticeEvent['type']): boolean {
  return events.some((event) => event.type === type)
}

function hasArtifact(events: PracticeEvent[], artifactKind: string): boolean {
  return events.some((event) => event.payload.artifactKind === artifactKind || event.payload.kind === artifactKind)
}

interface ExecutionEvidence {
  artifact: Artifact
  execution: LabExecutionResult
  order: string
}

function executionEvidence(artifacts: Artifact[]): ExecutionEvidence[] {
  const grouped = new Map<string, Artifact[]>()
  for (const artifact of artifacts) {
    if (artifact.verificationStatus !== 'verified_lab') continue
    const value = artifact.metadata.execution
    if (!value || typeof value !== 'object') continue
    const execution = value as LabExecutionResult
    if (typeof execution.executionId !== 'string' || typeof execution.statement !== 'string' || typeof execution.status !== 'string') continue
    const current = grouped.get(execution.executionId) ?? []
    current.push(artifact)
    grouped.set(execution.executionId, current)
  }
  return [...grouped.values()]
    .map((items) => {
      const first = items[0]!
      const execution = first.metadata.execution as LabExecutionResult
      const output = items.find((item) => ['explain', 'result_set', 'benchmark', 'error'].includes(item.kind)) ?? items.find((item) => item.kind === 'sql') ?? first
      return { artifact: output, execution, order: `${execution.startedAt ?? output.createdAt}|${output.createdAt}` }
    })
    .sort((left, right) => left.order.localeCompare(right.order))
}

function isExplain(item: ExecutionEvidence): boolean {
  return item.artifact.kind === 'explain' || /\bEXPLAIN\b/i.test(item.execution.statement)
}

function isIndexChange(item: ExecutionEvidence): boolean {
  return /\b(?:CREATE|DROP|ALTER)\s+(?:UNIQUE\s+)?(?:INDEX|TABLE)\b/i.test(item.execution.statement) && /\bINDEX\b/i.test(item.execution.statement)
}

function isResultSet(item: ExecutionEvidence): boolean {
  return item.artifact.kind === 'result_set' && item.execution.result?.kind === 'result_set'
}

function resultSignature(item: ExecutionEvidence): string {
  const result = item.execution.result
  return JSON.stringify({ columns: result?.columns ?? [], rows: result?.rows ?? [] })
}

function hasPlanFields(item: ExecutionEvidence): boolean {
  const result = item.execution.result
  const columns = (result?.columns ?? []).map((column) => column.toLowerCase())
  const raw = result?.rawOutput?.toLowerCase() ?? item.artifact.content.toLowerCase()
  return ['type', 'key', 'rows', 'extra'].filter((field) => columns.includes(field) || new RegExp(`\\b${field}\\b`).test(raw)).length >= 2
}

export function evaluatePracticeCompletion(run: PracticeRun, snapshot: Pick<{ artifacts: Artifact[]; events: PracticeEvent[] }, 'artifacts' | 'events'>): PracticeCompletion {
  const evidence = executionEvidence(snapshot.artifacts)
  const successful = evidence.filter((item) => item.execution.status === 'succeeded')
  const explains = successful.filter(isExplain)
  const firstExplain = explains[0]
  const indexAttempts = successful.filter(isIndexChange)
  const nonExplainAttempts = successful.filter((item) => !isExplain(item) && firstExplain && item.order > firstExplain.order)
  const optimization = indexAttempts.at(-1) ?? (nonExplainAttempts.length >= 2 ? nonExplainAttempts[1] : undefined)
  const optimizedExplain = optimization ? explains.find((item) => item.order > optimization.order) : undefined
  const beforeOptimization = optimization ? successful.filter((item) => item.order < optimization.order && isResultSet(item)).at(-1) : undefined
  const afterOptimization = optimization ? successful.filter((item) => item.order > optimization.order && isResultSet(item)).at(-1) : undefined
  const resultConsistent = Boolean(beforeOptimization && afterOptimization && resultSignature(beforeOptimization) === resultSignature(afterOptimization))
  const planComparable = Boolean(firstExplain && optimizedExplain && hasPlanFields(firstExplain) && hasPlanFields(optimizedExplain))
  const checks = [
    { key: 'baseline_explain', label: '原始基线 EXPLAIN', complete: Boolean(firstExplain), detail: firstExplain ? '已记录原始执行计划。' : '还没有成功执行基线 EXPLAIN。' },
    { key: 'optimization_attempt', label: '优化 SQL 或索引尝试', complete: Boolean(optimization), detail: optimization ? `已记录：${optimization.execution.statement.slice(0, 100)}` : '还没有记录优化 SQL 或索引变更。' },
    { key: 'optimized_explain', label: '优化后的 EXPLAIN', complete: Boolean(optimizedExplain), detail: optimizedExplain ? '已记录优化尝试后的执行计划。' : '还没有在优化尝试后重新执行 EXPLAIN。' },
    { key: 'result_before', label: '优化前实际结果', complete: Boolean(beforeOptimization), detail: beforeOptimization ? '已记录优化前结果集。' : '还没有记录优化前的实际查询结果。' },
    { key: 'result_after', label: '优化后实际结果', complete: Boolean(afterOptimization), detail: afterOptimization ? '已记录优化后结果集。' : '还没有记录优化后的实际查询结果。' },
    { key: 'result_consistent', label: '前后结果集一致', complete: resultConsistent, detail: resultConsistent ? '前后列和行一致，可以继续比较成本。' : '前后结果集尚未齐全，或内容还不一致。' },
    { key: 'plan_comparison', label: '前后计划可比较', complete: planComparable, detail: planComparable ? '两份计划都包含可比较字段。' : '两份 EXPLAIN 尚不足以比较 type、key、rows、Extra。' },
  ] satisfies PracticeCompletion['checks']
  const ready = checks.every((check) => check.complete)
  const status = run.status === 'resolved' ? 'resolved' : run.status === 'ended' ? 'ended' : ready ? 'ready_to_close' : 'in_progress'
  return {
    status,
    ready,
    checks,
    missing: checks.filter((check) => !check.complete).map((check) => check.label),
    summary: status === 'resolved' ? '本次实践已完成，可以进入复盘。' : status === 'ended' ? '本次实践已结束，历史证据仍然保留。' : ready ? '证据链已完整，等待你确认完成本次实践。' : '继续补齐证据，完成后这里会出现确认入口。',
  }
}

export function decideAfterMessage(run: PracticeRun, events: PracticeEvent[]): CoachDecision {
  if (run.stage === 'observe' && hasEvent(events, 'user_message')) {
    return { nextStage: 'observe', outcome: 'no_change', reason: '聊天只能记录判断，不能单独推进案例阶段。', judgmentChange: null, nextGap: '还需要一份与当前症状相关的原始证据。' }
  }
  return { nextStage: run.stage, outcome: 'no_change', reason: '保留当前阶段，等待可验证的实践证据。', judgmentChange: null, nextGap: '请提交一个最小可验证动作或原始实验输出。' }
}

export function decideAfterLab(run: PracticeRun, events: PracticeEvent[], execution: LabExecutionResult, artifactKind: string): CoachDecision {
  if (execution.status !== 'succeeded') {
    return { nextStage: 'attempt', outcome: 'no_change', reason: '执行失败本身是证据，先分析错误再调整尝试。', judgmentChange: '当前尝试没有形成可用的成功证据。', nextGap: '还需要解释错误原因，并提交下一次最小尝试。' }
  }
  if (artifactKind === 'explain' || /\bEXPLAIN\b/i.test(execution.statement)) {
    return { nextStage: 'inspect', outcome: 'progressed', reason: '已捕获执行计划，下一步先由用户观察关键字段。', judgmentChange: '从症状描述进入执行计划观察。', nextGap: '请指出 type、key、rows 或 Extra 中最值得怀疑的一项。' }
  }
  if (hasArtifact(events, 'explain') && (artifactKind === 'sql' || artifactKind === 'result_set')) {
    return { nextStage: 'verify', outcome: 'progressed', reason: '已有执行计划和一次 SQL 尝试，需要验证语义与成本。', judgmentChange: '从执行计划观察进入候选修复验证。', nextGap: '还需要前后结果集一致性与可比较的成本证据。' }
  }
  return { nextStage: 'attempt', outcome: 'progressed', reason: '尝试已执行并保存原始输出。', judgmentChange: '获得了一份新的实验结果。', nextGap: '请解释这次结果改变了什么判断。' }
}

export function decideAfterVerification(run: PracticeRun, events: PracticeEvent[], verified: boolean): CoachDecision {
  if (!verified) return { nextStage: 'verify', outcome: 'no_change', reason: '验证条件尚未全部满足，不能标记为解决。', judgmentChange: null, nextGap: '还需要结果集一致性、成本比较和残余风险说明。' }
  if (!hasEvent(events, 'evidence_captured')) return { nextStage: 'verify', outcome: 'no_change', reason: '缺少原始实验事件。', judgmentChange: null, nextGap: '请先提交 Lab 原始输出。' }
  return { nextStage: 'resolved', outcome: 'resolved', reason: '根因、修复和验证证据已形成可追溯链路。', judgmentChange: '从候选方案进入证据支持的解决结论。', nextGap: '进入复盘，整理方案边界与残余风险。' }
}
