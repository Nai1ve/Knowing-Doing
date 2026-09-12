import { apiClient } from './client'
import type { AgentPlanningSession, AgentPlanningState, AgentRoadmapGeneration, CurrentRoadmapResponse, KnowledgeRoute, PlanningAssessment, PlanningAssessmentReview, PlanningAssessmentAnswer, PlanningRequirementBrief, PlanningStreamEvent, ProductPlanAdjustment, ProductResumeAttachment, RoadmapDraft, RoadmapNode, RoadmapNodePage, RoadmapTree } from '@/types/product'
import { createClientId } from '@/utils/client-id'

const learnerKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const current = localStorage.getItem(learnerKey); if (current) return current
  const value = createClientId(); localStorage.setItem(learnerKey, value); return value
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
export function createAgentPlanningSessionDraft(message: string, clientRequestId: string): Promise<AgentPlanningSession> { return request<AgentPlanningSession>('/product/planning-sessions/agent', { method: 'POST', body: JSON.stringify({ message, clientRequestId }) }) }
export function sendAgentPlanningMessage(sessionId: string, message: string, clientRequestId: string, onEvent: (event: PlanningStreamEvent) => void): Promise<void> { return streamRequest(`/product/planning-sessions/${sessionId}/messages/stream`, { message, clientRequestId }, onEvent) }
export function getAgentPlanningSession(sessionId: string): Promise<AgentPlanningSession> { return request<AgentPlanningSession>(`/product/planning-sessions/${sessionId}`) }
export function getAgentPlanningState(): Promise<AgentPlanningState> { return request<AgentPlanningState>('/product/planning/state') }
export function createAgentRoadmap(sessionId: string, clientRequestId: string): Promise<AgentRoadmapGeneration> { return request<AgentRoadmapGeneration>(`/product/planning-sessions/${sessionId}/roadmap-generations`, { method: 'POST', body: JSON.stringify({ clientRequestId }) }) }
export function getAgentRoadmapGeneration(id: string): Promise<AgentRoadmapGeneration> { return request<AgentRoadmapGeneration>(`/product/roadmap-generation-runs/${id}`) }
export function retryAgentRoadmap(id: string): Promise<AgentRoadmapGeneration> { return request<AgentRoadmapGeneration>(`/product/roadmap-generation-runs/${id}/retry`, { method: 'POST' }) }
export function retryAgentInvocation(id: string, onEvent: (event: PlanningStreamEvent) => void): Promise<void> { return streamRequest(`/product/planning-invocations/${id}/retry`, {}, onEvent) }
export function createPlanningAssessment(sessionId: string, clientRequestId = createClientId()): Promise<PlanningAssessment> { return request<PlanningAssessment>(`/product/planning-sessions/${sessionId}/assessments`, { method: 'POST', headers: { 'X-Client-Request-Id': clientRequestId }, body: JSON.stringify({ clientRequestId }) }) }
export function getPlanningAssessment(id: string): Promise<PlanningAssessment> { return request<PlanningAssessment>(`/product/planning-assessments/${id}`) }
export function savePlanningAssessmentAnswers(id: string, answers: Record<string, PlanningAssessmentAnswer>, skipped: string[], clientRequestId = createClientId()): Promise<PlanningAssessment> { return request<PlanningAssessment>(`/product/planning-assessments/${id}/answers`, { method: 'PUT', headers: { 'X-Client-Request-Id': clientRequestId }, body: JSON.stringify({ answers, skipped, clientRequestId }) }) }
export function finalizePlanningAssessment(id: string, mode: 'complete' | 'abandon', clientRequestId = createClientId()): Promise<PlanningAssessment> { return request<PlanningAssessment>(`/product/planning-assessments/${id}/finalize`, { method: 'POST', headers: { 'X-Client-Request-Id': clientRequestId }, body: JSON.stringify({ mode, clientRequestId }) }) }
export function getPlanningAssessmentReview(id: string): Promise<PlanningAssessmentReview> { return request<PlanningAssessmentReview>(`/product/planning-assessments/${id}/review`) }
export function confirmPlanningRequirementBrief(sessionId: string, requirementBrief: PlanningRequirementBrief, clientRequestId = createClientId()): Promise<AgentPlanningSession> { return request<AgentPlanningSession>(`/product/planning-sessions/${sessionId}/requirement-brief/confirm`, { method: 'POST', headers: { 'X-Client-Request-Id': clientRequestId }, body: JSON.stringify({ requirementBrief, clientRequestId }) }) }
export function getKnowledgeRoute(roadmapId: string, nodeId: string, refresh = false): Promise<KnowledgeRoute> {
  const path = `/product/roadmaps/${roadmapId}/nodes/${nodeId}/knowledge-route`
  return request<KnowledgeRoute>(path, refresh ? { method: 'POST', body: JSON.stringify({ refresh: true }) } : {})
}
export function sendKnowledgeFeedback(routeSetId: string, sourceItemId: string, feedback: 'read' | 'too_hard' | 'too_easy' | 'irrelevant' | 'helpful'): Promise<void> { return request<void>(`/product/knowledge-routes/${routeSetId}/feedback`, { method: 'POST', body: JSON.stringify({ sourceItemId, feedback }) }) }

export function uploadPlanningResume(sessionId: string, file: File, clientRequestId = createClientId()): Promise<ProductResumeAttachment> { const body = new FormData(); body.append('resume', file, file.name); return request<ProductResumeAttachment>(`/product/planning-sessions/${sessionId}/resume`, { method: 'POST', headers: { 'X-Client-Request-Id': clientRequestId }, body }) }
export function getRoadmapDraft(id: string): Promise<RoadmapDraft> { return request<RoadmapDraft>(`/product/roadmap-drafts/${id}`) }
export function confirmRoadmap(id: string, revision: number, startUnitKey?: string): Promise<unknown> { return request<unknown>(`/product/roadmap-drafts/${id}/confirm`, { method: 'POST', body: JSON.stringify({ revision, ...(startUnitKey ? { startUnitKey } : {}) }) }) }
export function getCurrentRoadmap(): Promise<CurrentRoadmapResponse> { return request<CurrentRoadmapResponse>('/product/roadmaps/current') }
export function getRoadmapTree(id: string, focusNodeId: string | null = null): Promise<RoadmapTree> { const query = new URLSearchParams({ depth: '2' }); if (focusNodeId) query.set('focusNodeId', focusNodeId); return request<RoadmapTree>(`/product/roadmaps/${id}/tree?${query.toString()}`) }
export function getRoadmapNodes(id: string, parentId: string | null): Promise<RoadmapNodePage> { const suffix = parentId ? `?parentId=${encodeURIComponent(parentId)}&depth=1` : '?depth=1'; return request<RoadmapNodePage>(`/product/roadmaps/${id}/nodes${suffix}`) }
export function completeRoadmapNode(roadmapId: string, nodeId: string, revision: number, status: 'completed' | 'self_reported' = 'completed'): Promise<RoadmapNode> { return request<RoadmapNode>(`/product/roadmaps/${roadmapId}/nodes/${nodeId}/complete`, { method: 'POST', body: JSON.stringify({ revision, status }) }) }
export function createPlanAdjustment(planId: string, requestText: string, clientRequestId: string): Promise<ProductPlanAdjustment> { return request<ProductPlanAdjustment>(`/product/plans/${planId}/adjustments`, { method: 'POST', body: JSON.stringify({ request: requestText, clientRequestId }) }) }
export function getPlanAdjustment(id: string): Promise<ProductPlanAdjustment> { return request<ProductPlanAdjustment>(`/product/plan-adjustments/${id}`) }
export function confirmPlanAdjustment(id: string): Promise<unknown> { return request<unknown>(`/product/plan-adjustments/${id}/confirm`, { method: 'POST' }) }
