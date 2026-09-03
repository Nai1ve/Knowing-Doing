import type { ProductPlan } from '@/types/product'
import { apiClient } from './client'

const learnerStorageKey = 'zhixing.learner.id'
function learnerId(): string {
  if (typeof window === 'undefined') return 'anonymous-web'
  const existing = window.localStorage.getItem(learnerStorageKey)
  if (existing) return existing
  const value = crypto.randomUUID(); window.localStorage.setItem(learnerStorageKey, value); return value
}
function request<T>(path: string, init: RequestInit = {}): Promise<T> { const headers = new Headers(init.headers); headers.set('X-Learner-Id', learnerId()); return apiClient.request<T>(path, { ...init, headers }) }

export async function getCurrentPlan(): Promise<ProductPlan | null> {
  return request<ProductPlan | null>('/product/plans/current')
}

export async function createMysqlPerformancePlan(): Promise<ProductPlan> {
  return request<ProductPlan>('/product/sample-plans/mysql-performance', { method: 'POST' })
}

export async function getPlan(planId: string): Promise<ProductPlan> {
  return request<ProductPlan>(`/product/plans/${planId}`)
}
