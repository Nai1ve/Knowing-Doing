import { createHash } from 'node:crypto'
import type { DiagnosticTargetKey, PlanProposalUnit } from './product-types.js'

export const DIAGNOSTIC_RULES_VERSION = 'diagnostic-v1'

export interface DiagnosticInput {
  targetKey: DiagnosticTargetKey
  goal: string
  experience: string
  selfAssessment: string
  weeklyMinutes: number
  outcome: string
  contextNote: string
}

export interface PlanProposalSpec {
  targetKey: DiagnosticTargetKey
  templateKey: string
  title: string
  goal: string
  planState: 'active' | 'pending_content'
  units: PlanProposalUnit[]
  rationale: Array<{ key: string; label: string; effect: string }>
}

function pace(weeklyMinutes: number): string {
  if (weeklyMinutes >= 240) return '按每周 4 小时安排，保留完整的理解、实践与复盘节奏。'
  if (weeklyMinutes >= 120) return '按每周 2 小时安排，优先保留核心概念和一次最小实践。'
  return '按每周不足 2 小时安排，先聚焦一个可解释的最小目标，再逐步扩展。'
}

export function buildPlanProposal(input: DiagnosticInput): PlanProposalSpec {
  const commonRationale = [
    { key: 'goal', label: '学习目标', effect: `路线围绕“${input.goal}”组织，不替用户扩展未填写的目标。` },
    { key: 'experience', label: '已有经验', effect: `保留${input.experience || '当前填写的经验'}作为起点，不把自评直接当作掌握结论。` },
    { key: 'self_assessment', label: '自评水平', effect: `先安排能产出证据的学习动作，再根据实践结果调整起点。` },
    { key: 'weekly_minutes', label: '每周投入', effect: pace(input.weeklyMinutes) },
    { key: 'outcome', label: '预期产出', effect: `路线最终以“${input.outcome || '完成一次可回看的学习产出'}”作为方向。` },
  ]

  if (input.targetKey === 'mysql_performance') {
    return {
      targetKey: input.targetKey,
      templateKey: 'mysql-performance-v1',
      title: 'MySQL 性能优化路线',
      goal: input.goal,
      planState: 'active',
      rationale: commonRationale,
      units: [
        { position: 1, title: '慢查询与联合索引', objective: '从慢日志和表结构定位问题，用 EXPLAIN、索引和结果验证优化假设。', caseId: 'mysql-order-list-index-001', status: 'current', availability: 'available', learningMode: 'lab', estimatedMinutes: 90, rationale: '先用一个可运行案例建立“现象—证据—尝试—验证”的工程判断闭环。', sourceRefs: [] },
        { position: 2, title: '死锁与锁等待', objective: '区分临时止损和根因修复，并用事务会话复测访问顺序。', caseId: 'mysql-deadlock-lock-order-001', status: 'upcoming', availability: 'coming_soon', learningMode: 'lab', estimatedMinutes: 90, rationale: '在完成第一次性能判断后，扩展到并发行为与事务边界。', sourceRefs: [] },
        { position: 3, title: '深分页与产品约束', objective: '比较 OFFSET 和游标分页，说明性能与交互能力的取舍。', caseId: 'mysql-deep-pagination-001', status: 'upcoming', availability: 'coming_soon', learningMode: 'lab', estimatedMinutes: 90, rationale: '最后把局部 SQL 优化连接到产品分页约束和系统设计。', sourceRefs: [] },
      ],
    }
  }

  return {
    targetKey: input.targetKey,
    templateKey: 'general-learning-v1',
    title: `${input.goal.slice(0, 32)} · 学习计划`,
    goal: input.goal,
    planState: 'pending_content',
    rationale: [...commonRationale, { key: 'availability', label: '内容能力', effect: '当前没有匹配的可执行实验，先保存学习方向，相关内容准备完成后再开放实践。' }],
    units: [
      { position: 1, title: '明确学习边界', objective: `明确“${input.goal}”要解决的问题、术语和完成标准。`, caseId: null, status: 'current', availability: 'coming_soon', learningMode: 'unavailable', estimatedMinutes: 45, rationale: '所有技术学习先从可解释的边界和结果开始。', sourceRefs: [] },
      { position: 2, title: '建立核心概念', objective: '形成一张能够解释关键概念、关系和常见误区的知识地图。', caseId: null, status: 'upcoming', availability: 'coming_soon', learningMode: 'unavailable', estimatedMinutes: 60, rationale: '在进入实践前建立最小的原理框架。', sourceRefs: [] },
      { position: 3, title: '完成最小真实产出', objective: '用一个可回看的小产出验证理解，并记录遇到的问题。', caseId: null, status: 'upcoming', availability: 'coming_soon', learningMode: 'unavailable', estimatedMinutes: 90, rationale: '等对应的学习内容和实践承载能力接入后开放。', sourceRefs: [] },
    ],
  }
}

export function inputFingerprint(input: DiagnosticInput): string {
  return createHash('sha256').update(JSON.stringify(input)).digest('hex')
}
