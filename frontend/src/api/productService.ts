import { ApiError, apiClient } from './client'
import type { LabCaseId, LabExecutionResult } from '@/types/lab'
import type { ProductArtifact, ProductIntake, ProductLabAccess, ProductLabExecution, ProductMemory, ProductPlan, ProductPracticeRun, ProductPracticeStart, ProductSnapshot, ProductTutorResponse, ProductWritingProject } from '@/types/product'

const learnerStorageKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const existing = window.localStorage.getItem(learnerStorageKey)
  if (existing) return existing
  const value = crypto.randomUUID(); window.localStorage.setItem(learnerStorageKey, value); return value
}

function product<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers); headers.set('X-Learner-Id', learnerId())
  if (token) headers.set('Authorization', `Bearer ${token}`)
  return apiClient.request<T>(`/product${path}`, { ...init, headers })
}

export function createProductIntake(input: { goal: string; technology?: string; outcome?: string; weeklyMinutes?: number }): Promise<ProductIntake> { return product('/intakes', { method: 'POST', body: JSON.stringify(input) }) }
export function createProductPlan(intakeId: string): Promise<ProductPlan> { return product(`/intakes/${intakeId}/plan`, { method: 'POST' }) }
export function confirmProductPlan(planId: string): Promise<ProductPlan> { return product(`/plans/${planId}/confirm`, { method: 'POST' }) }
export function startProductPractice(caseId: LabCaseId, planUnitId?: string): Promise<ProductPracticeStart> { return product('/practice-runs', { method: 'POST', body: JSON.stringify({ caseId, planUnitId }) }) }
export function getProductSnapshot(runId: string): Promise<ProductSnapshot> { return product(`/practice-runs/${runId}`) }
export function getProductLabAccess(runId: string): Promise<ProductLabAccess> { return product(`/practice-runs/${runId}/lab`) }
export function sendProductTutor(runId: string, message: string): Promise<{ run: ProductPracticeRun; tutor: ProductTutorResponse; snapshot: ProductSnapshot }> { return product(`/practice-runs/${runId}/messages`, { method: 'POST', body: JSON.stringify({ message, clientRequestId: crypto.randomUUID() }) }) }
export function submitProductArtifact(runId: string, content: string): Promise<ProductArtifact> { return product(`/practice-runs/${runId}/artifacts`, { method: 'POST', body: JSON.stringify({ content, kind: 'external_text', sourceKind: 'user' }) }) }
export function executeProductLab(runId: string, labToken: string, input: { revision: number; sessionId: string; statement: string; clientRequestId: string }): Promise<ProductLabExecution> {
  return product<ProductLabExecution>(`/practice-runs/${runId}/lab-executions`, { method: 'POST', body: JSON.stringify(input) }, labToken).catch((error: unknown) => {
    if (error instanceof ApiError && [422, 504].includes(error.status) && error.payload && typeof error.payload === 'object' && 'execution' in error.payload) return error.payload as ProductLabExecution
    throw error
  })
}
export function verifyProductPractice(runId: string): Promise<{ run: ProductPracticeRun; decision: { outcome: string; reason: string; nextGap: string }; snapshot: ProductSnapshot }> { return product(`/practice-runs/${runId}/verify`, { method: 'POST' }) }
export function generateProductOutline(runId: string): Promise<{ artifact: ProductArtifact; snapshot: ProductSnapshot }> { return product(`/practice-runs/${runId}/note-outline`, { method: 'POST' }) }
export function generateProductArticle(runId: string, outline?: string): Promise<{ artifact: ProductArtifact; snapshot: ProductSnapshot }> { return product(`/practice-runs/${runId}/article-draft`, { method: 'POST', body: JSON.stringify({ outline }) }) }
export function getProductMemories(): Promise<ProductMemory[]> { return product('/memories') }
export function updateProductMemory(memoryId: string, input: { statement?: string; userNote?: string | null; status?: string }): Promise<ProductMemory> { return product(`/memories/${memoryId}`, { method: 'PATCH', body: JSON.stringify(input) }) }
export function initializeWriting(runId: string): Promise<ProductWritingProject> { return product(`/practice-runs/${runId}/writing`, { method: 'POST' }) }
export function getWriting(runId: string): Promise<ProductWritingProject> { return product(`/practice-runs/${runId}/writing`) }
export function selectWritingMaterial(runId: string, materialId: string, selected: boolean, editorialNote?: string | null): Promise<ProductWritingProject> {
  return product(`/practice-runs/${runId}/writing/materials/${materialId}`, { method: 'PATCH', body: JSON.stringify({ selected, editorialNote }) })
}
export function generateWritingOutline(runId: string): Promise<ProductWritingProject> { return product(`/practice-runs/${runId}/writing/outline`, { method: 'POST' }) }
export function generateWritingArticle(runId: string): Promise<ProductWritingProject> { return product(`/practice-runs/${runId}/writing/article`, { method: 'POST' }) }
export function reviewWriting(runId: string): Promise<ProductWritingProject> { return product(`/practice-runs/${runId}/writing/review`, { method: 'POST' }) }
export function editWritingSection(runId: string, documentId: string, sectionId: string, revision: number, content: string): Promise<ProductWritingProject> {
  return product(`/practice-runs/${runId}/writing/documents/${documentId}/sections/${sectionId}`, { method: 'PATCH', body: JSON.stringify({ revision, content }) })
}
