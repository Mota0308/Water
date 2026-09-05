const CLOTHING_SIZE_ORDER = ['XXS', 'XS', 'S', 'M', 'L', 'XL', 'XXL', 'XXXL', '2XL', '3XL', '4XL']

function sizeSortKey(size: string | number | null | undefined): { n: number; rank: number; t: string } {
  const t = String(size ?? '').trim()
  if (!t) return { n: Number.POSITIVE_INFINITY, rank: 999, t: '' }
  const upper = t.toUpperCase()
  const clothing = CLOTHING_SIZE_ORDER.indexOf(upper)
  if (clothing >= 0) return { n: Number.POSITIVE_INFINITY, rank: clothing, t }
  if (/^\d+(\.\d+)?$/.test(t)) return { n: Number(t), rank: -1, t }
  const m = t.match(/^(\d+(\.\d+)?)/)
  if (m) return { n: Number(m[1]), rank: -1, t }
  return { n: Number.POSITIVE_INFINITY, rank: 500, t }
}

/** 尺碼由小到大：0、1、2、4、10…；S／M／L 依服裝順序 */
export function compareProductSizes(a: string | number | null | undefined, b: string | number | null | undefined): number {
  const ka = sizeSortKey(a)
  const kb = sizeSortKey(b)
  if (ka.n !== kb.n) return ka.n - kb.n
  if (ka.rank !== kb.rank) return ka.rank - kb.rank
  return ka.t.localeCompare(kb.t, 'zh-Hant', { numeric: true })
}

export function formatHKD(amount: number): string {
  return new Intl.NumberFormat('zh-HK', {
    style: 'currency',
    currency: 'HKD',
  }).format(amount)
}

function parseInputDate(value: string | number | Date | null | undefined): Date | null {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const raw = String(value).trim()
  if (!raw) return null
  const normalized = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)
    ? raw.replace(' ', 'T')
    : raw
  const date = new Date(normalized)
  return Number.isNaN(date.getTime()) ? null : date
}

export function formatDate(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const raw = String(value)
  if (raw.includes('年') && raw.includes('月') && raw.includes('日')) return raw
  const date = parseInputDate(value)
  if (!date) return raw
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date)
}

export function formatDateTime(value: string | number | Date | null | undefined): string {
  if (value == null || value === '') return '—'
  const raw = String(value)
  if (raw.includes('年') && raw.includes('月') && raw.includes('日')) return raw
  const date = parseInputDate(value)
  if (!date) return raw
  return new Intl.DateTimeFormat('zh-HK', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(date)
}
