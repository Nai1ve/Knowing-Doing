import { mockProfile } from '@/data/mock'
import type { UserProfile } from '@/types/domain'
import { apiClient } from './client'
import { useMockApi } from './mode'

export async function getProfile(): Promise<UserProfile> {
  if (useMockApi) return structuredClone(mockProfile)
  return apiClient.request<UserProfile>('/profile')
}
