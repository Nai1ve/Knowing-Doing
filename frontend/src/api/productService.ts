import { ApiError, apiClient } from './client'
import type { LabCaseId, LabExecutionResult } from '@/types/lab'
import type { ProductArtifact, ProductIntake, ProductLabAccess, ProductLabExecution, ProductMemory, ProductPlan, ProductPracticeHistoryPage, ProductPracticeRun, ProductPracticeStart, ProductSnapshot, ProductTutorResponse, ProductTutorStreamEvent, ProductWritingProject } from '@/types/product'

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
export function getProductPracticeHistory(cursor?: string, limit = 20): Promise<ProductPracticeHistoryPage> { return product(`/practice-runs?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`) }
export function reopenProductLab(runId: string): Promise<ProductPracticeStart> { return product(`/practice-runs/${runId}/reopen-lab`, { method: 'POST' }) }
export function sendProductTutor(runId: string, message: string): Promise<{ run: ProductPracticeRun; tutor: ProductTutorResponse; snapshot: ProductSnapshot }> { return product(`/practice-runs/${runId}/messages`, { method: 'POST', body: JSON.stringify({ message, clientRequestId: crypto.randomUUID() }) }) }

async function streamTutorRequest(path: string, body: Record<string, unknown>, onEvent: (event: ProductTutorStreamEvent) => void): Promise<void> {
  const headers = new Headers({ Accept: 'text/event-stream' }); headers.set('Content-Type', 'application/json'); headers.set('X-Learner-Id', learnerId())
  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL ?? '/api'}${path}`, { method: 'POST', headers, body: JSON.stringify(body) })
  if (!response.ok) {
    const text = await response.text(); let payload: unknown
    try { payload = JSON.parse(text) } catch { payload = text }
    throw new ApiError(response.status, `Tutor 请求失败（${response.status}）`, payload)
  }
  if (!response.body) throw new ApiError(503, 'Tutor 没有返回流', undefined)
  const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = ''; let eventName = ''; let data = ''
  const dispatch = () => {
    if (!data) return
    try { onEvent(JSON.parse(data) as ProductTutorStreamEvent) } catch { throw new ApiError(502, 'Tutor 事件无法解析') }
    eventName = ''; data = ''
  }
  while (true) {
    const chunk = await reader.read(); if (chunk.done) break
    buffer += decoder.decode(chunk.value, { stream: true })
    let lineEnd = buffer.indexOf('\n')
    while (lineEnd >= 0) {
      const line = buffer.slice(0, lineEnd).replace(/\r$/, ''); buffer = buffer.slice(lineEnd + 1)
      if (!line) dispatch()
      else if (line.startsWith('event:')) eventName = line.slice(6).trim()
      else if (line.startsWith('data:')) data += line.slice(5).trim()
      lineEnd = buffer.indexOf('\n')
    }
  }
  if (buffer.trim()) { if (buffer.startsWith('data:')) data += buffer.slice(5).trim(); dispatch() }
}

export function streamProductTutor(runId: string, message: string, clientRequestId: string, onEvent: (event: ProductTutorStreamEvent) => void): Promise<void> {
  return streamTutorRequest(`/product/practice-runs/${runId}/messages/stream`, { message, clientRequestId }, onEvent)
}
export function retryProductTutor(runId: string, invocationId: string, onEvent: (event: ProductTutorStreamEvent) => void): Promise<void> {
  return streamTutorRequest(`/product/practice-runs/${runId}/tutor-invocations/${invocationId}/retry`, {}, onEvent)
}
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
