import type { OAuthConnection } from '@/types/domain'
import { apiClient } from './client'
import { createClientId } from '@/utils/client-id'

export async function getConnections(): Promise<OAuthConnection[]> {
  return apiClient.request<OAuthConnection[]>('/auth/connections')
}

export async function startZhihuOAuth(): Promise<{ authorizationUrl: string }> {
  return apiClient.request<{ authorizationUrl: string }>('/auth/oauth/zhihu/start', { method: 'POST', headers: { 'Idempotency-Key': createClientId() } })
}

export async function disconnectOAuth(provider: OAuthConnection['provider']): Promise<void> {
  await apiClient.request(`/auth/connections/${provider}`, { method: 'DELETE' })
}

export async function logoutOAuth(): Promise<void> {
  // POST /api/auth/logout revokes the current device session and clears the
  // cookie; 200 is also returned idempotently when the session is already gone.
  await apiClient.request('/auth/logout', { method: 'POST' })
}
