import { mockLesson } from '@/data/mock'
import type { LessonContext } from '@/types/domain'
import { apiClient } from './client'
import { useMockApi } from './mode'

export async function getLesson(lessonId: string): Promise<LessonContext> {
  if (useMockApi) return structuredClone({ ...mockLesson, id: lessonId })
  return apiClient.request<LessonContext>(`/learning/lessons/${lessonId}`)
}

export async function completeLesson(lessonId: string, evidence: string): Promise<void> {
  if (useMockApi) return
  await apiClient.request(`/learning/lessons/${lessonId}/complete`, { method: 'POST', body: JSON.stringify({ evidence }) })
}
