import { apiClient } from './client'
import type { CurrentRoadmapResponse, PlanningSession, ProductResumeAttachment, RoadmapDraft, RoadmapNode, RoadmapNodePage } from '@/types/product'

const learnerKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const current = localStorage.getItem(learnerKey); if (current) return current
  const value = crypto.randomUUID(); localStorage.setItem(learnerKey, value); return value
}
function request<T>(path: string, init: RequestInit = {}): Promise<T> { const headers = new Headers(init.headers); headers.set('X-Learner-Id', learnerId()); return apiClient.request<T>(path, { ...init, headers }) }

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
