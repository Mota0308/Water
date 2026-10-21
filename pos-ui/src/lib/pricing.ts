import type { MemberPricing, PosProduct } from '@/lib/types'

function firstMoney(...vals: Array<number | null | undefined>): number | null {
  for (const raw of vals) {
    const n = Number(raw)
    if (raw != null && Number.isFinite(n) && n >= 0) return Math.round(n * 100) / 100
  }
  return null
}

export function transferListPrice(product?: Partial<PosProduct> | null): number {
  return (
    firstMoney(
      product?.priceSpecial,
      product?.priceRetail,
      product?.priceSale,
      product?.priceOriginal,
      product?.price,
    ) || 0
  )
}

export type ParsedDiscount =
  | { ok: true; rate: number; fold: string }
  | { ok: false; error: string }

/** 8＝8折，85＝85折，9.5＝9.5折，10 或 100 或留空＝原價。最低 1 折。 */
export function parseDiscountInput(raw: string): ParsedDiscount {
  const text = String(raw ?? '')
    .trim()
    .replace(/\s+/g, '')
    .replace(/折$/, '')
  if (!text || text === '原價') return { ok: true, rate: 1, fold: '原價' }
  const n = Number(text)
  if (!Number.isFinite(n) || n <= 0) return { ok: false, error: '請輸入折扣，例如 85、8 或 9.5' }
  const rate = Math.round((n <= 10 ? n / 10 : n / 100) * 1000) / 1000
  if (rate < 0.1 || rate > 1) return { ok: false, error: '折扣須為 1 折至原價' }
  return { ok: true, rate, fold: discountFoldFromRate(rate) }
}

export function discountInputFromRate(rate: number | null | undefined): string {
  const n = Number(rate)
  if (!Number.isFinite(n) || n >= 0.999) return ''
  const pct = Math.round(n * 1000) / 10
  if (Number.isInteger(pct) && pct % 10 === 0) return String(pct / 10)
  return String(pct).replace(/\.0$/, '')
}

export function discountFoldFromRate(rate: number): string {
  if (rate >= 0.999) return '原價'
  const pct = Math.round(rate * 1000) / 10
  if (Number.isInteger(pct) && pct % 10 === 0) return `${pct / 10}折`
  return `${String(pct).replace(/\.0$/, '')}折`
}

/** 折扣率要乘在收銀顯示的售價上。原價較高時，不可拿原價的 75 折蓋過較低的優惠價。 */
function memberRateBase(product: Partial<PosProduct> | null | undefined, list: number) {
  const shelf = firstMoney(product?.price)
  const candidates = [list, shelf].filter((n): n is number => n != null && n > 0)
  if (!candidates.length) return 0
  return Math.min(...candidates)
}

function defaultNet(list: number, rate: number) {
  return Math.round(list * rate * 100) / 100
}

export function transferPriceNets(product?: Partial<PosProduct> | null) {
  if (product?.priceNets) {
    return {
      ...product.priceNets,
      coach: product.priceNets.coach ?? product.priceNets.vip,
    }
  }
  const list = transferListPrice(product)
  const walkIn = firstMoney(product?.priceNetNew, product?.priceNet, list) ?? 0
  return {
    new: walkIn,
    normal: firstMoney(product?.priceNetNormal) ?? defaultNet(list || walkIn, 0.95),
    vip: firstMoney(product?.priceNetVip) ?? defaultNet(list || walkIn, 0.85),
    coach: firstMoney(product?.priceNetCoach) ?? firstMoney(product?.priceNetVip) ?? defaultNet(list || walkIn, 0.85),
    senior: firstMoney(product?.priceNetSenior) ?? defaultNet(list || walkIn, 0.75),
    seniorRed: firstMoney(product?.priceNetSeniorRed) ?? defaultNet(list || walkIn, 0.85),
  }
}

export function resolveMemberUnitPrice(
  product?: Partial<PosProduct> | null,
  pricing?: MemberPricing | null,
): number {
  const list = transferListPrice(product)
  if (pricing?.manualRate) {
    const base = memberRateBase(product, list) || list
    const rate = Number(pricing.rate)
    if (!(base > 0) || !(rate > 0) || rate > 1) return Math.round((list || 0) * 100) / 100
    return Math.round(base * rate * 100) / 100
  }
  const nets = transferPriceNets(product)
  const lv = pricing?.level || ''
  let unit = nets.new
  if (lv === '普通會員') unit = nets.normal
  else if (lv === '尊貴會員') unit = nets.vip
  else if (lv === '教練會員') unit = nets.coach ?? nets.vip
  else if (lv === '長者會員') unit = pricing?.isRedDay ? nets.seniorRed : nets.senior
  const base = memberRateBase(product, list)
  const rate = Number(pricing?.rate)
  if (base > 0 && rate > 0 && rate < 1) unit = Math.min(unit, defaultNet(base, rate))
  else if (pricing?.isBirthday && base > 0) unit = Math.min(unit, defaultNet(base, 0.75))
  return Math.round((Number.isFinite(unit) ? unit : 0) * 100) / 100
}
