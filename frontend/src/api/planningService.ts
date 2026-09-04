import { apiClient } from './client'
import type { AgentPlanningSession, AgentRoadmapGeneration, CurrentRoadmapResponse, PlanningSession, PlanningStreamEvent, ProductResumeAttachment, RoadmapDraft, RoadmapNode, RoadmapNodePage } from '@/types/product'

const learnerKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const current = localStorage.getItem(learnerKey); if (current) return current
  const value = crypto.randomUUID(); localStorage.setItem(learnerKey, value); return value
}
function request<T>(path: string, init: RequestInit = {}): Promise<T> { const headers = new Headers(init.headers); headers.set('X-Learner-Id', learnerId()); return apiClient.request<T>(path, { ...init, headers }) }

async function streamRequest(path: string, body: Record<string, unknown>, onEvent: (event: PlanningStreamEvent) => void): Promise<void> {
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}${path}`, { method: 'POST', headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', 'X-Learner-Id': learnerId() }, body: JSON.stringify(body) })
  if (!response.ok) throw new Error(`规划请求失败：${response.status}`)
  if (!response.body) throw new Error('规划服务没有返回事件流')
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''
  const consume = (chunk: string) => {
    buffer += chunk
    const parts = buffer.split(/\r?\n\r?\n/); buffer = parts.pop() ?? ''
    for (const part of parts) {
      const data = part.split(/\r?\n/).find((line) => line.startsWith('data:'))?.slice(5).trim()
      if (!data) continue
      try { onEvent(JSON.parse(data) as PlanningStreamEvent) } catch { throw new Error('规划服务返回了无效事件') }
    }
  }
  while (true) { const result = await reader.read(); if (result.done) break; consume(decoder.decode(result.value, { stream: true })) }
  if (buffer.trim()) consume('\n\n')
}

export function createAgentPlanningSession(message: string, clientRequestId: string, onEvent: (event: PlanningStreamEvent) => void): Promise<void> { return streamRequest('/product/planning-sessions/stream', { message, clientRequestId }, onEvent) }
export function sendAgentPlanningMessage(sessionId: string, message: string, clientRequestId: string, onEvent: (event: PlanningStreamEvent) => void): Promise<void> { return streamRequest(`/product/planning-sessions/${sessionId}/messages/stream`, { message, clientRequestId }, onEvent) }
export function getAgentPlanningSession(sessionId: string): Promise<AgentPlanningSession> { return request<AgentPlanningSession>(`/product/planning-sessions/${sessionId}`) }
export function createAgentRoadmap(sessionId: string, clientRequestId: string): Promise<AgentRoadmapGeneration> { return request<AgentRoadmapGeneration>(`/product/planning-sessions/${sessionId}/roadmap-generations`, { method: 'POST', body: JSON.stringify({ clientRequestId }) }) }
export function getAgentRoadmapGeneration(id: string): Promise<AgentRoadmapGeneration> { return request<AgentRoadmapGeneration>(`/product/roadmap-generation-runs/${id}`) }
export function retryAgentInvocation(id: string, onEvent: (event: PlanningStreamEvent) => void): Promise<void> { return streamRequest(`/product/planning-invocations/${id}/retry`, {}, onEvent) }

export function createPlanningSession(goal?: string): Promise<PlanningSession> { return request<PlanningSession>('/product/planning-sessions', { method: 'POST', body: JSON.stringify({ goal, clientRequestId: crypto.randomUUID() }) }) }
export function getPlanningSession(id: string): Promise<PlanningSession> { return request<PlanningSession>(`/product/planning-sessions/${id}`) }
export function uploadPlanningResume(sessionId: string, file: File): Promise<ProductResumeAttachment> { const body = new FormData(); body.append('resume', file, file.name); return request<ProductResumeAttachment>(`/product/planning-sessions/${sessionId}/resume`, { method: 'POST', body }) }
export function addPlanningTurn(id: string, input: { revision: number; stepKey: string; answer: string; structuredValue?: unknown }): Promise<PlanningSession> { return request<PlanningSession>(`/product/planning-sessions/${id}/turns`, { method: 'POST', body: JSON.stringify(input) }) }
export function adjustPlanning(id: string, input: { revision: number; weeklyMinutes?: number; priorityDomain?: string; masteredNodeKeys?: string[] }): Promise<RoadmapDraft> { return request<RoadmapDraft>(`/product/planning-sessions/${id}/adjustments`, { method: 'POST', body: JSON.stringify(input) }) }
export function getRoadmapDraft(id: string): Promise<RoadmapDraft> { return request<RoadmapDraft>(`/product/roadmap-drafts/${id}`) }
export function confirmRoadmap(id: string, revision: number): Promise<unknown> { return request<unknown>(`/product/roadmap-drafts/${id}/confirm`, { method: 'POST', body: JSON.stringify({ revision }) }) }
export function getCurrentRoadmap(): Promise<CurrentRoadmapResponse> { return request<CurrentRoadmapResponse>('/product/roadmaps/current') }
export function getRoadmapNodes(id: string, parentId: string | null): Promise<RoadmapNodePage> { const suffix = parentId ? `?parentId=${encodeURIComponent(parentId)}&depth=1` : '?depth=1'; return request<RoadmapNodePage>(`/product/roadmaps/${id}/nodes${suffix}`) }
export function completeRoadmapNode(roadmapId: string, nodeId: string, revision: number, status: 'completed' | 'self_reported' = 'completed'): Promise<RoadmapNode> { return request<RoadmapNode>(`/product/roadmaps/${roadmapId}/nodes/${nodeId}/complete`, { method: 'POST', body: JSON.stringify({ revision, status }) }) }
