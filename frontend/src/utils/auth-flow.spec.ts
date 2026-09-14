// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { clearOAuthReturnPath, oauthFailureMessage, readOAuthReturnPath, safeAvatarUrl, safeRedirectPath, saveOAuthReturnPath } from './auth-flow'

describe('auth flow safety helpers', () => {
  it.each([
    ['oauth_state_invalid', '授权状态已失效，请重新开始。'],
    ['oauth_token_exchange_failed', '知乎授权码暂时无法兑换，请稍后重试。'],
    ['oauth_provider_identity_unavailable', '知乎没有返回可用于登录的账号信息。'],
    ['oauth_callback_missing', '知乎授权回调信息不完整，请重新开始。'],
    ['session_required', '请先建立知乎登录会话，再继续。'],
  ])('maps backend reason %s to a safe message', (reason, message) => {
    expect(oauthFailureMessage(reason)).toBe(message)
  })

  it('does not echo unknown OAuth reasons', () => {
    const secretReason = 'token-secret-should-not-appear'
    const message = oauthFailureMessage(secretReason)
    expect(message).toBe('知乎授权没有完成，请重试。')
    expect(message).not.toContain(secretReason)
  })

  it('only accepts network avatar URLs', () => {
    expect(safeAvatarUrl('https://img.zhihu.com/avatar.png')).toBe('https://img.zhihu.com/avatar.png')
    expect(safeAvatarUrl('HTTP://img.zhihu.com/avatar.png')).toBe('HTTP://img.zhihu.com/avatar.png')
    expect(safeAvatarUrl('data:image/svg+xml,<svg></svg>')).toBeNull()
    expect(safeAvatarUrl('javascript:alert(1)')).toBeNull()
    expect(safeAvatarUrl(null)).toBeNull()
  })

  it('only preserves safe internal OAuth return paths', () => {
    expect(safeRedirectPath('/planning/session-1?step=resume')).toBe('/planning/session-1?step=resume')
    expect(safeRedirectPath('//evil.example')).toBe('/overview')
    expect(safeRedirectPath('https://evil.example')).toBe('/overview')
    expect(safeRedirectPath('/https://evil.example')).toBe('/overview')
    expect(safeRedirectPath('/planning\\session-1')).toBe('/overview')
  })

  it('stores and consumes only the sanitized OAuth return path', () => {
    saveOAuthReturnPath('/roadmap/node-1')
    expect(readOAuthReturnPath()).toBe('/roadmap/node-1')
    clearOAuthReturnPath()
    expect(readOAuthReturnPath()).toBe('/overview')
  })
})
