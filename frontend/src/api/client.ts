export interface ApiClientOptions {
  baseUrl: string
  getToken?: () => string | null
}

export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly payload?: unknown) {
    super(message)
    this.name = 'ApiError'
  }
}

export function createApiClient(options: ApiClientOptions) {
  async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const headers = new Headers(init.headers)
    headers.set('Accept', 'application/json')
    if (init.body && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json')
    const token = options.getToken?.()
    if (token) headers.set('Authorization', `Bearer ${token}`)
    const response = await fetch(`${options.baseUrl}${path}`, { ...init, headers })
    const text = await response.text()
    let payload: unknown
    if (text) {
      try { payload = JSON.parse(text) } catch { payload = text }
    }
    if (!response.ok) {
      const message = payload && typeof payload === 'object' && 'error' in payload && typeof (payload as { error?: { message?: unknown } }).error?.message === 'string'
        ? String((payload as { error: { message: string } }).error.message)
        : `请求失败：${response.status}`
      throw new ApiError(response.status, message, payload)
    }
    return payload as T
  }

  return { request }
}

export const apiClient = createApiClient({
  baseUrl: import.meta.env.VITE_API_BASE_URL ?? '/api',
  getToken: () => localStorage.getItem('zhixing_access_token'),
})
