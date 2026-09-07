import type { LessonContext } from '@/types/domain'
import { apiClient } from './client'

export async function getLesson(lessonId: string): Promise<LessonContext> {
  return apiClient.request<LessonContext>(`/learning/lessons/${lessonId}`)
}

export async function completeLesson(lessonId: string, evidence: string): Promise<void> {
  await apiClient.request(`/learning/lessons/${lessonId}/complete`, { method: 'POST', body: JSON.stringify({ evidence }) })
}
