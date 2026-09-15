import type { Router } from 'vue-router'
import { safeRedirectPath } from '@/utils/auth-flow'

export interface AuthRedirectContext {
  clearSession: () => void
}

/**
 * Builds the apiClient auth-redirect listener. When any API call comes back
 * with session_required / zhihu_auth_required / reauthorization_required, the
 * app must leave business pages and land on the auth entry with the reason and
 * the original safe path preserved, so the user can return after logging in.
 */
export function createAuthRedirectHandler(router: Router, auth: AuthRedirectContext) {
  return (code: string): void => {
    auth.clearSession()
    const current = router.currentRoute.value
    if (current.name === 'auth') return
    void router.replace({ name: 'auth', query: { reason: code, redirect: safeRedirectPath(current.fullPath) } }).catch(() => undefined)
  }
}
