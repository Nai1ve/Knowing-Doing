import type { ProductCurrentLearning } from '@/types/product'

export type LearningEntry = 'fixed_mysql' | 'dynamic_gym' | 'practice_setup' | 'workspace_setup' | 'roadmap_node' | 'unavailable'

type LearningSource = Pick<ProductCurrentLearning, 'learningMode' | 'availability' | 'caseId'> & {
  entryKind?: ProductCurrentLearning['entryKind']
  learningCaseId?: string | null
  practiceStatus?: ProductCurrentLearning['practiceStatus']
  runtimeStatus?: ProductCurrentLearning['runtimeStatus']
}

export function hasActivePractice(source: LearningSource | null | undefined): boolean {
  if (source?.runtimeStatus === 'active') return true
  if (source?.learningCaseId) return false
  return source?.practiceStatus === 'active' || source?.practiceStatus === 'ready_to_close'
}

export function resolveLearningEntry(source: LearningSource | null | undefined): LearningEntry {
  if (!source) return 'unavailable'

  const explicit = 'entryKind' in source ? source.entryKind : undefined
  if (explicit === 'unavailable') return 'unavailable'
  if (explicit === 'roadmap_node') return 'roadmap_node'
  if (explicit === 'workspace_setup') return 'workspace_setup'
  if (explicit === 'practice_setup') return 'practice_setup'

  if (source.learningMode === 'knowledge') return 'roadmap_node'
  if (source.learningMode === 'workspace') return 'workspace_setup'
  if (source.learningMode !== 'lab' || source.availability !== 'available') return 'unavailable'
  if (source.caseId) return 'fixed_mysql'
  if (source.learningCaseId) return 'dynamic_gym'

  // The builder reports whether an available lab capability can actually run.
  return 'practice_setup'
}

export function isDynamicGym(source: LearningSource | null | undefined): boolean {
  return resolveLearningEntry(source) === 'dynamic_gym'
}

export function isFixedMysql(source: LearningSource | null | undefined): boolean {
  return resolveLearningEntry(source) === 'fixed_mysql'
}

export function isBuildablePractice(source: LearningSource | null | undefined): boolean {
  const entry = resolveLearningEntry(source)
  return entry === 'dynamic_gym' || entry === 'practice_setup' || entry === 'workspace_setup'
}
