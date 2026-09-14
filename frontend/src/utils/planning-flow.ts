import type { PlanningProgress, PlanningStage } from '@/types/product'

export const baselineTurnMinimum = 2
export const baselineTurnMaximum = 3

export const planningSteps = [
  { key: 'baseline', label: '基线' },
  { key: 'assessment', label: '评估' },
  { key: 'requirements', label: '需求' },
  { key: 'roadmap', label: '路线' },
] as const

export type PlanningStep = typeof planningSteps[number]['key']

export function planningStepForStage(stage: PlanningStage): PlanningStep {
  if (stage === 'baseline') return 'baseline'
  if (stage.startsWith('assessment_')) return 'assessment'
  if (stage === 'requirements' || stage === 'requirements_review') return 'requirements'
  return 'roadmap'
}

export function planningStepIndex(stage: PlanningStage): number {
  return planningSteps.findIndex((step) => step.key === planningStepForStage(stage))
}

export function isAssessmentStage(stage: PlanningStage): boolean {
  return stage === 'assessment_preparing' || stage === 'assessment_answering' || stage === 'assessment_evaluating'
}

export function isTerminalAssessmentStatus(status: string | undefined): boolean {
  return status === 'completed' || status === 'abandoned'
}

export function baselineProgress(progress: PlanningProgress | null | undefined): PlanningProgress {
  // The confirmed planner contract is a three-turn baseline ceiling. Older
  // sessions may still report a retired six-turn total; keep the server's
  // completed/current values, but clamp rendering to the current ceiling.
  const total = Math.max(progress?.total ?? 0, baselineTurnMaximum)
  const completed = Math.max(0, Math.min(progress?.completed ?? 0, total))
  const current = Math.max(1, Math.min(progress?.current ?? completed + 1, total))
  return { ...progress, completed, total, current, label: progress?.label ?? '基础了解' }
}

export function planningStageLabel(stage: PlanningStage): string {
  if (stage === 'baseline') return '基础了解'
  if (stage === 'assessment_preparing') return '准备水平测评'
  if (stage === 'assessment_answering') return '水平测评'
  if (stage === 'assessment_evaluating') return '整理测评结果'
  if (stage === 'requirements' || stage === 'requirements_review') return '确认需求'
  if (stage === 'ready') return '等待生成路线'
  if (stage === 'generating') return '生成路线'
  return '路线已生成'
}
