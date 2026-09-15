// @vitest-environment jsdom
import { createMemoryHistory, createRouter } from 'vue-router'
import { describe, expect, it, vi } from 'vitest'
import { createAuthRedirectHandler } from './auth-events'

function setup() {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/auth', name: 'auth', component: { template: '<div>auth</div>' } },
      { path: '/overview', name: 'overview', component: { template: '<div>overview</div>' } },
      { path: '/planning/:sessionId', name: 'planning', component: { template: '<div>planning</div>' } },
    ],
  })
  const clearSession = vi.fn()
  return { router, clearSession }
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0))

describe('createAuthRedirectHandler', () => {
  it('clears the session and routes to the auth entry with the reason and safe redirect', async () => {
    const { router, clearSession } = setup()
    await router.push('/planning/session-1?step=resume')
    const handler = createAuthRedirectHandler(router, { clearSession })

    handler('reauthorization_required')
    await flush()

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('auth')
    expect(router.currentRoute.value.query.reason).toBe('reauthorization_required')
    expect(router.currentRoute.value.query.redirect).toBe('/planning/session-1?step=resume')
  })

  it('does not navigate again when already on the auth entry', async () => {
    const { router, clearSession } = setup()
    await router.push('/auth')
    const handler = createAuthRedirectHandler(router, { clearSession })

    handler('session_required')
    await flush()

    expect(clearSession).toHaveBeenCalledTimes(1)
    expect(router.currentRoute.value.name).toBe('auth')
    expect(router.currentRoute.value.query.reason).toBeUndefined()
  })
})
