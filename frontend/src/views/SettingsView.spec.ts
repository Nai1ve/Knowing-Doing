// @vitest-environment jsdom
import { createApp } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { getConnections, logoutOAuth } from '@/api/oauthService'
import { getSourceCollections, getSourceItems, getSourceSyncs } from '@/api/learningExperienceService'
import SettingsView from './SettingsView.vue'

vi.mock('@/api/oauthService', () => ({
  disconnectOAuth: vi.fn(),
  getConnections: vi.fn(),
  logoutOAuth: vi.fn(),
  startZhihuOAuth: vi.fn(),
}))

vi.mock('@/api/learningExperienceService', () => ({
  getSourceCollections: vi.fn(),
  getSourceItems: vi.fn(),
  getSourceSyncs: vi.fn(),
  saveSourceItem: vi.fn(),
  searchSourceItems: vi.fn(),
  startSourceSync: vi.fn(),
}))

const request = vi.spyOn(apiClient, 'request')

describe('SettingsView OAuth callback handling', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    vi.clearAllMocks()
    sessionStorage.clear()
    request.mockResolvedValue({
      learnerId: 'server-only-learner-id',
      expiresAt: '2026-09-15T00:00:00.000Z',
      auth: { required: true, authenticated: true, provider: 'zhihu', profile: { displayName: '知乎用户', avatarUrl: null, profileUrl: null } },
    })
    vi.mocked(getConnections).mockResolvedValue([])
    vi.mocked(getSourceCollections).mockResolvedValue([])
    vi.mocked(getSourceItems).mockResolvedValue({ items: [], nextCursor: null })
    vi.mocked(getSourceSyncs).mockResolvedValue([])
  })

  afterAll(() => {
    request.mockRestore()
  })

  async function mountAt(path: string) {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/settings', name: 'settings', component: SettingsView },
        { path: '/auth', name: 'auth', component: { template: '<div>auth</div>' } },
        { path: '/overview', name: 'overview', component: { template: '<div>overview</div>' } },
        { path: '/planning/:sessionId', name: 'planning', component: { template: '<div>planning</div>' } },
      ],
    })
    await router.push(path)
    const host = document.createElement('div')
    const app = createApp(SettingsView).use(pinia).use(router)
    app.mount(host)
    await new Promise((resolve) => setTimeout(resolve, 0))
    return { app, host, router }
  }

  it('refreshes the session after a successful callback and returns to overview', async () => {
    const { app, router } = await mountAt('/settings?connection=zhihu&result=success')

    expect(request).toHaveBeenCalledWith('/auth/session', { method: 'POST' })
    expect(router.currentRoute.value.name).toBe('overview')
    app.unmount()
  })

  it('returns to the sanitized internal route saved before OAuth', async () => {
    sessionStorage.setItem('zhixing.oauth.return-path', '/planning/session-1?resume=1')
    const { app, router } = await mountAt('/settings?connection=zhihu&result=success')

    expect(router.currentRoute.value.fullPath).toBe('/planning/session-1?resume=1')
    expect(sessionStorage.getItem('zhixing.oauth.return-path')).toBeNull()
    app.unmount()
  })

  it('maps callback failures to a safe message without echoing the raw reason', async () => {
    request.mockResolvedValueOnce({
      learnerId: 'server-only-learner-id',
      expiresAt: '2026-09-15T00:00:00.000Z',
      auth: { required: true, authenticated: false, provider: null, profile: null },
    })
    const { app, host } = await mountAt('/settings?connection=zhihu&result=failed&reason=unexpected-secret-value')

    expect(host.textContent).toContain('知乎授权失败：知乎授权没有完成，请重试。')
    expect(host.textContent).not.toContain('unexpected-secret-value')
    app.unmount()
  })

  it('revokes the device session and routes to the auth entry on logout', async () => {
    vi.mocked(logoutOAuth).mockResolvedValue(undefined)
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(true)
    const { app, host, router } = await mountAt('/settings')

    const logoutButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('退出登录'))
    expect(logoutButton).toBeTruthy()
    logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(logoutOAuth).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('auth')
    confirmSpy.mockRestore()
    app.unmount()
  })

  it('keeps the device session when the logout confirmation is declined', async () => {
    const confirmSpy = vi.spyOn(window, 'confirm').mockReturnValue(false)
    const { app, host, router } = await mountAt('/settings')

    const logoutButton = Array.from(host.querySelectorAll('button')).find((button) => button.textContent?.includes('退出登录'))
    logoutButton?.dispatchEvent(new MouseEvent('click', { bubbles: true }))
    await new Promise((resolve) => setTimeout(resolve, 0))

    expect(logoutOAuth).not.toHaveBeenCalled()
    expect(router.currentRoute.value.name).toBe('settings')
    confirmSpy.mockRestore()
    app.unmount()
  })
})
