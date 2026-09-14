import { ref } from 'vue'
import { defineStore } from 'pinia'
import { disconnectOAuth, getConnections, startZhihuOAuth } from '@/api/oauthService'
import type { OAuthConnection } from '@/types/domain'
import { apiClient } from '@/api/client'
import { saveOAuthReturnPath } from '@/utils/auth-flow'

export interface AuthSession {
  learnerId: string
  csrfToken?: string
  expiresAt: string
  auth: {
    required: boolean
    authenticated: boolean
    provider: 'zhihu' | null
    profile: { displayName: string | null; avatarUrl: string | null; profileUrl: string | null } | null
  }
}

export const useAuthStore = defineStore('auth', () => {
  const connections = ref<OAuthConnection[]>([])
  const loading = ref(false)
  const bootstrapping = ref(false)
  const session = ref<AuthSession | null>(null)
  const callbackMessage = ref('')
  const bootstrapError = ref<string | null>(null)
  const csrfRefreshRequired = ref(false)
  let bootstrapPromise: Promise<AuthSession | null> | null = null

  function fixtureConnections(): OAuthConnection[] { return [{ provider: 'zhihu', status: 'disconnected', scopes: ['读取已授权内容', '同步收藏'], account: undefined }, { provider: 'model', status: 'disconnected', scopes: ['Tutor Agent'] }] }

  function isAuthSession(value: unknown): value is AuthSession {
    if (!value || typeof value !== 'object') return false
    const candidate = value as Partial<AuthSession>
    return typeof candidate.learnerId === 'string' && typeof candidate.expiresAt === 'string' && Boolean(candidate.auth) && typeof candidate.auth?.required === 'boolean' && typeof candidate.auth?.authenticated === 'boolean'
  }

  async function bootstrapSession(force = false): Promise<AuthSession | null> {
    if (bootstrapPromise) return bootstrapPromise
    if (!force && session.value && !csrfRefreshRequired.value) return session.value
    bootstrapping.value = true
    bootstrapError.value = null
    bootstrapPromise = (async () => {
      try {
        const response = await apiClient.request<unknown>('/auth/session', { method: 'POST' })
        if (!isAuthSession(response)) throw new Error('认证会话响应格式无效')
        session.value = response
        csrfRefreshRequired.value = false
        if (typeof response.csrfToken === 'string' && response.csrfToken) localStorage.setItem('zhixing.csrf-token', response.csrfToken)
        else localStorage.removeItem('zhixing.csrf-token')
        callbackMessage.value = ''
        return response
      } catch {
        // A response can be successful at HTTP level but invalid at the DTO level.
        // Do not let a possibly rotated token survive the GET recovery path.
        localStorage.removeItem('zhixing.csrf-token')
        csrfRefreshRequired.value = true
        try {
          const response = await apiClient.request<unknown>('/auth/session', { method: 'GET' })
          if (!isAuthSession(response)) throw new Error('认证会话响应格式无效')
          session.value = response
          callbackMessage.value = '登录状态已恢复，但写入凭证未刷新，请重新检查。'
          bootstrapError.value = callbackMessage.value
          return response
        } catch {
          session.value = null
          bootstrapError.value = '认证服务暂时不可用，请检查网络后重试。'
          callbackMessage.value = bootstrapError.value
          return null
        }
      } finally {
        bootstrapping.value = false
      }
    })()
    try { return await bootstrapPromise } finally { bootstrapPromise = null }
  }

  async function loadConnections(force = false) {
    await bootstrapSession()
    if (connections.value.length && !force) return
    loading.value = true
    try { connections.value = await getConnections() } catch { connections.value = session.value?.auth.required === false && import.meta.env.VITE_ENABLE_LEARNING_FIXTURES === 'true' ? fixtureConnections() : [] } finally { loading.value = false }
  }

  async function authorize(provider: OAuthConnection['provider'], redirectPath?: unknown): Promise<boolean> {
    if (provider !== 'zhihu') return false
    try {
      if (!await bootstrapSession()) return false
      saveOAuthReturnPath(redirectPath)
      const { authorizationUrl } = await startZhihuOAuth()
      window.location.href = authorizationUrl
      return true
    }
    catch { callbackMessage.value = '知乎授权暂时不可用，请稍后重试。'; return false }
  }

  async function refreshAfterOAuth() {
    const refreshed = await bootstrapSession(true)
    await loadConnections(true)
    return refreshed
  }

  async function disconnect(provider: OAuthConnection['provider']) {
    await bootstrapSession()
    await disconnectOAuth(provider)
    await refreshAfterOAuth()
  }

  return { connections, loading, bootstrapping, session, callbackMessage, bootstrapError, csrfRefreshRequired, bootstrapSession, loadConnections, authorize, refreshAfterOAuth, disconnect }
})
