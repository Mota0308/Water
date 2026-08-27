import {
  finishUploadProgress,
  isUploadProgressActive,
  openUploadProgress,
  updateUploadProgress,
} from '@/lib/uploadProgress'

export const AUTH_TOKEN_KEY = 'store-web-auth-token-v1'

export function fileUrl(fileId: string): string {
  const id = String(fileId || '').trim()
  if (!id) return ''
  const path = `/api/files/${encodeURIComponent(id)}`
  try {
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (token) return `${path}?access_token=${encodeURIComponent(token)}`
  } catch {
    /* ignore */
  }
  return path
}

type UploadOpts = {
  title?: string
  silentUi?: boolean
  total?: number
  index?: number
  onProgress?: (pct: number) => void
}

function uploadViaXhr(
  file: File,
  onProgress?: (pct: number) => void,
): Promise<{ id: string; name: string; mimeType: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest()
    xhr.open('POST', '/api/files')
    const token = localStorage.getItem(AUTH_TOKEN_KEY)
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`)
    xhr.withCredentials = true
    xhr.upload.onprogress = (e) => {
      if (!e.lengthComputable || !onProgress) return
      onProgress(Math.round((e.loaded / e.total) * 100))
    }
    xhr.onload = () => {
      if (xhr.status === 401) {
        try {
          localStorage.removeItem(AUTH_TOKEN_KEY)
        } catch {
          /* ignore */
        }
        reject(new Error('未登入或登入已過期，請重新登入員工網站'))
        return
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        let msg = xhr.statusText || `HTTP ${xhr.status}`
        try {
          const j = JSON.parse(xhr.responseText || '{}') as { error?: string }
          if (j?.error) msg = j.error
        } catch {
          /* ignore */
        }
        reject(new Error(msg))
        return
      }
      try {
        const j = JSON.parse(xhr.responseText || '{}') as {
          id?: string
          name?: string
          mimeType?: string
        }
        if (!j?.id) {
          reject(new Error('上傳失敗：伺服器未回傳檔案 ID'))
          return
        }
        resolve({
          id: String(j.id),
          name: String(j.name || file.name || '附件'),
          mimeType: String(j.mimeType || file.type || ''),
        })
      } catch {
        reject(new Error('上傳回應無效'))
      }
    }
    xhr.onerror = () => reject(new Error('網絡錯誤，上傳失敗'))
    xhr.onabort = () => reject(new Error('上傳已取消'))
    const fd = new FormData()
    fd.append('file', file)
    xhr.send(fd)
  })
}

export async function uploadFile(
  file: File,
  opts: UploadOpts = {},
): Promise<{ id: string; name: string; mimeType: string }> {
  const silentUi = !!opts.silentUi
  const ownUi = !silentUi
  if (ownUi) {
    openUploadProgress({
      title: opts.title || '上傳附件',
      name: file.name || '檔案',
      total: 1,
      index: 1,
    })
  }
  try {
    const saved = await uploadViaXhr(file, (pct) => {
      opts.onProgress?.(pct)
      if (ownUi || isUploadProgressActive()) {
        updateUploadProgress({
          name: file.name || '檔案',
          pct,
          total: opts.total || 1,
          index: opts.index || 1,
        })
      }
    })
    if (ownUi) await finishUploadProgress({ ok: true, message: `上傳成功：${saved.name}` })
    return saved
  } catch (e) {
    if (ownUi) {
      await finishUploadProgress({
        ok: false,
        message: `上傳失敗：${e instanceof Error ? e.message : String(e)}`,
      })
    }
    throw e
  }
}

export async function uploadFiles(
  files: File[],
  opts: { title?: string } = {},
): Promise<Array<{ id: string; name: string; mimeType: string }>> {
  const list = Array.from(files || []).filter(Boolean)
  if (!list.length) return []
  openUploadProgress({
    title: opts.title || '上傳附件',
    name: list[0].name || '檔案',
    total: list.length,
    index: 1,
  })
  const out: Array<{ id: string; name: string; mimeType: string }> = []
  try {
    for (let i = 0; i < list.length; i++) {
      const f = list[i]
      updateUploadProgress({ name: f.name || `檔案 ${i + 1}`, pct: 0, total: list.length, index: i + 1 })
      const saved = await uploadFile(f, {
        silentUi: true,
        total: list.length,
        index: i + 1,
        onProgress: (pct) => {
          updateUploadProgress({
            name: f.name || `檔案 ${i + 1}`,
            pct,
            total: list.length,
            index: i + 1,
          })
        },
      })
      out.push(saved)
      updateUploadProgress({ name: f.name || `檔案 ${i + 1}`, pct: 100, total: list.length, index: i + 1 })
    }
    await finishUploadProgress({ ok: true, message: `已成功上傳 ${out.length} 個檔案` })
    return out
  } catch (e) {
    await finishUploadProgress({
      ok: false,
      message: `上傳失敗（已完成 ${out.length}／${list.length}）：${e instanceof Error ? e.message : String(e)}`,
    })
    throw e
  }
}

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
