// @vitest-environment jsdom
import { createApp, nextTick } from 'vue'
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, createRouter } from 'vue-router'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import AuthView from './AuthView.vue'
import { useAuthStore } from '@/stores/auth'

const request = vi.spyOn(apiClient, 'request')

describe('AuthView', () => {
  let pinia: ReturnType<typeof createPinia>

  beforeEach(() => {
    pinia = createPinia()
    setActivePinia(pinia)
    request.mockResolvedValue({
      learnerId: 'server-only-learner-id',
      expiresAt: '2026-09-15T00:00:00.000Z',
      auth: { required: true, authenticated: false, provider: null, profile: null },
    })
  })

  afterAll(() => {
    request.mockRestore()
  })

  it('offers a clear Zhihu entry without exposing the learner id', async () => {
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/auth', name: 'auth', component: AuthView },
        { path: '/overview', name: 'overview', component: { template: '<div>overview</div>' } },
      ],
    })
    await router.push('/auth?redirect=/overview')
    const auth = useAuthStore()
    const authorize = vi.spyOn(auth, 'authorize').mockResolvedValue(true)
    const host = document.createElement('div')
    const app = createApp(AuthView).use(pinia).use(router)
    app.mount(host)

    await nextTick()
    await Promise.resolve()
    expect(host.textContent).toContain('使用知乎继续')
    expect(host.textContent).not.toContain('server-only-learner-id')

    const button = host.querySelector('button.auth-primary') as HTMLButtonElement
    button.click()
    await nextTick()
    expect(authorize).toHaveBeenCalledWith('zhihu')

    app.unmount()
  })
})
