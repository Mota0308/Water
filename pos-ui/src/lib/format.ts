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
