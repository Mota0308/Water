export type PosStore = '觀塘' | '荔枝角' | '灣仔' | '屯門'

export interface PosProduct {
  id: string
  name: string
  sku: string
  size: string
  price: number
  transferProductId?: string
  active?: boolean
  stock?: Record<string, number>
  category?: string
  color?: string
}

export interface PosMember {
  id: string
  name: string
  phone: string
  level?: string
  points?: number
  active?: boolean
}

export interface PosCartLine {
  productId: string
  name: string
  sku: string
  size: string
  unitPrice: number
  qty: number
}

export interface PosTransaction {
  id: string
  orderNo?: string
  store?: string
  createdAt?: string
  createdAtMs?: number
  orderTotal?: number
  paymentMethod?: string
  paymentMethodName?: string
  memberName?: string
  memberPhone?: string
  status?: string
  orderStatus?: string
  items?: Array<{
    productId?: string
    name?: string
    sku?: string
    size?: string
    qty?: number
    unitPrice?: number
    lineTotal?: number
  }>
  returns?: unknown[]
  exchanges?: unknown[]
  pointsEarned?: number
  pointsRedeemed?: number
  pointsDiscount?: number
  remark?: string
}

export interface PointsSettings {
  pointsPerDollar: number
  redeemEnabled: boolean
}

export const PAYMENT_METHODS = [
  { id: 'cash', name: '現金' },
  { id: 'credit_card', name: '信用卡' },
  { id: 'octopus', name: '八達通' },
  { id: 'fps', name: 'FPS' },
] as const
