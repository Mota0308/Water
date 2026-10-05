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
