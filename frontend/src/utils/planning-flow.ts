import type { PlanningStage } from '@/types/product'

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
