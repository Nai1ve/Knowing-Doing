import { ref } from 'vue'
import { defineStore } from 'pinia'
import { disconnectOAuth, getConnections, startZhihuOAuth } from '@/api/oauthService'
import type { OAuthConnection } from '@/types/domain'
import { apiClient } from '@/api/client'

interface AuthSession { id: string; csrfToken: string; expiresAt?: string }

export const useAuthStore = defineStore('auth', () => {
  const connections = ref<OAuthConnection[]>([])
  const loading = ref(false)
  const bootstrapping = ref(false)
  const session = ref<AuthSession | null>(null)
  const callbackMessage = ref('')

  function fixtureConnections(): OAuthConnection[] { return [{ provider: 'zhihu', status: 'disconnected', scopes: ['读取已授权内容', '同步收藏'], account: undefined }, { provider: 'model', status: 'disconnected', scopes: ['Tutor Agent'] }] }

  async function bootstrapSession() {
    if (bootstrapping.value || session.value) return session.value
    bootstrapping.value = true
    try {
      const response = await apiClient.request<AuthSession>('/auth/session', { method: 'POST' })
      session.value = response
      localStorage.setItem('zhixing.csrf-token', response.csrfToken)
    } catch {
      session.value = null
      localStorage.removeItem('zhixing.csrf-token')
      callbackMessage.value = '设备会话暂时不可用；旧版只读流程仍可继续，写操作会等服务端 session 恢复。'
    } finally { bootstrapping.value = false }
    return session.value
  }

  async function loadConnections(force = false) {
    await bootstrapSession()
    if (connections.value.length && !force) return
    loading.value = true
    try { connections.value = await getConnections() } catch { connections.value = import.meta.env.VITE_ENABLE_LEARNING_FIXTURES === 'true' ? fixtureConnections() : [] } finally { loading.value = false }
  }

  async function authorize(provider: OAuthConnection['provider']): Promise<boolean> {
    if (provider !== 'zhihu') return false
    try { const { authorizationUrl } = await startZhihuOAuth(); window.location.href = authorizationUrl; return true }
    catch { callbackMessage.value = '知乎授权暂时不可用，请稍后重试。'; return false }
  }

  async function disconnect(provider: OAuthConnection['provider']) {
    await bootstrapSession()
    await disconnectOAuth(provider)
    const connection = connections.value.find((item) => item.provider === provider)
    if (connection) connection.status = 'disconnected'
  }

  return { connections, loading, bootstrapping, session, callbackMessage, bootstrapSession, loadConnections, authorize, disconnect }
})
