import type { LabExecutionResult } from './domain.js'
import type { CaseStage, PracticeEvent, PracticeRun } from './product-types.js'

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
