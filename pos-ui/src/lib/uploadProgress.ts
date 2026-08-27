type ProgressOpts = {
  title?: string
  name?: string
  total?: number
  index?: number
  pct?: number
}

type FinishOpts = {
  ok?: boolean
  message?: string
  holdMs?: number
}

let active = false
let resolveWait: (() => void) | null = null

function esc(s: string): string {
  return String(s || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function ensureStyle() {
  if (document.getElementById('pos-upload-progress-style')) return
  const style = document.createElement('style')
  style.id = 'pos-upload-progress-style'
  style.textContent = `
.pos-upload-progress-bg{position:fixed;inset:0;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;z-index:9999;padding:16px}
.pos-upload-progress-bg.hidden{display:none!important}
.pos-upload-progress-card{background:#fff;border-radius:14px;padding:22px 20px;width:min(420px,100%);box-shadow:0 12px 40px rgba(0,0,0,.25);font-family:system-ui,-apple-system,sans-serif}
.pos-upload-progress-card h3{margin:0 0 10px;color:#37474f;font-size:17px}
.pos-upload-progress-card .up-name{font-size:13px;color:#546e7a;word-break:break-all;margin:0 0 12px;line-height:1.45}
.pos-upload-progress-bar{height:10px;background:#eceff1;border-radius:999px;overflow:hidden}
.pos-upload-progress-bar>i{display:block;height:100%;width:0%;background:linear-gradient(90deg,#0288d1,#26a69a);border-radius:999px;transition:width .12s ease}
.pos-upload-progress-meta{margin-top:10px;font-size:12px;color:#78909c}
.pos-upload-progress-result{margin-top:8px;font-size:14px;line-height:1.55}
.pos-upload-progress-result.ok{color:#2e7d32}
.pos-upload-progress-result.err{color:#c62828}
.pos-upload-progress-card .actions{display:flex;gap:10px;justify-content:flex-end;margin-top:16px}
.pos-upload-progress-card .actions button{border:0;border-radius:8px;padding:8px 14px;background:#0288d1;color:#fff;cursor:pointer;font-size:13px}
`
  document.head.appendChild(style)
}

function ensureDom() {
  ensureStyle()
  let bg = document.getElementById('pos-upload-progress-bg')
  if (bg) return bg
  bg = document.createElement('div')
  bg.id = 'pos-upload-progress-bg'
  bg.className = 'pos-upload-progress-bg hidden'
  bg.setAttribute('aria-live', 'polite')
  bg.innerHTML = '<div class="pos-upload-progress-card" id="pos-upload-progress-card"></div>'
  document.body.appendChild(bg)
  return bg
}

export function openUploadProgress(opts: ProgressOpts = {}) {
  active = true
  resolveWait = null
  const bg = ensureDom()
  const card = document.getElementById('pos-upload-progress-card')
  const title = opts.title || '上傳附件'
  const name = opts.name || ''
  const total = Math.max(1, Number(opts.total) || 1)
  const index = Math.max(1, Number(opts.index) || 1)
  if (card) {
    card.innerHTML =
      `<h3>📤 ${esc(title)}</h3>` +
      `<p class="up-name" id="pos-upload-progress-name">${esc(name || '準備上傳…')}</p>` +
      `<div class="pos-upload-progress-bar"><i id="pos-upload-progress-fill" style="width:0%"></i></div>` +
      `<div class="pos-upload-progress-meta" id="pos-upload-progress-meta">${total > 1 ? `檔案 ${index}／${total} · ` : ''}0%</div>` +
      `<div class="pos-upload-progress-result" id="pos-upload-progress-result"></div>` +
      `<div class="actions" id="pos-upload-progress-actions" style="display:none"></div>`
  }
  bg.classList.remove('hidden')
}

export function updateUploadProgress(opts: ProgressOpts = {}) {
  if (!active) return
  const nameEl = document.getElementById('pos-upload-progress-name')
  const fill = document.getElementById('pos-upload-progress-fill')
  const meta = document.getElementById('pos-upload-progress-meta')
  const pct = Math.max(0, Math.min(100, Math.round(Number(opts.pct) || 0)))
  const total = Math.max(1, Number(opts.total) || 1)
  const index = Math.max(1, Number(opts.index) || 1)
  if (nameEl && opts.name != null) nameEl.textContent = String(opts.name || '')
  if (fill) fill.style.width = `${pct}%`
  if (meta) meta.textContent = `${total > 1 ? `檔案 ${index}／${total} · ` : ''}${pct}%`
}

export function finishUploadProgress(opts: FinishOpts = {}): Promise<void> {
  if (!active) return Promise.resolve()
  const result = document.getElementById('pos-upload-progress-result')
  const actions = document.getElementById('pos-upload-progress-actions')
  const fill = document.getElementById('pos-upload-progress-fill')
  const ok = opts.ok !== false
  if (fill) fill.style.width = ok ? '100%' : fill.style.width || '0%'
  if (result) {
    result.className = `pos-upload-progress-result ${ok ? 'ok' : 'err'}`
    result.textContent = opts.message || (ok ? '上傳成功' : '上傳失敗')
  }
  const hide = () => {
    const bg = document.getElementById('pos-upload-progress-bg')
    if (bg) bg.classList.add('hidden')
    active = false
    const waiter = resolveWait
    resolveWait = null
    if (waiter) waiter()
  }
  if (ok) {
    if (actions) {
      actions.style.display = 'none'
      actions.innerHTML = ''
    }
    return new Promise((resolve) => {
      setTimeout(() => {
        hide()
        resolve()
      }, opts.holdMs != null ? opts.holdMs : 900)
    })
  }
  return new Promise((resolve) => {
    resolveWait = resolve
    if (actions) {
      actions.style.display = 'flex'
      actions.innerHTML = '<button type="button" id="pos-upload-progress-ok">確定</button>'
      const btn = document.getElementById('pos-upload-progress-ok')
      if (btn) btn.onclick = () => hide()
    } else {
      hide()
    }
  })
}

export function isUploadProgressActive() {
  return active
}
