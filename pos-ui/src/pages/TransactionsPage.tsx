import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { CalendarDays, ChevronRight, Receipt, Search } from 'lucide-react'
import { apiJson } from '@/lib/api'
import { formatDateTime, formatHKD } from '@/lib/format'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, btnClass, fieldClass } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PAYMENT_METHODS, type PosStore, type PosTransaction } from '@/lib/types'
import { usePosStore } from '@/store/PosStoreContext'

const STORES: PosStore[] = ['觀塘', '荔枝角', '灣仔', '屯門']
const QUICK_DATES = [
  { id: 'all', label: '全部' },
  { id: 'today', label: '今日' },
  { id: 'yesterday', label: '昨日' },
  { id: '7days', label: '過去 7 日' },
  { id: 'month', label: '本月' },
  { id: 'lastMonth', label: '上月' },
] as const

type QuickDate = (typeof QUICK_DATES)[number]['id']

const PAYMENT_LABELS = Object.fromEntries(PAYMENT_METHODS.map((item) => [item.id, item.name]))

function toDate(value?: string | number | null) {
  if (!value) return null
  const date = new Date(typeof value === 'string' && /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(value) ? value.replace(' ', 'T') : value)
  return Number.isNaN(date.getTime()) ? null : date
}

function matchesQuickDate(value: string | undefined, mode: QuickDate) {
  if (mode === 'all') return true
  const date = toDate(value)
  if (!date) return true
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const target = new Date(date.getFullYear(), date.getMonth(), date.getDate())

  if (mode === 'today') return target.getTime() === today.getTime()
  if (mode === 'yesterday') {
    const yesterday = new Date(today)
    yesterday.setDate(today.getDate() - 1)
    return target.getTime() === yesterday.getTime()
  }
  if (mode === '7days') {
    const start = new Date(today)
    start.setDate(today.getDate() - 6)
    return target >= start
  }
  if (mode === 'month') {
    return target.getFullYear() === now.getFullYear() && target.getMonth() === now.getMonth()
  }
  const lastMonthStart = new Date(now.getFullYear(), now.getMonth() - 1, 1)
  const thisMonthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  return target >= lastMonthStart && target < thisMonthStart
}

function statusMeta(tx: PosTransaction) {
  const key = tx.status || ''
  if (key === 'completed') return { label: '已完成', tone: 'emerald' as const }
  if (key === 'partial_return') return { label: '部分退貨', tone: 'amber' as const }
  if (key === 'full_return') return { label: '全部退貨', tone: 'red' as const }
  if (key === 'voided' || key === 'cancelled') return { label: '已取消', tone: 'red' as const }
  if (tx.orderStatus?.includes('退貨')) return { label: tx.orderStatus, tone: 'amber' as const }
  return { label: tx.orderStatus || tx.status || '—', tone: 'slate' as const }
}

function paymentLabel(tx: PosTransaction) {
  return tx.paymentMethodName || PAYMENT_LABELS[tx.paymentMethod || ''] || tx.paymentMethod || '—'
}

function itemSummary(tx: PosTransaction) {
  const items = tx.items || []
  if (!items.length) return '—'
  const first = items[0]
  const count = items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0)
  const name = first?.name || first?.sku || '商品'
  return count > (Number(first?.qty) || 0) ? `${name} 等 ${count} 件` : `${name} × ${Number(first?.qty) || 0}`
}

export function TransactionsPage() {
  const navigate = useNavigate()
  const { store: currentStore, stores: contextStores } = usePosStore()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [txs, setTxs] = useState<PosTransaction[]>([])
  const [stores, setStores] = useState<string[]>(STORES)
  const [kw, setKw] = useState('')
  const [storeFilter, setStoreFilter] = useState(currentStore || 'all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [paymentFilter, setPaymentFilter] = useState('all')
  const [quickDate, setQuickDate] = useState<QuickDate>('all')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiJson<{ transactions: PosTransaction[]; stores?: string[] }>('/api/pos/transactions')
      setTxs(res.transactions || [])
      setStores(res.stores?.length ? res.stores : contextStores.length ? contextStores : STORES)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [contextStores])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (currentStore) setStoreFilter(currentStore)
  }, [currentStore])

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase()
    if (!q) return txs
    return txs.filter((t) =>
      [
        t.id,
        t.receiptNo,
        t.orderNo,
        t.store,
        t.memberName,
        t.memberPhone,
        t.staffName,
        paymentLabel(t),
        ...(t.items || []).flatMap((item) => [item.name, item.sku, item.size]),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
        .includes(q),
    )
  }, [txs, kw])

  const visibleTransactions = useMemo(
    () =>
      filtered.filter((tx) => {
        if (storeFilter !== 'all' && tx.store !== storeFilter) return false
        if (statusFilter !== 'all' && (tx.status || 'unknown') !== statusFilter) return false
        if (paymentFilter !== 'all' && (tx.paymentMethod || '') !== paymentFilter) return false
        if (!matchesQuickDate(tx.createdAt, quickDate)) return false
        return true
      }),
    [filtered, paymentFilter, quickDate, statusFilter, storeFilter],
  )

  const statusOptions = useMemo(() => {
    const values = new Map<string, string>()
    for (const tx of txs) {
      const key = tx.status || 'unknown'
      values.set(key, statusMeta(tx).label)
    }
    return Array.from(values.entries())
  }, [txs])

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">交易記錄</h1>
          <p className="mt-1 text-sm text-slate-500">共 {visibleTransactions.length} 筆交易</p>
        </div>
        <Link to="/pos" className={btnClass({ variant: 'primary' })}>
          <Receipt className="size-4" />
          新收銀
        </Link>
      </div>

      <Card>
        <CardHeader className="space-y-4">
          <div className="flex items-center gap-2 text-sm text-slate-500">
            <CalendarDays className="size-4" />
            快速日期
          </div>
          <div className="flex flex-wrap gap-2">
            {QUICK_DATES.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setQuickDate(item.id)}
                className={cn(
                  'rounded-full px-3 py-1.5 text-sm transition',
                  quickDate === item.id
                    ? 'bg-sky-600 text-white shadow-sm'
                    : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                )}
              >
                {item.label}
              </button>
            ))}
          </div>

          <div className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px_180px]">
            <div className="relative">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
              <input
                value={kw}
                onChange={(e) => setKw(e.target.value)}
                placeholder="搜尋收據 / 單號 / 會員 / 商品 / SKU"
                className={fieldClass('pl-9')}
              />
            </div>

            <select value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)} className={fieldClass()}>
              <option value="all">全部門市</option>
              {stores.map((store) => (
                <option key={store} value={store}>
                  {store}
                </option>
              ))}
            </select>

            <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={fieldClass()}>
              <option value="all">全部狀態</option>
              {statusOptions.map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>

            <select value={paymentFilter} onChange={(e) => setPaymentFilter(e.target.value)} className={fieldClass()}>
              <option value="all">全部付款</option>
              {PAYMENT_METHODS.map((method) => (
                <option key={method.id} value={method.id}>
                  {method.name}
                </option>
              ))}
            </select>
          </div>
        </CardHeader>
      </Card>

      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && (
        <Card className="overflow-hidden">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>交易列表</CardTitle>
              <CardDescription>可點擊最右箭嘴查看收據與退貨處理。</CardDescription>
            </div>
            <button type="button" onClick={() => void load()} className={btnClass({ variant: 'outline' })}>
              重新整理
            </button>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-4 py-3 font-medium whitespace-nowrap">收據單號</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">日期時間</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">門市</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">收銀員</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">會員</th>
                <th className="px-4 py-3 font-medium">商品摘要</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap text-right">金額</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">付款方式</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap text-right">積分</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap">狀態</th>
                <th className="px-4 py-3 font-medium whitespace-nowrap text-right">查看</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {visibleTransactions.map((t) => {
                const status = statusMeta(t)
                const points = (Number(t.pointsEarned) || 0) - (Number(t.pointsRedeemed) || 0)
                return (
                  <tr key={t.id} className="hover:bg-slate-50/80">
                    <td className="px-4 py-3">
                      <div className="font-mono text-sm font-medium text-slate-900">{t.receiptNo || t.orderNo || t.id}</div>
                      <div className="text-xs text-slate-400">{t.orderNo || t.id}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap text-slate-600">{formatDateTime(t.createdAt)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{t.store || '—'}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{t.staffName || t.cashier || t.cashierName || '—'}</td>
                    <td className="px-4 py-3">
                      <div className="font-medium text-slate-800">{t.memberName || '散客'}</div>
                      <div className="text-xs text-slate-400">{t.memberPhone || '—'}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="max-w-[240px] truncate text-slate-800">{itemSummary(t)}</div>
                    </td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatHKD(Number(t.orderTotal) || 0)}</td>
                    <td className="px-4 py-3 whitespace-nowrap">{paymentLabel(t)}</td>
                    <td className="px-4 py-3 text-right tabular-nums">
                      {points === 0 ? (
                        <span className="text-slate-400">—</span>
                      ) : (
                        <span className={points > 0 ? 'text-emerald-600' : 'text-red-600'}>
                          {points > 0 ? '+' : ''}
                          {points}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <Badge tone={status.tone}>{status.label}</Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <button
                        type="button"
                        onClick={() => navigate(`/receipt/${t.id}`)}
                        className={btnClass({ variant: 'ghost', size: 'icon', className: 'ml-auto rounded-full' })}
                      >
                        <ChevronRight className="size-4" />
                      </button>
                    </td>
                  </tr>
                )
              })}
              {!visibleTransactions.length && (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-500">
                    沒有符合條件的交易記錄
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <CardContent className="border-t border-slate-100 bg-slate-50/60 text-xs text-slate-500">
          交易資料保留真實 API 串接，收據頁會沿用 `/receipt/:id` 路由。
        </CardContent>
      </Card>
      )}
    </div>
  )
}
