import { apiClient } from './client'
import type { DiagnosticTargetKey, ProductDiagnosticSession, ProductOnboardingState, ProductPlan, ProductPlanProposal } from '@/types/product'

const learnerStorageKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const existing = window.localStorage.getItem(learnerStorageKey)
  if (existing) return existing
  const value = crypto.randomUUID(); window.localStorage.setItem(learnerStorageKey, value); return value
}

function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers); headers.set('X-Learner-Id', learnerId())
  return apiClient.request<T>(path, { ...init, headers })
}

export function getOnboardingState(): Promise<ProductOnboardingState> { return request<ProductOnboardingState>('/product/onboarding/state') }
export function createDiagnosticSession(input: { targetKey: DiagnosticTargetKey; goal: string; clientRequestId?: string }): Promise<ProductDiagnosticSession> { return request<ProductDiagnosticSession>('/product/diagnostic-sessions', { method: 'POST', body: JSON.stringify(input) }) }
export function getDiagnosticSession(sessionId: string): Promise<ProductDiagnosticSession> { return request<ProductDiagnosticSession>(`/product/diagnostic-sessions/${sessionId}`) }
export function saveDiagnosticSession(sessionId: string, input: { revision: number; goal: string; experience: string; selfAssessment: string; weeklyMinutes: number; outcome: string; contextNote: string }): Promise<ProductDiagnosticSession> { return request<ProductDiagnosticSession>(`/product/diagnostic-sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(input) }) }
export function createPlanProposal(sessionId: string): Promise<ProductPlanProposal> { return request<ProductPlanProposal>(`/product/diagnostic-sessions/${sessionId}/proposals`, { method: 'POST' }) }
export function getPlanProposal(proposalId: string): Promise<ProductPlanProposal> { return request<ProductPlanProposal>(`/product/plan-proposals/${proposalId}`) }
export function confirmPlanProposal(proposalId: string, revision: number): Promise<ProductPlan> { return request<ProductPlan>(`/product/plan-proposals/${proposalId}/confirm`, { method: 'POST', body: JSON.stringify({ revision }) }) }
