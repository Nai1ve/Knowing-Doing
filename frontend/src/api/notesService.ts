import type { PracticeEvent } from '@/types/domain'
import { apiClient } from './client'

export async function getPracticeEvents(planId: string): Promise<PracticeEvent[]> {
  return apiClient.request<PracticeEvent[]>(`/plans/${planId}/practice-events`)
}

export async function createPracticeEvent(planId: string, event: Omit<PracticeEvent, 'id' | 'createdAt'>): Promise<PracticeEvent> {
  return apiClient.request<PracticeEvent>(`/plans/${planId}/practice-events`, { method: 'POST', body: JSON.stringify(event) })
}

export async function generateOutline(planId: string): Promise<string> {
  return (await apiClient.request<{ content: string }>(`/plans/${planId}/notes/outline`, { method: 'POST' })).content
}

export async function saveNoteDraft(planId: string, payload: { outline: string; article: string }): Promise<void> {
  await apiClient.request(`/plans/${planId}/notes/draft`, { method: 'PUT', body: JSON.stringify(payload) })
}
