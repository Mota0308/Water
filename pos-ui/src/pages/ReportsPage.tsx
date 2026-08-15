import { useCallback, useEffect, useState } from 'react'
import { apiFetch, apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'

function todayYmd() {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Hong_Kong',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date())
}

type ReportRes = {
  store?: string
  stores?: string[]
  from?: string
  to?: string
  summary?: {
    salesCount?: number
    salesAmount?: number
    refundCount?: number
    refundAmount?: number
    netAmount?: number
    expectedCash?: number
    byPayment?: Record<string, number>
    days?: Array<{
      date: string
      store: string
      salesCount: number
      salesAmount: number
      refundAmount: number
      netAmount: number
      expectedCash: number
    }>
  }
}

export function ReportsPage() {
  const [from, setFrom] = useState(todayYmd())
  const [to, setTo] = useState(todayYmd())
  const [store, setStore] = useState('')
  const [data, setData] = useState<ReportRes | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const q = new URLSearchParams({ from, to })
      if (store) q.set('store', store)
      const res = await apiJson<ReportRes>(`/api/pos/report?${q}`)
      setData(res)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [from, to, store])

  useEffect(() => {
    void load()
  }, [load])

  const s = data?.summary

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">銷售報表</h1>
      <div className="flex flex-wrap gap-2">
        <select
          value={store}
          onChange={(e) => setStore(e.target.value)}
          className="h-10 rounded-md border border-slate-200 px-2 text-sm"
        >
          <option value="">全部店舖</option>
          {(data?.stores || ['觀塘', '荔枝角', '灣仔', '屯門']).map((x) => (
            <option key={x} value={x}>
              {x}店
            </option>
          ))}
        </select>
        <input
          type="date"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className="h-10 rounded-md border border-slate-200 px-2 text-sm"
        />
        <input
          type="date"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className="h-10 rounded-md border border-slate-200 px-2 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 rounded-md bg-slate-900 px-3 text-sm text-white"
        >
          查詢
        </button>
          <button
            type="button"
            onClick={async () => {
              try {
                const q = new URLSearchParams({ from, to })
                if (store) q.set('store', store)
                const r = await apiFetch(`/api/pos/report.csv?${q}`)
                if (!r.ok) throw new Error('匯出失敗')
                const blob = await r.blob()
                const url = URL.createObjectURL(blob)
                const a = document.createElement('a')
                a.href = url
                a.download = `pos-report-${from}_${to}.csv`
                a.click()
                URL.revokeObjectURL(url)
              } catch (e) {
                alert(e instanceof Error ? e.message : String(e))
              }
            }}
            className="inline-flex h-10 items-center rounded-md border border-slate-200 px-3 text-sm"
          >
            匯出 CSV
          </button>
      </div>
      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['銷售筆數', String(s.salesCount || 0)],
              ['銷售額', formatHKD(Number(s.salesAmount) || 0)],
              ['退款', formatHKD(Number(s.refundAmount) || 0)],
              ['淨額', formatHKD(Number(s.netAmount) || 0)],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg border border-slate-200 bg-white p-3">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="mt-1 text-lg font-semibold tabular-nums">{v}</div>
              </div>
            ))}
          </div>
          <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
            <table className="w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-3 py-2">日期</th>
                  <th className="px-3 py-2">店舖</th>
                  <th className="px-3 py-2">筆數</th>
                  <th className="px-3 py-2">銷售</th>
                  <th className="px-3 py-2">退款</th>
                  <th className="px-3 py-2">淨額</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(s.days || []).map((d, i) => (
                  <tr key={`${d.date}-${d.store}-${i}`}>
                    <td className="px-3 py-2">{d.date}</td>
                    <td className="px-3 py-2">{d.store}</td>
                    <td className="px-3 py-2 tabular-nums">{d.salesCount}</td>
                    <td className="px-3 py-2 tabular-nums">{formatHKD(d.salesAmount)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatHKD(d.refundAmount)}</td>
                    <td className="px-3 py-2 tabular-nums">{formatHKD(d.netAmount)}</td>
                  </tr>
                ))}
                {!(s.days || []).length && (
                  <tr>
                    <td colSpan={6} className="px-3 py-8 text-center text-slate-500">
                      此期間無資料
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  )
}
