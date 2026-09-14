// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import type { OAuthConnection } from '@/types/domain'
import { useAuthStore, type AuthSession } from './auth'
import { disconnectOAuth, getConnections, startZhihuOAuth } from '@/api/oauthService'

vi.mock('@/api/oauthService', () => ({
  disconnectOAuth: vi.fn(),
  getConnections: vi.fn(),
  startZhihuOAuth: vi.fn(),
}))

const session = (overrides: Partial<Pick<AuthSession, 'csrfToken'>> & { auth?: AuthSession['auth'] } = {}) => ({
  ...baseSession(),
  ...overrides,
})

function baseSession() {
  return {
    learnerId: 'server-learner-id-must-not-be-used-as-a-credential',
    expiresAt: '2026-09-15T00:00:00.000Z',
    auth: {
      required: true,
      authenticated: false,
      provider: null as 'zhihu' | null,
      profile: null,
    },
  }
}

const connectedZhihu: OAuthConnection = {
  provider: 'zhihu',
  status: 'connected',
  scopes: ['读取已授权内容'],
  account: '知乎用户',
}

const request = vi.spyOn(apiClient, 'request')

describe('auth store', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    localStorage.clear()
    vi.clearAllMocks()
  })

  afterAll(() => {
    request.mockRestore()
  })

  it('stores the server auth state and only stores a CSRF token returned by POST', async () => {
    const authenticated = session({ csrfToken: 'csrf-from-post', auth: { required: true, authenticated: true, provider: 'zhihu', profile: { displayName: '小知', avatarUrl: null, profileUrl: null } } })
    request.mockResolvedValue(authenticated)

    const store = useAuthStore()
    await store.bootstrapSession()

    expect(store.session?.auth.authenticated).toBe(true)
    expect(store.session?.auth.profile?.displayName).toBe('小知')
    expect(localStorage.getItem('zhixing.csrf-token')).toBe('csrf-from-post')
  })

  it('recovers with GET without accepting or retaining a CSRF token from GET', async () => {
    localStorage.setItem('zhixing.csrf-token', 'csrf-from-previous-post')
    const recovered = session({ auth: { required: true, authenticated: false, provider: null, profile: null } })
    request.mockRejectedValueOnce(new Error('POST unavailable')).mockResolvedValueOnce(recovered)

    const store = useAuthStore()
    await store.bootstrapSession()

    expect(request).toHaveBeenNthCalledWith(1, '/auth/session', { method: 'POST' })
    expect(request).toHaveBeenNthCalledWith(2, '/auth/session', { method: 'GET' })
    expect(store.session?.auth.required).toBe(true)
    expect(localStorage.getItem('zhixing.csrf-token')).toBeNull()
  })

  it('clears a stale CSRF token when POST returns an invalid DTO, then retries POST once on the next bootstrap', async () => {
    localStorage.setItem('zhixing.csrf-token', 'possibly-rotated-token')
    const recovered = session({ auth: { required: true, authenticated: true, provider: 'zhihu', profile: null } })
    request.mockResolvedValueOnce({ learnerId: 'invalid-dto' }).mockResolvedValueOnce(recovered)

    const store = useAuthStore()
    await store.bootstrapSession()

    expect(localStorage.getItem('zhixing.csrf-token')).toBeNull()
    expect(store.session?.auth.authenticated).toBe(true)
    expect(store.bootstrapError).toContain('写入凭证未刷新')
    expect(store.csrfRefreshRequired).toBe(true)

    request.mockResolvedValueOnce(session({ csrfToken: 'fresh-csrf' }))
    await store.bootstrapSession()

    expect(localStorage.getItem('zhixing.csrf-token')).toBe('fresh-csrf')
    expect(store.csrfRefreshRequired).toBe(false)
    expect(request).toHaveBeenCalledTimes(3)
  })

  it('does not invent an authenticated session when both bootstrap requests fail', async () => {
    request.mockRejectedValue(new Error('network unavailable'))

    const store = useAuthStore()
    await store.bootstrapSession()

    expect(store.session).toBeNull()
    expect(store.bootstrapError).toContain('认证服务暂时不可用')
    expect(store.callbackMessage).toContain('认证服务暂时不可用')
  })

  it('refreshes both session and connections after an OAuth callback', async () => {
    const authenticated = session({ auth: { required: true, authenticated: true, provider: 'zhihu', profile: { displayName: '小知', avatarUrl: null, profileUrl: null } } })
    request.mockResolvedValue(authenticated)
    vi.mocked(getConnections).mockResolvedValue([connectedZhihu])

    const store = useAuthStore()
    const refreshed = await store.refreshAfterOAuth()

    expect(refreshed?.auth.authenticated).toBe(true)
    expect(getConnections).toHaveBeenCalledTimes(1)
    expect(store.connections).toEqual([connectedZhihu])
  })
})
