import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, hasApiErrorCode, isAuthRedirectCode, onApiAuthRedirect } from './client'

describe('hasApiErrorCode', () => {
  it('recognizes the non-blocking scanned-resume error', () => {
    const error = new ApiError(422, 'PDF 中没有可提取的文本', { error: { code: 'resume_text_unavailable' } })

    expect(hasApiErrorCode(error, 'resume_text_unavailable')).toBe(true)
    expect(hasApiErrorCode(error, 'resume_parse_failed')).toBe(false)
  })
})

describe('createApiClient request defaults', () => {
  it('includes browser credentials and CSRF for mutations', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 200, headers: { get: () => 'application/json' }, text: async () => '{}' })
    vi.stubGlobal('fetch', fetchMock)
    const client = createApiClient({ baseUrl: '/api', getCsrfToken: () => 'csrf-test' })

    await client.request('/product/example', { method: 'POST', body: '{}' })

    expect(fetchMock).toHaveBeenCalledWith('/api/product/example', expect.objectContaining({ credentials: 'include' }))
    expect(fetchMock.mock.calls[0][1].headers.get('X-CSRF-Token')).toBe('csrf-test')
  })
})

describe('createApiClient auth redirect emission', () => {
  function errorResponse(status: number, code: string) {
    return {
      ok: false,
      status,
      headers: { get: () => 'application/json' },
      text: async () => JSON.stringify({ error: { code, message: 'x' } }),
    }
  }

  it('emits an auth-redirect code before throwing for session_required', async () => {
    const listener = vi.fn()
    const unsubscribe = onApiAuthRedirect(listener)
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(401, 'session_required')))
      const client = createApiClient({ baseUrl: '/api' })

      await expect(client.request('/product/overview')).rejects.toMatchObject({ status: 401 })
      expect(listener).toHaveBeenCalledWith('session_required')
    } finally {
      unsubscribe()
      vi.unstubAllGlobals()
    }
  })

  it('does not emit for non-auth failures', async () => {
    const listener = vi.fn()
    const unsubscribe = onApiAuthRedirect(listener)
    try {
      vi.stubGlobal('fetch', vi.fn().mockResolvedValue(errorResponse(502, 'zhihu_upstream_unavailable')))
      const client = createApiClient({ baseUrl: '/api' })

      await expect(client.request('/product/overview')).rejects.toBeTruthy()
      expect(listener).not.toHaveBeenCalled()
    } finally {
      unsubscribe()
      vi.unstubAllGlobals()
    }
  })

  it('classifies only the frozen auth-required codes', () => {
    expect(isAuthRedirectCode('session_required')).toBe(true)
    expect(isAuthRedirectCode('zhihu_auth_required')).toBe(true)
    expect(isAuthRedirectCode('reauthorization_required')).toBe(true)
    expect(isAuthRedirectCode('zhihu_upstream_unavailable')).toBe(false)
    expect(isAuthRedirectCode(null)).toBe(false)
  })
})
