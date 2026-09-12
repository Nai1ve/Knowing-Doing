import { describe, expect, it } from 'vitest'
import { isAssessmentStage, planningStepForStage, planningStepIndex } from './planning-flow'

describe('planning flow', () => {
  it('maps the server stages to the four visible steps', () => {
    expect(planningStepForStage('baseline')).toBe('baseline')
    expect(planningStepForStage('assessment_evaluating')).toBe('assessment')
    expect(planningStepForStage('requirements_review')).toBe('requirements')
    expect(planningStepForStage('generating')).toBe('roadmap')
    expect(planningStepIndex('requirements')).toBe(2)
  })

  it('identifies stages where free chat must be disabled', () => {
    expect(isAssessmentStage('assessment_preparing')).toBe(true)
    expect(isAssessmentStage('assessment_answering')).toBe(true)
    expect(isAssessmentStage('requirements')).toBe(false)
  })
})
