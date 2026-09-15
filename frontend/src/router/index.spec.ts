// @vitest-environment jsdom
import { createPinia, setActivePinia } from 'pinia'
import { createMemoryHistory, type Router } from 'vue-router'
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { apiClient } from '@/api/client'
import { createAppRouter } from './index'

function authSession(authenticated: boolean, required = true) {
  return {
    learnerId: 'server-only-learner-id',
    expiresAt: '2026-09-15T00:00:00.000Z',
    auth: { required, authenticated, provider: authenticated ? 'zhihu' as const : null, profile: null },
  }
}

const request = vi.spyOn(apiClient, 'request')

describe('application auth route guard', () => {
  let router: Router

  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    router = createAppRouter(createMemoryHistory())
  })

  afterAll(() => {
    vi.restoreAllMocks()
  })

  it('redirects unauthenticated users away from business routes and preserves the destination', async () => {
    request.mockResolvedValue(authSession(false))

    await router.push('/overview')

    expect(router.currentRoute.value.name).toBe('auth')
    expect(router.currentRoute.value.query.redirect).toBe('/overview')
  })

  it('allows authenticated users to enter business routes', async () => {
    request.mockResolvedValue(authSession(true))

    await router.push('/overview')

    expect(router.currentRoute.value.name).toBe('overview')
  })

  it('keeps the auth entry and settings callback route public while unauthenticated', async () => {
    request.mockResolvedValue(authSession(false))

    await router.push('/auth?redirect=/gym-build')
    expect(router.currentRoute.value.name).toBe('auth')
    expect(router.currentRoute.value.query.redirect).toBe('/gym-build')

    await router.push('/settings?connection=zhihu&result=failed&reason=access_denied')
    expect(router.currentRoute.value.name).toBe('settings')
  })

  it('keeps local and gray rollout behavior when authentication is not required', async () => {
    request.mockResolvedValue(authSession(false, false))

    await router.push('/overview')

    expect(router.currentRoute.value.name).toBe('overview')
  })

  it('uses the auth entry when bootstrap fails instead of treating fixtures as a login', async () => {
    request.mockRejectedValue(new Error('network unavailable'))

    await router.push('/planning/session-1')

    expect(router.currentRoute.value.name).toBe('auth')
    expect(router.currentRoute.value.query.redirect).toBe('/planning/session-1')
  })

  it('keeps the auth entry for an active reauthorization reason even when login is optional', async () => {
    request.mockResolvedValue(authSession(false, false))

    await router.push('/auth?reason=reauthorization_required&redirect=/overview')

    expect(router.currentRoute.value.name).toBe('auth')
    expect(router.currentRoute.value.query.reason).toBe('reauthorization_required')
  })

  it('bounces optional-login users off the auth entry when there is no active reason', async () => {
    request.mockResolvedValue(authSession(false, false))

    await router.push('/auth')

    expect(router.currentRoute.value.name).toBe('overview')
  })
})
