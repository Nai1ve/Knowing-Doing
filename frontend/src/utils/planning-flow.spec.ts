import { describe, expect, it } from 'vitest'
import { baselineProgress, baselineTurnMaximum, baselineTurnMinimum, isAssessmentStage, planningStageLabel, planningStepForStage, planningStepIndex } from './planning-flow'

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

  it('keeps baseline progress adaptive through the three-turn ceiling', () => {
    expect(baselineTurnMinimum).toBe(2)
    expect(baselineTurnMaximum).toBe(3)
    expect(baselineProgress({ completed: 3, total: 3, current: 3, label: '基础了解' })).toMatchObject({ completed: 3, total: 3, current: 3 })
    expect(baselineProgress({ completed: 2, total: 2, current: 3 })).toMatchObject({ completed: 2, total: 3, current: 3 })
  })

  it('labels server stages without assuming a fixed baseline count', () => {
    expect(planningStageLabel('baseline')).toBe('基础了解')
    expect(planningStageLabel('assessment_preparing')).toBe('准备水平测评')
    expect(planningStageLabel('requirements_review')).toBe('确认需求')
  })
})
