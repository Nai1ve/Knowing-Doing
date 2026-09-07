import type { TutorMessage } from '@/types/domain'
import { apiClient } from './client'

export async function getTutorThread(lessonId: string): Promise<TutorMessage[]> {
  return apiClient.request<TutorMessage[]>(`/learning/lessons/${lessonId}/tutor-thread`)
}

export async function askTutor(lessonId: string, question: string): Promise<TutorMessage> {
  return apiClient.request<TutorMessage>(`/learning/lessons/${lessonId}/tutor`, { method: 'POST', body: JSON.stringify({ question }) })
}
