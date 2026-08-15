import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { Search } from 'lucide-react'
import { apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'
import type { PosTransaction } from '@/lib/types'

export function TransactionsPage() {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [txs, setTxs] = useState<PosTransaction[]>([])
  const [kw, setKw] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiJson<{ transactions: PosTransaction[] }>('/api/pos/transactions')
      setTxs(res.transactions || [])
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    const q = kw.trim().toLowerCase()
    if (!q) return txs
    return txs.filter((t) => {
      const blob = [t.orderNo, t.store, t.memberName, t.memberPhone, t.paymentMethodName, t.id]
        .join(' ')
        .toLowerCase()
      return blob.includes(q)
    })
  }, [txs, kw])

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold">交易紀錄</h1>
        <Link
          to="/pos"
          className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
        >
          ＋ 新收銀
        </Link>
      </div>
      <div className="relative">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-slate-400" />
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜尋單號／會員／店舖"
          className="h-10 w-full rounded-md border border-slate-200 bg-white pr-3 pl-9 text-sm"
        />
      </div>
      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {!loading && !error && (
        <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
          <table className="w-full text-left text-sm">
            <thead className="bg-slate-50 text-slate-500">
              <tr>
                <th className="px-3 py-2 font-medium">時間</th>
                <th className="px-3 py-2 font-medium">單號</th>
                <th className="px-3 py-2 font-medium">店舖</th>
                <th className="px-3 py-2 font-medium">金額</th>
                <th className="px-3 py-2 font-medium">狀態</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50">
                  <td className="px-3 py-2 whitespace-nowrap text-slate-600">{t.createdAt || '—'}</td>
                  <td className="px-3 py-2">
                    <Link className="font-medium text-sky-700 hover:underline" to={`/receipt/${t.id}`}>
                      {t.orderNo || t.id}
                    </Link>
                  </td>
                  <td className="px-3 py-2">{t.store || '—'}</td>
                  <td className="px-3 py-2 tabular-nums">{formatHKD(Number(t.orderTotal) || 0)}</td>
                  <td className="px-3 py-2 text-slate-600">{t.orderStatus || t.status || '完成'}</td>
                </tr>
              ))}
              {!filtered.length && (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-slate-500">
                    沒有交易
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
