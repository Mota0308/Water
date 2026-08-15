export type PosStore = '觀塘' | '荔枝角' | '灣仔' | '屯門'
export type PosPaymentMethod = 'cash' | 'credit_card' | 'octopus' | 'fps' | string

export interface PosTransactionItem {
  productId?: string
  transferProductId?: string
  name?: string
  sku?: string
  size?: string
  qty?: number
  returnedQty?: number
  unitPrice?: number
  lineTotal?: number
}

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
  createdAt?: string
  updatedAt?: string
}

export interface PosMember {
  id: string
  memberNo?: string
  name: string
  phone: string
  level?: string
  points?: number
  active?: boolean
  remark?: string
  createdAt?: string
  updatedAt?: string
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
  receiptNo?: string
  orderNo?: string
  orderNoAlt?: string
  invoiceNo?: string
  store?: string
  staffId?: string
  staffName?: string
  cashier?: string
  cashierName?: string
  memberId?: string
  memberNo?: string
  createdAt?: string
  createdAtMs?: number
  createdAtLabel?: string
  subtotal?: number
  orderTotal?: number
  paid?: number
  paymentMethod?: PosPaymentMethod
  paymentMethodName?: string
  paymentStatus?: string
  memberName?: string
  memberPhone?: string
  status?: string
  orderStatus?: string
  pointsBalanceAfter?: number | null
  items?: PosTransactionItem[]
  returns?: unknown[]
  exchanges?: unknown[]
  pointsEarned?: number
  pointsRedeemed?: number
  pointsDiscount?: number
  remark?: string
}

export interface PosPointLedger {
  id: string
  memberId: string
  memberPhone?: string
  memberName?: string
  delta: number
  requestedDelta?: number
  balanceBefore: number
  balanceAfter: number
  clamped?: boolean
  type: string
  reason: string
  amountBase?: number | null
  posTransactionId?: string
  posOrderNo?: string
  returnId?: string
  createdAt: string
  createdAtMs?: number
  createdBy?: string
  createdByName?: string
}

export interface PosReportDay {
  date: string
  store?: string
  salesCount: number
  salesAmount: number
  refundCount: number
  refundAmount: number
  netAmount: number
  expectedCash: number
}

export interface PosReportSummary {
  store?: string
  from: string
  to: string
  salesCount: number
  salesAmount: number
  refundCount: number
  refundAmount: number
  netAmount: number
  byPayment: Record<string, number>
  byRefundMethod?: Record<string, number>
  cashSales: number
  cashRefunds: number
  expectedCash: number
  latestActivityMs?: number
  days: PosReportDay[]
}

export interface PosSettlementDoc {
  id?: string
  store?: string
  date?: string
  locked?: boolean
  reviewStatus?: string
  reviewNote?: string
  submittedAt?: string
  submittedAtMs?: number
  submittedByName?: string
  reviewedAt?: string | null
  reviewedByName?: string | null
  cashCounted?: number
  cashDiff?: number
  remark?: string
  snapshot?: PosReportSummary
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
