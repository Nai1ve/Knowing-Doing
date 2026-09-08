import { apiClient } from './client'
import type { ProductCaseGenerationJob, ProductCaseInput, ProductLearningCase, ProductWorkspaceSummary } from '@/types/product'
import { createClientId } from '@/utils/client-id'

const learnerKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const existing = window.localStorage.getItem(learnerKey); if (existing) return existing
  const value = createClientId(); window.localStorage.setItem(learnerKey, value); return value
}
function request<T>(path: string, init: RequestInit = {}): Promise<T> { const headers = new Headers(init.headers); headers.set('X-Learner-Id', learnerId()); return apiClient.request<T>(path, { ...init, headers }) }

export function createCaseRequest(nodeId: string, input: ProductCaseInput, options: { desiredOutcome?: string; difficulty?: 'introductory' | 'applied' | 'advanced'; clientRequestId?: string } = {}): Promise<{ case: ProductLearningCase; job: ProductCaseGenerationJob }> {
  return request(`/product/roadmap-nodes/${encodeURIComponent(nodeId)}/case-requests`, { method: 'POST', body: JSON.stringify({ input, desiredOutcome: options.desiredOutcome, difficulty: options.difficulty, clientRequestId: options.clientRequestId ?? createClientId() }) })
}
export function getCaseGenerationJob(jobId: string): Promise<{ case: ProductLearningCase; job: ProductCaseGenerationJob }> { return request(`/product/case-generation-jobs/${encodeURIComponent(jobId)}`) }
export function retryCaseGeneration(jobId: string): Promise<{ case: ProductLearningCase; job: ProductCaseGenerationJob }> { return request(`/product/case-generation-jobs/${encodeURIComponent(jobId)}/retry`, { method: 'POST' }) }
export function startCasePractice(caseId: string): Promise<ProductWorkspaceSummary> { return request(`/product/learning-cases/${encodeURIComponent(caseId)}/practice`, { method: 'POST' }) }
export function getWorkspaceRun(workspaceRunId: string): Promise<ProductWorkspaceSummary> { return request(`/product/workspace-runs/${encodeURIComponent(workspaceRunId)}`) }
export function saveWorkspaceFile(workspaceRunId: string, path: string, content: string, expectedRevision: number): Promise<ProductWorkspaceSummary> { return request(`/product/workspace-runs/${encodeURIComponent(workspaceRunId)}/files/${encodeURIComponent(path)}`, { method: 'PATCH', body: JSON.stringify({ content, expectedRevision }) }) }
export function executeWorkspace(workspaceRunId: string, command: string, clientRequestId = createClientId()): Promise<{ execution: ProductWorkspaceSummary['executions'][number]; workspace: ProductWorkspaceSummary }> { return request(`/product/workspace-runs/${encodeURIComponent(workspaceRunId)}/executions`, { method: 'POST', body: JSON.stringify({ command, clientRequestId }) }) }
export function resetWorkspace(workspaceRunId: string): Promise<ProductWorkspaceSummary> { return request(`/product/workspace-runs/${encodeURIComponent(workspaceRunId)}/reset`, { method: 'POST' }) }
export function endWorkspace(workspaceRunId: string): Promise<ProductWorkspaceSummary> { return request(`/product/workspace-runs/${encodeURIComponent(workspaceRunId)}/end`, { method: 'POST' }) }
