import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'

function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type SettlementRes = {
  store: string
  date: string
  stores: string[]
  live: {
    salesCount?: number
    salesAmount?: number
    refundAmount?: number
    netAmount?: number
    expectedCash?: number
    byPayment?: Record<string, number>
  }
  settlement: null | {
    cashCounted?: number
    cashDiff?: number
    remark?: string
    submittedAt?: string
    submittedByName?: string
    reviewStatus?: string
    reviewNote?: string
  }
  locked: boolean
  reviewStatus: string
  hasActivityAfter: boolean
  canSubmit: boolean
  canUnlock: boolean
  canApprove: boolean
  canReject: boolean
  warning?: string
}

export function SettlementPage() {
  const [store, setStore] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [data, setData] = useState<SettlementRes | null>(null)
  const [cash, setCash] = useState('')
  const [remark, setRemark] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const q = new URLSearchParams()
      if (store) q.set('store', store)
      if (date) q.set('date', date)
      const res = await apiJson<SettlementRes>(`/api/pos/settlement?${q}`)
      setData(res)
      if (res.store) setStore(res.store)
      if (res.date) setDate(res.date)
      if (res.settlement?.cashCounted != null) setCash(String(res.settlement.cashCounted))
      if (res.settlement?.remark) setRemark(res.settlement.remark)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [store, date])

  useEffect(() => {
    void load()
  }, [load])

  const submit = async () => {
    if (cash === '') {
      toast.error('請填寫現金實點')
      return
    }
    if (!confirm('確定提交日結？')) return
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/submit', {
        method: 'POST',
        body: JSON.stringify({ store, date, cashCounted: Number(cash), remark }),
      })
      setData(res)
      toast.success('已提交日結')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const unlock = async () => {
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/unlock', {
        method: 'POST',
        body: JSON.stringify({ store, date }),
      })
      setData(res)
      toast.success('已解除鎖定')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const approve = async () => {
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/approve', {
        method: 'POST',
        body: JSON.stringify({ store, date }),
      })
      setData(res)
      toast.success('已核對通過')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const reject = async () => {
    const note = prompt('退回原因＊')
    if (!note) return
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/reject', {
        method: 'POST',
        body: JSON.stringify({ store, date, note }),
      })
      setData(res)
      toast.success('已退回')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const live = data?.live || {}
  const setDoc = data?.settlement

  return (
    <div className="mx-auto max-w-3xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">每日結算</h1>
      <div className="flex flex-wrap gap-2">
        <select
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="h-10 rounded-md border border-slate-200 px-2 text-sm"
        >
          {(data?.stores || []).map((s) => (
            <option key={s} value={s}>
              {s}店
            </option>
          ))}
        </select>
        <input
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          className="h-10 rounded-md border border-slate-200 px-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 rounded-md border border-slate-200 px-3 text-sm"
        >
          重新整理
        </button>
      </div>
      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {data?.warning && (
        <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800">
          {data.warning}
        </div>
      )}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['銷售筆數', String(live.salesCount || 0)],
              ['銷售額', formatHKD(Number(live.salesAmount) || 0)],
              ['退款', formatHKD(Number(live.refundAmount) || 0)],
              ['應有現金', formatHKD(Number(live.expectedCash) || 0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <p className="text-sm text-slate-600">
            狀態：{data.locked ? '已鎖定' : '未提交'}
            {data.reviewStatus ? `｜核對 ${data.reviewStatus}` : ''}
            {setDoc?.submittedAt ? `｜${setDoc.submittedAt} ${setDoc.submittedByName || ''}` : ''}
          </p>
          {data.hasActivityAfter && (
            <div className="rounded-md border border-orange-200 bg-orange-50 px-3 py-2 text-sm text-orange-800">
              提交後尚有新交易，請主管解除後重交。
            </div>
          )}
          {!data.locked && data.canSubmit && (
            <div className="space-y-2 rounded-lg border border-sky-200 bg-white p-4">
              <label className="text-sm">現金實點＊</label>
              <input
                type="number"
                step="0.01"
                value={cash}
                onChange={(e) => setCash(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 px-3"
              />
              <label className="text-sm">備註</label>
              <input
                value={remark}
                onChange={(e) => setRemark(e.target.value)}
                className="h-10 w-full rounded-md border border-slate-200 px-3"
              />
              <button
                type="button"
                onClick={() => void submit()}
                className="h-10 rounded-md bg-sky-600 px-4 text-sm font-medium text-white"
              >
                提交日結
              </button>
            </div>
          )}
          {data.locked && setDoc && (
            <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4 text-sm">
              <p>
                實點 {formatHKD(Number(setDoc.cashCounted) || 0)}｜差異{' '}
                {formatHKD(Number(setDoc.cashDiff) || 0)}
              </p>
              {setDoc.remark && <p>備註：{setDoc.remark}</p>}
              <div className="flex flex-wrap gap-2 pt-2">
                {data.canApprove && (
                  <button
                    type="button"
                    onClick={() => void approve()}
                    className="h-9 rounded-md bg-emerald-600 px-3 text-white"
                  >
                    核對通過
                  </button>
                )}
                {data.canReject && (
                  <button
                    type="button"
                    onClick={() => void reject()}
                    className="h-9 rounded-md bg-red-600 px-3 text-white"
                  >
                    退回
                  </button>
                )}
                {data.canUnlock && (
                  <button
                    type="button"
                    onClick={() => void unlock()}
                    className="h-9 rounded-md border border-slate-200 px-3"
                  >
                    解除鎖定
                  </button>
                )}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
