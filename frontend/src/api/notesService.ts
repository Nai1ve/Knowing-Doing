import { mockPracticeEvents } from '@/data/mock'
import type { PracticeEvent } from '@/types/domain'
import { apiClient } from './client'
import { useMockApi } from './mode'

export async function getPracticeEvents(planId: string): Promise<PracticeEvent[]> {
  if (useMockApi) return structuredClone(mockPracticeEvents)
  return apiClient.request<PracticeEvent[]>(`/plans/${planId}/practice-events`)
}

export async function createPracticeEvent(planId: string, event: Omit<PracticeEvent, 'id' | 'createdAt'>): Promise<PracticeEvent> {
  if (useMockApi) return { ...event, id: `event-${Date.now()}`, createdAt: '刚刚' }
  return apiClient.request<PracticeEvent>(`/plans/${planId}/practice-events`, { method: 'POST', body: JSON.stringify(event) })
}

export async function generateOutline(planId: string): Promise<string> {
  if (useMockApi) return '# 从一份最小 YAML 理解 Deployment 的期望状态\n\n## 1. 我原本的问题\n- 为什么 replicas 是 3，却可能只有 2 个 Pod Ready？\n\n## 2. 我参考了什么\n- Deployment、ReplicaSet 与 Pod 的控制关系\n- 先看期望、当前、Ready，再看 Events 的排查顺序\n\n## 3. 实践中遇到的错误\n- deployment.yaml 缩进错误，kubectl apply 无法通过\n\n## 4. 我最终形成的判断\n- 先描述现象，再列证据，最后说明控制器如何恢复期望状态\n\n## 5. 给读者的可复现练习\n- 写一份 replicas: 3 的最小 Deployment'
  return (await apiClient.request<{ content: string }>(`/plans/${planId}/notes/outline`, { method: 'POST' })).content
}

export async function saveNoteDraft(planId: string, payload: { outline: string; article: string }): Promise<void> {
  if (useMockApi) return
  await apiClient.request(`/plans/${planId}/notes/draft`, { method: 'PUT', body: JSON.stringify(payload) })
}
