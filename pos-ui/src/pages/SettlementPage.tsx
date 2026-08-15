import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatDate, formatDateTime, formatHKD } from '@/lib/format'
import {
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  btnClass,
  fieldClass,
  textareaClass,
} from '@/components/ui'
import { PAYMENT_METHODS, type PosReportSummary, type PosSettlementDoc, type PosTransaction } from '@/lib/types'

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
  live: PosReportSummary
  settlement: PosSettlementDoc | null
  locked: boolean
  reviewStatus: string
  hasActivityAfter: boolean
  canSubmit: boolean
  canUnlock: boolean
  canApprove: boolean
  canReject: boolean
  warning?: string
}

function paymentRows(summary?: PosReportSummary | null) {
  const byPayment = summary?.byPayment || {}
  return PAYMENT_METHODS.map((item) => ({
    key: item.id,
    label: item.name,
    system: Number(byPayment[item.id]) || 0,
  }))
}

function statusMeta(data: SettlementRes | null) {
  if (!data) return { label: '載入中', tone: 'slate' as const }
  if (!data.locked) return { label: '未提交', tone: 'slate' as const }
  if (data.reviewStatus === 'approved') return { label: '已核對', tone: 'emerald' as const }
  if (data.reviewStatus === 'rejected') return { label: '已退回', tone: 'red' as const }
  if (data.reviewStatus === 'unlocked') return { label: '已解鎖', tone: 'amber' as const }
  return { label: '待核對', tone: 'sky' as const }
}

export function SettlementPage() {
  const [store, setStore] = useState('')
  const [date, setDate] = useState(todayYmd())
  const [data, setData] = useState<SettlementRes | null>(null)
  const [actualAmounts, setActualAmounts] = useState<Record<string, string>>({})
  const [remark, setRemark] = useState('')
  const [reviewNote, setReviewNote] = useState('')
  const [todayTransactions, setTodayTransactions] = useState<PosTransaction[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const q = new URLSearchParams()
      if (store) q.set('store', store)
      if (date) q.set('date', date)
      const [res, txRes] = await Promise.all([
        apiJson<SettlementRes>(`/api/pos/settlement?${q}`),
        apiJson<{ transactions: PosTransaction[] }>('/api/pos/transactions'),
      ])
      setData(res)
      setTodayTransactions(
        (txRes.transactions || []).filter((tx) => tx.store === (res.store || store) && String(tx.createdAt || '').slice(0, 10) === (res.date || date)),
      )
      if (res.store) setStore(res.store)
      if (res.date) setDate(res.date)
      const systemSummary = res.locked ? res.settlement?.snapshot || res.live : res.live
      const defaults = Object.fromEntries(
        PAYMENT_METHODS.map((item) => {
          const systemAmount = Number(systemSummary?.byPayment?.[item.id]) || 0
          const actual = item.id === 'cash' && res.settlement?.cashCounted != null ? res.settlement.cashCounted : systemAmount
          return [item.id, actual ? String(actual) : '']
        }),
      )
      setActualAmounts(defaults)
      setRemark(res.settlement?.remark || '')
      setReviewNote(res.settlement?.reviewNote || '')
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
    if (actualAmounts.cash == null || actualAmounts.cash === '') {
      toast.error('請填寫現金實點')
      return
    }
    if (!confirm('確定提交日結？')) return
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/submit', {
        method: 'POST',
        body: JSON.stringify({ store, date, cashCounted: Number(actualAmounts.cash), remark }),
      })
      setData(res)
      toast.success('已提交日結')
      await load()
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
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const approve = async () => {
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/approve', {
        method: 'POST',
        body: JSON.stringify({ store, date, note: reviewNote.trim() }),
      })
      setData(res)
      toast.success('已核對通過')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const reject = async () => {
    const note = (reviewNote || prompt('退回原因＊') || '').trim()
    if (!note) return
    try {
      const res = await apiJson<SettlementRes>('/api/pos/settlement/reject', {
        method: 'POST',
        body: JSON.stringify({ store, date, note }),
      })
      setData(res)
      toast.success('已退回')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const live = data?.live
  const setDoc = data?.settlement || null
  const displaySummary = data?.locked ? setDoc?.snapshot || live : live
  const rows = paymentRows(displaySummary)
  const status = statusMeta(data)

  const pointsStats = useMemo(() => {
    return todayTransactions.reduce(
      (acc, tx) => {
        const earned = Number(tx.pointsEarned) || 0
        const redeemed = Number(tx.pointsRedeemed) || 0
        if (earned > 0) acc.earnedCount += 1
        if (redeemed > 0) acc.redeemedCount += 1
        acc.earned += earned
        acc.redeemed += redeemed
        return acc
      },
      { earned: 0, redeemed: 0, earnedCount: 0, redeemedCount: 0 },
    )
  }, [todayTransactions])

  const paymentSummary = useMemo(() => {
    return rows.map((row) => {
      const actual = Number(actualAmounts[row.key] || 0)
      const lockedActual =
        data?.locked && row.key !== 'cash' && !actualAmounts[row.key]
          ? row.system
          : actual
      const displayActual = data?.locked && row.key !== 'cash' ? lockedActual || row.system : actual
      return {
        ...row,
        actual: displayActual,
        diff: Math.round((displayActual - row.system) * 100) / 100,
      }
    })
  }, [actualAmounts, data?.locked, rows])

  const totals = paymentSummary.reduce(
    (acc, row) => {
      acc.system += row.system
      acc.actual += row.actual
      acc.diff += row.diff
      return acc
    },
    { system: 0, actual: 0, diff: 0 },
  )

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">每日銷售結算</h1>
          <p className="mt-1 text-sm text-slate-500">核對營業數據、實收金額與主管審批狀態。</p>
        </div>
        <Badge tone={status.tone}>{status.label}</Badge>
      </div>

      <Card>
        <CardContent className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="text-sm text-slate-600">
              門市
              <select value={store} onChange={(e) => setStore(e.target.value)} className={fieldClass('mt-1')}>
                {(data?.stores || []).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm text-slate-600">
              營業日期
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)} className={fieldClass('mt-1')} />
            </label>
          </div>

          <div className="rounded-2xl border border-slate-100 bg-slate-50 px-4 py-3 text-sm text-slate-600">
            <div>{store || '—'} | {formatDate(date)}</div>
            <div className="mt-1 text-xs text-slate-500">
              {setDoc?.submittedAt ? `提交：${formatDateTime(setDoc.submittedAt)} ${setDoc.submittedByName || ''}` : '尚未提交'}
            </div>
          </div>

          <div className="flex items-end">
            <button type="button" onClick={() => void load()} className={btnClass({ variant: 'outline' })}>
              重新整理
            </button>
          </div>
        </CardContent>
      </Card>

      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {data?.warning && (
        <div className="rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
          {data.warning}
        </div>
      )}
      {data && !loading && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              ['銷售筆數', String(displaySummary?.salesCount || 0)],
              ['銷售額', formatHKD(Number(displaySummary?.salesAmount) || 0)],
              ['退款總額', formatHKD(Number(displaySummary?.refundAmount) || 0)],
              ['淨營業額', formatHKD(Number(displaySummary?.netAmount) || 0)],
            ].map(([k, v]) => (
              <Card key={k}>
                <CardContent className="p-4">
                <div className="text-xs text-slate-500">{k}</div>
                <div className="mt-2 text-xl font-semibold tabular-nums">{v}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          {data.hasActivityAfter && (
            <div className="rounded-2xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">
              提交後尚有新交易，請主管解除後重交。
            </div>
          )}

          <div className="grid gap-5 xl:grid-cols-[1.6fr_1fr]">
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>付款方式核對</CardTitle>
                <CardDescription>提交時只會送出現金實點 `cashCounted`，其餘實際欄位只用作畫面核對。</CardDescription>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">付款方式</th>
                      <th className="px-4 py-3 font-medium text-right">系統金額</th>
                      <th className="px-4 py-3 font-medium text-right">實際金額</th>
                      <th className="px-4 py-3 font-medium text-right">差額</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {paymentSummary.map((row) => (
                      <tr key={row.key}>
                        <td className="px-4 py-3 font-medium text-slate-800">{row.label}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatHKD(row.system)}</td>
                        <td className="px-4 py-3 text-right">
                          {data.locked ? (
                            <span className="tabular-nums">
                              {row.key === 'cash'
                                ? formatHKD(Number(setDoc?.cashCounted) || 0)
                                : formatHKD(row.actual)}
                            </span>
                          ) : (
                            <input
                              type="number"
                              step="0.01"
                              value={actualAmounts[row.key] || ''}
                              onChange={(e) => setActualAmounts((prev) => ({ ...prev, [row.key]: e.target.value }))}
                              className={fieldClass('h-9 text-right tabular-nums')}
                            />
                          )}
                        </td>
                        <td className={`px-4 py-3 text-right font-medium tabular-nums ${Math.abs(row.diff) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {row.diff > 0 ? '+' : ''}
                          {formatHKD(row.diff)}
                        </td>
                      </tr>
                    ))}
                    <tr className="bg-slate-50/80 font-semibold">
                      <td className="px-4 py-3">合計</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatHKD(totals.system)}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{formatHKD(totals.actual)}</td>
                      <td className={`px-4 py-3 text-right tabular-nums ${Math.abs(totals.diff) < 0.01 ? 'text-emerald-600' : 'text-red-600'}`}>
                        {totals.diff > 0 ? '+' : ''}
                        {formatHKD(totals.diff)}
                      </td>
                    </tr>
                  </tbody>
                </table>
              </div>
            </Card>

            <div className="space-y-5">
              <Card>
                <CardHeader>
                  <CardTitle>結算摘要</CardTitle>
                  <CardDescription>
                    應有現金 {formatHKD(Number(displaySummary?.expectedCash) || 0)}
                    {setDoc?.cashCounted != null ? ` | 實點 ${formatHKD(Number(setDoc.cashCounted) || 0)}` : ''}
                  </CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <label className="block text-slate-600">
                    備註
                    <textarea
                      value={remark}
                      onChange={(e) => setRemark(e.target.value)}
                      disabled={data.locked}
                      className={textareaClass('mt-1')}
                    />
                  </label>

                  {(data.canApprove || data.canReject) && (
                    <label className="block text-slate-600">
                      核對備註
                      <textarea
                        value={reviewNote}
                        onChange={(e) => setReviewNote(e.target.value)}
                        className={textareaClass('mt-1 min-h-[88px]')}
                        placeholder="核對通過可留空，退回請填原因。"
                      />
                    </label>
                  )}

                  <div className="flex flex-wrap gap-2 pt-1">
                    {!data.locked && data.canSubmit && (
                      <button type="button" onClick={() => void submit()} className={btnClass({ variant: 'primary' })}>
                        提交日結
                      </button>
                    )}
                    {data.canApprove && (
                      <button type="button" onClick={() => void approve()} className={btnClass({ variant: 'success' })}>
                        核對通過
                      </button>
                    )}
                    {data.canReject && (
                      <button type="button" onClick={() => void reject()} className={btnClass({ variant: 'danger' })}>
                        退回
                      </button>
                    )}
                    {data.canUnlock && (
                      <button type="button" onClick={() => void unlock()} className={btnClass({ variant: 'outline' })}>
                        解除鎖定
                      </button>
                    )}
                  </div>
                </CardContent>
              </Card>

              {(pointsStats.earned > 0 || pointsStats.redeemed > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle>會員積分統計</CardTitle>
                    <CardDescription>按當日該門市交易即時計算。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">獲得積分</span>
                      <span className="font-semibold text-emerald-600 tabular-nums">
                        +{pointsStats.earned.toLocaleString()} ({pointsStats.earnedCount} 筆)
                      </span>
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-slate-500">使用積分</span>
                      <span className="font-semibold text-red-600 tabular-nums">
                        -{pointsStats.redeemed.toLocaleString()} ({pointsStats.redeemedCount} 筆)
                      </span>
                    </div>
                    <div className="flex items-center justify-between rounded-xl bg-slate-50 px-3 py-2">
                      <span className="text-slate-600">淨變動</span>
                      <span className="font-semibold tabular-nums">
                        {(pointsStats.earned - pointsStats.redeemed).toLocaleString()}
                      </span>
                    </div>
                  </CardContent>
                </Card>
              )}

              {setDoc && (
                <Card>
                  <CardHeader>
                    <CardTitle>提交快照</CardTitle>
                    <CardDescription>鎖定後會以提交當下的系統金額作為快照基準。</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-2 text-sm text-slate-600">
                    <div>提交時間：{formatDateTime(setDoc.submittedAt)}</div>
                    <div>提交人：{setDoc.submittedByName || '—'}</div>
                    <div>現金差額：{formatHKD(Number(setDoc.cashDiff) || 0)}</div>
                    {setDoc.reviewedAt ? <div>核對時間：{formatDateTime(setDoc.reviewedAt)}</div> : null}
                    {setDoc.reviewedByName ? <div>核對人：{setDoc.reviewedByName}</div> : null}
                  </CardContent>
                </Card>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}
