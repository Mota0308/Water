import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'
import type { PosTransaction } from '@/lib/types'

export function ReceiptPage() {
  const { id } = useParams()
  const [tx, setTx] = useState<PosTransaction | null>(null)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [returnMode, setReturnMode] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    setLoading(true)
    setError('')
    try {
      const res = await apiJson<{ transaction: PosTransaction }>(
        `/api/pos/transactions/${encodeURIComponent(id)}`,
      )
      setTx(res.transaction)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => {
    void load()
  }, [load])

  const doFullReturn = async () => {
    if (!tx?.id) return
    if (!reason.trim()) {
      toast.error('請填寫退貨原因')
      return
    }
    if (!confirm('確定整單退貨並回補庫存？')) return
    setBusy(true)
    try {
      const items = (tx.items || []).map((it) => ({
        productId: it.productId,
        qty: it.qty,
      }))
      await apiJson(`/api/pos/transactions/${encodeURIComponent(tx.id)}/return`, {
        method: 'POST',
        body: JSON.stringify({ reason: reason.trim(), refundMethod: 'cash', items }),
      })
      toast.success('退貨完成')
      setReturnMode(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <div className="p-6 text-slate-500">載入收據…</div>
  if (error) return <div className="p-6 text-red-600">{error}</div>
  if (!tx) return <div className="p-6">找不到交易</div>

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-4">
      <div className="flex flex-wrap gap-2">
        <Link to="/pos" className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50">
          繼續收銀
        </Link>
        <Link
          to="/transactions"
          className="rounded-md border border-slate-200 px-3 py-1.5 text-sm hover:bg-slate-50"
        >
          交易紀錄
        </Link>
        <button
          type="button"
          onClick={() => setReturnMode((v) => !v)}
          className="rounded-md border border-red-200 px-3 py-1.5 text-sm text-red-700 hover:bg-red-50"
        >
          {returnMode ? '取消退貨' : '退貨'}
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-5 shadow-sm">
        <h1 className="text-xl font-semibold">收據 {tx.orderNo || tx.id}</h1>
        <p className="mt-1 text-sm text-slate-500">
          {tx.createdAt} · {tx.store}店 · {tx.paymentMethodName || tx.paymentMethod}
        </p>
        {tx.memberName && (
          <p className="mt-1 text-sm text-slate-600">
            會員：{tx.memberName} {tx.memberPhone || ''}
          </p>
        )}
        <div className="mt-4 divide-y divide-slate-100 border-y border-slate-100">
          {(tx.items || []).map((it, idx) => (
            <div key={idx} className="flex justify-between gap-3 py-2 text-sm">
              <div>
                <div className="font-medium">{it.name}</div>
                <div className="text-xs text-slate-500">
                  {it.size} · {it.sku} × {it.qty}
                </div>
              </div>
              <div className="tabular-nums">{formatHKD(Number(it.lineTotal) || 0)}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 space-y-1 text-sm">
          {(Number(tx.pointsDiscount) || 0) > 0 && (
            <div className="flex justify-between text-red-600">
              <span>積分折抵</span>
              <span>-{formatHKD(Number(tx.pointsDiscount))}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-semibold">
            <span>合計</span>
            <span className="tabular-nums">{formatHKD(Number(tx.orderTotal) || 0)}</span>
          </div>
          <p className="text-slate-500">狀態：{tx.orderStatus || tx.status || '完成'}</p>
          {tx.remark && <p className="text-slate-500">備註：{tx.remark}</p>}
        </div>
      </div>
      {returnMode && (
        <div className="rounded-lg border border-red-200 bg-red-50 p-4">
          <label className="text-sm font-medium text-red-800">退貨原因＊</label>
          <input
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            className="mt-1 h-10 w-full rounded-md border border-red-200 bg-white px-3 text-sm"
            placeholder="請填寫原因"
          />
          <button
            type="button"
            disabled={busy}
            onClick={() => void doFullReturn()}
            className="mt-3 h-10 rounded-md bg-red-600 px-4 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
          >
            確認整單退貨
          </button>
        </div>
      )}
    </div>
  )
}
