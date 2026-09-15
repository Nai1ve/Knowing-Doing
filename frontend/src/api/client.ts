export interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null
  getCsrfToken?: () => string | null
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly payload?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export function hasApiErrorCode(error: unknown, code: string): error is ApiError {
  if (!(error instanceof ApiError) || !error.payload || typeof error.payload !== 'object' || !('error' in error.payload)) return false
  const payloadError = (error.payload as { error?: { code?: unknown } }).error
  return payloadError?.code === code
}

/**
 * Error codes that mean the current device session is no longer sufficient to
 * reach the business page. The app reacts by returning to the auth entry.
 */
export const authRedirectCodes = new Set(['session_required', 'zhihu_auth_required', 'reauthorization_required'])

export type ApiAuthRedirectListener = (code: string) => void
const authRedirectListeners = new Set<ApiAuthRedirectListener>()

export function onApiAuthRedirect(listener: ApiAuthRedirectListener): () => void {
  authRedirectListeners.add(listener)
  return () => { authRedirectListeners.delete(listener) }
}

export function apiErrorCode(payload: unknown): string | null {
  if (!payload || typeof payload !== 'object' || !('error' in payload)) return null
  const error = (payload as { error?: unknown }).error
  if (!error || typeof error !== 'object' || !('code' in error)) return null
  const code = (error as { code?: unknown }).code
  return typeof code === 'string' && code ? code : null
}

export function isAuthRedirectCode(code: string | null | undefined): code is string {
  return typeof code === 'string' && authRedirectCodes.has(code)
}

/** Notifies registered listeners when a payload carries an auth-required code. */
export function emitApiAuthRedirect(payload: unknown): void {
  const code = apiErrorCode(payload)
  if (!isAuthRedirectCode(code)) return
  for (const listener of authRedirectListeners) {
    try { listener(code) } catch { /* a listener must never break request handling */ }
  }
}

function isJsonResponse(response: Response): boolean {
  return response.headers.get('content-type')?.toLowerCase().includes('application/json') ?? false
}

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    const isFormData = typeof FormData !== 'undefined' && init.body instanceof FormData
    if (init.body && !isFormData && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const token = options.getToken?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const csrfToken = options.getCsrfToken?.()
    if (csrfToken && init.method && !['GET', 'HEAD', 'OPTIONS'].includes(init.method.toUpperCase())) headers.set('X-CSRF-Token', csrfToken)
    const response = await fetch(`${options.baseUrl}${path}`, { ...init, credentials: init.credentials ?? 'include', headers })
    const text = await response.text()
    let payload: unknown
    if (text) {
      if (!isJsonResponse(response)) {
        throw new ApiError(response.status, '接口返回了非 JSON 响应，请检查 API 代理地址', text.slice(0, 200))
      }
      try { payload = JSON.parse(text) } catch { throw new ApiError(response.status, '接口返回了无效 JSON，请检查 API 服务状态', text.slice(0, 200)) }
    }
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'message' in payload && typeof (payload as { message?: unknown }).message === 'string'
        ? String((payload as { message: string }).message)
        : payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
          ? String((payload as { error: { message: string } }).error.message)
        : `请求失败：${response.status}`
      emitApiAuthRedirect(payload)
      throw new ApiError(response.status, message, payload)
    }
    return payload as T
  }

  return { request }
}

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  getToken: () => typeof localStorage === 'undefined' ? null : localStorage.getItem('zhixing_access_token'),
  getCsrfToken: () => typeof localStorage === 'undefined' ? null : localStorage.getItem('zhixing.csrf-token'),
})
