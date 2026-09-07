import type { ProductProfileEvidence } from '@/types/product'
import { apiClient } from './client'
import { createClientId } from '@/utils/client-id'

const learnerStorageKey = 'zhixing.learner.id'
function learnerId(): string { if (typeof window === 'undefined') return 'anonymous-web'; const existing = window.localStorage.getItem(learnerStorageKey); if (existing) return existing; const value = createClientId(); window.localStorage.setItem(learnerStorageKey, value); return value }
export function getProfileEvidence(): Promise<ProductProfileEvidence[]> { return apiClient.request<ProductProfileEvidence[]>('/product/profile/evidence', { headers: { 'X-Learner-Id': learnerId() } }) }
