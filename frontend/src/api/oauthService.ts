import { mockConnections } from '@/data/mock'
import type { OAuthConnection } from '@/types/domain'
import { apiClient } from './client'
import { useMockApi } from './mode'

export async function getConnections(): Promise<OAuthConnection[]> {
  if (useMockApi) return structuredClone(mockConnections)
  return apiClient.request<OAuthConnection[]>('/auth/connections')
}

export function getOAuthAuthorizationUrl(provider: OAuthConnection['provider']): string {
  const redirectUri = `${window.location.origin}/settings/connections/callback`
  const params = new URLSearchParams({ provider, redirect_uri: redirectUri })
  return `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/auth/oauth/authorize?${params.toString()}`
}

export async function disconnectOAuth(provider: OAuthConnection['provider']): Promise<void> {
  if (useMockApi) return
  await apiClient.request(`/auth/connections/${provider}`, { method: 'DELETE' })
}
