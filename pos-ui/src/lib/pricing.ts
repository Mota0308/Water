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
    firstMoney(product?.priceSpecial, product?.priceRetail, product?.priceOriginal, product?.price) || 0
  )
}

function defaultNet(list: number, rate: number) {
  return Math.round(list * rate * 100) / 100
}

export function transferPriceNets(product?: Partial<PosProduct> | null) {
  if (product?.priceNets) return product.priceNets
  const list = transferListPrice(product)
  const walkIn = firstMoney(product?.priceNetNew, product?.priceNet, list) ?? 0
  return {
    new: walkIn,
    normal: firstMoney(product?.priceNetNormal) ?? defaultNet(list || walkIn, 0.95),
    vip: firstMoney(product?.priceNetVip) ?? defaultNet(list || walkIn, 0.85),
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
  else if (lv === '尊貴會員' || lv === '教練會員') unit = nets.vip
  else if (lv === '長者會員') unit = pricing?.isRedDay ? nets.seniorRed : nets.senior
  if (pricing?.isBirthday && list > 0) unit = Math.min(unit, defaultNet(list, 0.75))
  return Math.round((Number.isFinite(unit) ? unit : 0) * 100) / 100
}
