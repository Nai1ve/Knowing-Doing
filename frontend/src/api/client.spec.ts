import { describe, expect, it } from 'vitest'
import { ApiError, hasApiErrorCode } from './client'

describe('hasApiErrorCode', () => {
  it('recognizes the non-blocking scanned-resume error', () => {
    const error = new ApiError(422, 'PDF 中没有可提取的文本', { error: { code: 'resume_text_unavailable' } })

    expect(hasApiErrorCode(error, 'resume_text_unavailable')).toBe(true)
    expect(hasApiErrorCode(error, 'resume_parse_failed')).toBe(false)
  })
})
