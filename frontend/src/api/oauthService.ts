import type { OAuthConnection } from '@/types/domain'
import { apiClient } from './client'

export async function getConnections(): Promise<OAuthConnection[]> {
  return apiClient.request<OAuthConnection[]>('/auth/connections')
}

export function getOAuthAuthorizationUrl(provider: OAuthConnection['provider']): string {
  const redirectUri = `${window.location.origin}/settings/connections/callback`
  const params = new URLSearchParams({ provider, redirect_uri: redirectUri })
  return `${import.meta.env.VITE_API_BASE_URL ?? '/api'}/auth/oauth/authorize?${params.toString()}`
}

export async function disconnectOAuth(provider: OAuthConnection['provider']): Promise<void> {
  await apiClient.request(`/auth/connections/${provider}`, { method: 'DELETE' })
}
