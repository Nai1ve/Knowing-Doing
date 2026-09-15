// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import AuthView from './AuthView.vue'
import { useAuthStore } from '@/stores/auth'

vi.mock('@/api/oauthService', () => ({
  disconnectOAuth: vi.fn(),
  getConnections: vi.fn(),
  logoutOAuth: vi.fn(),
  startZhihuOAuth: vi.fn(),
}))

const request = vi.spyOn(apiClient, 'request')

function session(overrides: { authenticated?: boolean; profile?: { displayName: string; avatarUrl: string | null; profileUrl: string | null } | null } = {}) {
  const authenticated = overrides.authenticated ?? false
  return {
    learnerId: 'server-only-learner-id',
    expiresAt: '2026-09-15T00:00:00.000Z',
    auth: { required: true, authenticated, provider: authenticated ? 'zhihu' as const : null, profile: overrides.profile ?? null },
  }
}

async function mountAt(path: string) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/auth', name: 'auth', component: AuthView },
      { path: '/overview', name: 'overview', component: { template: '<div>overview</div>' } },
    ],
  })
  await router.push(path)
  const auth = useAuthStore()
  const host = document.createElement('div')
  const app = createApp(AuthView).use(pinia).use(router)
  app.mount(host)
  await nextTick()
  await Promise.resolve()
  return { app, host, router, auth }
}

describe('AuthView', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    request.mockResolvedValue(session())
  })

  afterAll(() => {
    request.mockRestore()
  })

  it('offers a clear Zhihu entry without exposing the learner id', async () => {
    const { app, host, auth } = await mountAt('/auth?redirect=/overview')
    const authorize = vi.spyOn(auth, 'authorize').mockResolvedValue(true)

    expect(host.textContent).toContain('使用知乎继续')
    expect(host.textContent).not.toContain('server-only-learner-id')

    const button = host.querySelector('button.auth-primary') as HTMLButtonElement
    button.click()
    await nextTick()
    expect(authorize).toHaveBeenCalledWith('zhihu', '/overview')

    app.unmount()
  })

  it('distinguishes a reauthorization-required state from a first-time login', async () => {
    const { app, host } = await mountAt('/auth?redirect=/overview&reason=reauthorization_required')

    expect(host.textContent).toContain('知乎连接需要重新授权')
    expect(host.textContent).toContain('重新授权知乎')
    expect(host.textContent).toContain('已保存的学习内容不会丢失')
    app.unmount()
  })

  it('maps an authorization failure to a safe message without echoing the reason', async () => {
    const { app, host } = await mountAt('/auth?redirect=/overview&result=failed&reason=unexpected-secret-value')

    expect(host.textContent).toContain('知乎授权没有完成')
    expect(host.textContent).toContain('知乎授权没有完成，请重试。')
    expect(host.textContent).not.toContain('unexpected-secret-value')
    app.unmount()
  })

  it('shows the authenticated state with profile and returns to the saved path', async () => {
    request.mockResolvedValue(session({ authenticated: true, profile: { displayName: '小知', avatarUrl: null, profileUrl: null } }))
    const { app, host, router } = await mountAt('/auth?redirect=/overview')

    expect(host.textContent).toContain('你已经登录')
    expect(host.textContent).toContain('小知')

    const button = host.querySelector('button.auth-primary') as HTMLButtonElement
    button.click()
    await new Promise((resolve) => setTimeout(resolve, 0))
    expect(router.currentRoute.value.name).toBe('overview')

    app.unmount()
  })
})
