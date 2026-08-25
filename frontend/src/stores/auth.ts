import { ref } from 'vue'
import { defineStore } from 'pinia'
import { disconnectOAuth, getConnections, getOAuthAuthorizationUrl } from '@/api/oauthService'
import { useMockApi } from '@/api/mode'
import type { OAuthConnection } from '@/types/domain'

export const useAuthStore = defineStore('auth', () => {
  const connections = ref<OAuthConnection[]>([])
  const loading = ref(false)

  async function loadConnections() {
    if (connections.value.length) return
    loading.value = true
    try { connections.value = await getConnections() } finally { loading.value = false }
  }

  function authorize(provider: OAuthConnection['provider']): boolean {
    if (useMockApi) return false
    window.location.href = getOAuthAuthorizationUrl(provider)
    return true
  }

  async function disconnect(provider: OAuthConnection['provider']) {
    await disconnectOAuth(provider)
    const connection = connections.value.find((item) => item.provider === provider)
    if (connection) connection.status = 'disconnected'
  }

  return { connections, loading, loadConnections, authorize, disconnect }
})
