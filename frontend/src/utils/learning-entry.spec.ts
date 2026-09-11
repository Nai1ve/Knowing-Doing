import { describe, expect, it } from 'vitest'
import { isBuildablePractice, isFixedMysql, isDynamicGym, resolveLearningEntry } from './learning-entry'

describe('resolveLearningEntry', () => {
  it('keeps fixed MySQL cases on the legacy lesson path', () => {
    const source = { learningMode: 'lab', availability: 'available', caseId: 'mysql-order-list-index-001', learningCaseId: null } as const
    expect(resolveLearningEntry(source)).toBe('fixed_mysql')
    expect(isFixedMysql(source)).toBe(true)
  })

  it('routes a dynamic ready case through GymBuildView', () => {
    const source = { entryKind: 'gym', learningMode: 'lab', availability: 'available', caseId: null, learningCaseId: 'learning-case-1' } as const
    expect(resolveLearningEntry(source)).toBe('dynamic_gym')
    expect(isDynamicGym(source)).toBe(true)
    expect(isBuildablePractice(source)).toBe(true)
  })

  it('routes an available lab without a case to the builder', () => {
    const source = { learningMode: 'lab', availability: 'available', caseId: null, learningCaseId: null } as const
    expect(resolveLearningEntry(source)).toBe('practice_setup')
    expect(isBuildablePractice(source)).toBe(true)
  })

  it('does not create a Gym entry for an explicit unavailable state', () => {
    const source = { entryKind: 'unavailable', learningMode: 'lab', availability: 'available', caseId: null, learningCaseId: null } as const
    expect(resolveLearningEntry(source)).toBe('unavailable')
    expect(isBuildablePractice(source)).toBe(false)
  })
})
