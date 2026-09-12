export const MEMBER_LEVELS = [
  { id: '新會員', label: '新會員', note: '原價，無會員折扣；生日當日及其前後 3 日 75 折' },
  { id: '普通會員', label: '普通會員', note: '購買 95 折；生日當日及其前後 3 日 75 折' },
  { id: '尊貴會員', label: '尊貴會員', note: '購買 85 折；生日當日及其前後 3 日 75 折' },
  { id: '教練會員', label: '教練會員', note: '購買 85 折；生日當日及其前後 3 日 75 折' },
  { id: '長者會員', label: '長者會員', note: '平日 75 折，星期六日及紅日 85 折；生日當日及其前後 3 日 75 折' },
] as const

export type MemberLevelId = (typeof MEMBER_LEVELS)[number]['id']

export function normalizeMemberLevel(raw?: string | null): MemberLevelId {
  const s = String(raw || '').trim()
  if (MEMBER_LEVELS.some((x) => x.id === s)) return s as MemberLevelId
  const key = s.toLowerCase()
  if (key === 'new') return '新會員'
  if (key === 'normal' || s === '一般會員') return '普通會員'
  if (key === 'vip' || s.includes('VIP') || s.includes('vip') || s === '尊貴會員') return '尊貴會員'
  if (key === 'coach' || s.includes('教練')) return '教練會員'
  if (key === 'senior' || s.includes('長者')) return '長者會員'
  return '新會員'
}

export function memberLevelNote(level?: string | null) {
  const id = normalizeMemberLevel(level)
  return MEMBER_LEVELS.find((x) => x.id === id)?.note || ''
}

export function memberLevelTone(level?: string | null): 'sky' | 'emerald' | 'amber' | 'slate' | 'red' {
  const id = normalizeMemberLevel(level)
  if (id === '尊貴會員') return 'amber'
  if (id === '教練會員') return 'emerald'
  if (id === '長者會員') return 'red'
  if (id === '普通會員') return 'slate'
  return 'sky'
}
