import { mockMilestones, mockPlan } from '@/data/mock'
import type { LearningPlan, Milestone } from '@/types/domain'
import { apiClient } from './client'
import { useMockApi } from './mode'

export async function getActivePlan(): Promise<LearningPlan> {
  if (useMockApi) return structuredClone(mockPlan)
  return apiClient.request<LearningPlan>('/plans/active')
}

export async function getPlanRoute(planId: string): Promise<Milestone[]> {
  if (useMockApi) return structuredClone(mockMilestones)
  return apiClient.request<Milestone[]>(`/plans/${planId}/route`)
}
