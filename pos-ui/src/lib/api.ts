export const AUTH_TOKEN_KEY = 'store-web-auth-token-v1'

export async function apiFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const token = localStorage.getItem(AUTH_TOKEN_KEY)
  const headers = new Headers(init.headers)

  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`)
  }

  if (!headers.has('Content-Type') && init.body && !(init.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json')
  }

  return fetch(input, {
    ...init,
    headers,
    credentials: 'include',
  })
}

export async function apiJson<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const r = await apiFetch(path, init)
  if (r.status === 401) {
    try {
      localStorage.removeItem(AUTH_TOKEN_KEY)
    } catch {
      /* ignore */
    }
    throw new Error('未登入或登入已過期，請重新登入員工網站')
  }
  if (!r.ok) {
    let msg = r.statusText || `HTTP ${r.status}`
    try {
      const j = (await r.json()) as { error?: string }
      if (j?.error) msg = j.error
    } catch {
      try {
        msg = await r.text()
      } catch {
        /* ignore */
      }
    }
    throw new Error(msg)
  }
  const ct = r.headers.get('content-type') || ''
  if (!ct.includes('application/json')) return undefined as T
  const text = await r.text()
  if (!text.trim()) return {} as T
  return JSON.parse(text) as T
}
