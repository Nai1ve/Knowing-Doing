import type { ProductPlan } from '@/types/product'
import { apiClient } from './client'

export async function getActivePlan(): Promise<ProductPlan | null> {
  return apiClient.request<ProductPlan | null>('/product/plans/active')
}

export async function createMysqlPerformancePlan(): Promise<ProductPlan> {
  return apiClient.request<ProductPlan>('/product/sample-plans/mysql-performance', { method: 'POST' })
}

export async function getPlan(planId: string): Promise<ProductPlan> {
  return apiClient.request<ProductPlan>(`/product/plans/${planId}`)
}
