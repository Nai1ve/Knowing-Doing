import { apiClient } from './client'
import { confirmMockPlanProposal, createMockDiagnosticSession, createMockPlanProposal, getMockDiagnosticSession, getMockOnboardingState, getMockPlanProposal, saveMockDiagnosticSession } from '@/data/mockProduct'
import type { DiagnosticTargetKey, ProductDiagnosticSession, ProductOnboardingState, ProductPlan, ProductPlanProposal } from '@/types/product'
import { useMockApi } from './mode'

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

export function getOnboardingState(): Promise<ProductOnboardingState> { return useMockApi ? Promise.resolve(getMockOnboardingState()) : request<ProductOnboardingState>('/product/onboarding/state') }
export function regeneratePlan(_clientRequestId: string): Promise<ProductDiagnosticSession> { return useMockApi ? Promise.resolve(createMockDiagnosticSession()) : request<ProductDiagnosticSession>('/product/plans/regenerate', { method: 'POST', body: JSON.stringify({ clientRequestId: _clientRequestId }) }) }
export function createDiagnosticSession(input: { targetKey: DiagnosticTargetKey; goal: string; clientRequestId?: string }): Promise<ProductDiagnosticSession> { return useMockApi ? Promise.resolve(createMockDiagnosticSession(input.goal)) : request<ProductDiagnosticSession>('/product/diagnostic-sessions', { method: 'POST', body: JSON.stringify(input) }) }
export function getDiagnosticSession(sessionId: string): Promise<ProductDiagnosticSession> { return useMockApi ? Promise.resolve(getMockDiagnosticSession(sessionId)) : request<ProductDiagnosticSession>(`/product/diagnostic-sessions/${sessionId}`) }
export function saveDiagnosticSession(sessionId: string, input: { revision: number; goal: string; experience: string; selfAssessment: string; weeklyMinutes: number; outcome: string; contextNote: string }): Promise<ProductDiagnosticSession> { return useMockApi ? Promise.resolve(saveMockDiagnosticSession(sessionId, input)) : request<ProductDiagnosticSession>(`/product/diagnostic-sessions/${sessionId}`, { method: 'PATCH', body: JSON.stringify(input) }) }
export function createPlanProposal(sessionId: string): Promise<ProductPlanProposal> { return useMockApi ? Promise.resolve(createMockPlanProposal(sessionId)) : request<ProductPlanProposal>(`/product/diagnostic-sessions/${sessionId}/proposals`, { method: 'POST' }) }
export function getPlanProposal(proposalId: string): Promise<ProductPlanProposal> { return useMockApi ? Promise.resolve(getMockPlanProposal(proposalId)) : request<ProductPlanProposal>(`/product/plan-proposals/${proposalId}`) }
export function confirmPlanProposal(proposalId: string, revision: number): Promise<ProductPlan> { return useMockApi ? Promise.resolve(confirmMockPlanProposal()) : request<ProductPlan>(`/product/plan-proposals/${proposalId}/confirm`, { method: 'POST', body: JSON.stringify({ revision }) }) }
