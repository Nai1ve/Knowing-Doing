const oauthReasonLabels: Record<string, string> = {
  access_denied: '你取消了知乎授权。',
  authorization_failed: '知乎授权没有完成。',
  callback_mismatch: '授权回调地址未通过校验。',
  invalid_state: '授权状态已失效，请重新开始。',
  oauth_state_invalid: '授权状态已失效，请重新开始。',
  token_exchange_failed: '知乎授权码暂时无法兑换，请稍后重试。',
  oauth_token_exchange_failed: '知乎授权码暂时无法兑换，请稍后重试。',
  zhihu_identity_unavailable: '知乎没有返回可用于登录的账号信息。',
  oauth_provider_identity_unavailable: '知乎没有返回可用于登录的账号信息。',
  oauth_callback_missing: '知乎授权回调信息不完整，请重新开始。',
  session_required: '请先建立知乎登录会话，再继续。',
}

export function safeRedirectPath(value: unknown, fallback = '/overview'): string {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return fallback
  return value
}

export function safeAvatarUrl(value: unknown): string | null {
  return typeof value === 'string' && /^https?:\/\//i.test(value) ? value : null
}

export function oauthFailureMessage(reason: unknown): string {
  if (typeof reason !== 'string' || !reason) return '知乎授权没有完成，请重试。'
  return oauthReasonLabels[reason] ?? '知乎授权没有完成，请重试。'
}
