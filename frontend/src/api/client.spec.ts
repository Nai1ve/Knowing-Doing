import { describe, expect, it, vi } from 'vitest'
import { ApiError, createApiClient, hasApiErrorCode } from './client'

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
