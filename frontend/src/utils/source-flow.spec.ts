import { describe, expect, it } from 'vitest'
import { safeExternalUrl } from './source-flow'

describe('source flow safety helpers', () => {
  it('allows only HTTP and HTTPS source links', () => {
    expect(safeExternalUrl('https://www.zhihu.com/question/1')).toBe('https://www.zhihu.com/question/1')
    expect(safeExternalUrl('HTTP://example.com/article')).toBe('HTTP://example.com/article')
    expect(safeExternalUrl('javascript:window.alert(1)')).toBeNull()
    expect(safeExternalUrl('data:text/html,<h1>unsafe</h1>')).toBeNull()
    expect(safeExternalUrl('//example.com/article')).toBeNull()
    expect(safeExternalUrl('ftp://example.com/article')).toBeNull()
    expect(safeExternalUrl(null)).toBeNull()
  })
})
