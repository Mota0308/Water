import { useCallback, useEffect, useMemo, useState } from 'react'
import type { EChartsOption } from 'echarts'
import ReactECharts from 'echarts-for-react'
import { BarChart3, CalendarDays, CreditCard, FileDown, LineChart, Table2 } from 'lucide-react'
import { apiFetch, apiJson } from '@/lib/api'
import { formatDate, formatHKD } from '@/lib/format'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, btnClass, fieldClass } from '@/components/ui'
import { cn } from '@/lib/utils'
import { PAYMENT_METHODS, type PosReportSummary } from '@/lib/types'

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
  summary?: PosReportSummary
  canExport?: boolean
}

const TAB_ITEMS = [
  { id: 'overview', label: '總覽', icon: LineChart },
  { id: 'payments', label: '付款分析', icon: CreditCard },
  { id: 'days', label: '每日表格', icon: Table2 },
] as const

export function ReportsPage() {
  const [from, setFrom] = useState(todayYmd())
  const [to, setTo] = useState(todayYmd())
  const [store, setStore] = useState('')
  const [data, setData] = useState<ReportRes | null>(null)
  const [tab, setTab] = useState<(typeof TAB_ITEMS)[number]['id']>('overview')
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
  const paymentPairs = useMemo(
    () =>
      PAYMENT_METHODS.map((item) => ({
        id: item.id,
        label: item.name,
        value: Number(s?.byPayment?.[item.id]) || 0,
      })),
    [s],
  )

  const overviewOption = useMemo<EChartsOption>(() => {
    const days = s?.days || []
    return {
      color: ['#0ea5e9', '#0f172a'],
      tooltip: { trigger: 'axis' },
      legend: { bottom: 0, data: ['營業額', '交易筆數'] },
      grid: { left: 48, right: 20, top: 20, bottom: 56 },
      xAxis: {
        type: 'category',
        data: days.map((day) => day.date.slice(5)),
      },
      yAxis: [{ type: 'value', name: 'HK$' }, { type: 'value', name: '筆' }],
      series: [
        {
          name: '營業額',
          type: 'bar',
          barMaxWidth: 28,
          data: days.map((day) => Number(day.netAmount) || 0),
          itemStyle: { borderRadius: [8, 8, 0, 0] },
        },
        {
          name: '交易筆數',
          type: 'line',
          yAxisIndex: 1,
          smooth: true,
          data: days.map((day) => Number(day.salesCount) || 0),
        },
      ],
    }
  }, [s?.days])

  const paymentOption = useMemo<EChartsOption>(() => {
    return {
      color: ['#0ea5e9', '#1d4ed8', '#14b8a6', '#f59e0b'],
      tooltip: {
        trigger: 'item',
        formatter: (params: any) =>
          `${params.name}<br/>${formatHKD(Number(params.value) || 0)}${params.percent != null ? `<br/>佔比 ${params.percent}%` : ''}`,
      },
      legend: { bottom: 0 },
      series: [
        {
          type: 'pie',
          radius: ['42%', '68%'],
          center: ['50%', '42%'],
          label: { show: false },
          data: paymentPairs.map((item) => ({ name: item.label, value: item.value })),
        },
      ],
    }
  }, [paymentPairs])

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">銷售報表</h1>
          <p className="mt-1 text-sm text-slate-500">以真實 `/api/pos/report` 數據呈現 KPI、圖表與每日明細。</p>
        </div>
        <div className="flex items-center gap-2">
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
            className={btnClass({ variant: 'outline' })}
          >
            <FileDown className="size-4" />
            匯出 CSV
          </button>
        </div>
      </div>

      <Card>
        <CardContent className="grid gap-3 lg:grid-cols-[1.2fr_1fr_1fr_auto]">
          <select value={store} onChange={(e) => setStore(e.target.value)} className={fieldClass()}>
            <option value="">全部門市</option>
            {(data?.stores || ['觀塘', '荔枝角', '灣仔', '屯門']).map((x) => (
              <option key={x} value={x}>
                {x}
              </option>
            ))}
          </select>
          <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} className={fieldClass()} />
          <input type="date" value={to} onChange={(e) => setTo(e.target.value)} className={fieldClass()} />
          <button type="button" onClick={() => void load()} className={btnClass({ variant: 'secondary' })}>
            <CalendarDays className="size-4" />
            查詢
          </button>
        </CardContent>
      </Card>

      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {s && (
        <>
          <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
            {[
              ['銷售筆數', String(s.salesCount || 0), 'slate'],
              ['銷售額', formatHKD(Number(s.salesAmount) || 0), 'sky'],
              ['退款總額', formatHKD(Number(s.refundAmount) || 0), 'amber'],
              ['淨營業額', formatHKD(Number(s.netAmount) || 0), 'emerald'],
            ].map(([k, v]) => (
              <Card key={k}>
                <CardContent className="space-y-2 p-4">
                  <Badge tone="slate">{k}</Badge>
                  <div className="text-xl font-semibold tabular-nums">{v}</div>
                </CardContent>
              </Card>
            ))}
          </div>

          <div className="flex flex-wrap gap-2">
            {TAB_ITEMS.map((item) => {
              const Icon = item.icon
              return (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setTab(item.id)}
                  className={cn(
                    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm transition',
                    tab === item.id ? 'bg-sky-600 text-white' : 'bg-slate-100 text-slate-600 hover:bg-slate-200',
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                </button>
              )
            })}
          </div>

          {tab === 'overview' && (
            <div className="grid gap-5 xl:grid-cols-[1.5fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>每日銷售走勢</CardTitle>
                  <CardDescription>
                    {formatDate(s.from)} 至 {formatDate(s.to)}
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  <ReactECharts option={overviewOption} className="h-[340px] w-full" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>核心指標</CardTitle>
                  <CardDescription>現金收款、退款與預期現金快覽。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3 text-sm">
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-slate-600">現金收款</span>
                    <span className="font-semibold tabular-nums">{formatHKD(Number(s.cashSales) || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                    <span className="text-slate-600">現金退款</span>
                    <span className="font-semibold tabular-nums">{formatHKD(Number(s.cashRefunds) || 0)}</span>
                  </div>
                  <div className="flex items-center justify-between rounded-xl bg-sky-50 px-4 py-3 text-sky-800">
                    <span>應有現金</span>
                    <span className="font-semibold tabular-nums">{formatHKD(Number(s.expectedCash) || 0)}</span>
                  </div>
                  <div className="grid grid-cols-2 gap-3 pt-2">
                    {paymentPairs.map((item) => (
                      <div key={item.id} className="rounded-xl border border-slate-200 px-3 py-3">
                        <div className="text-xs text-slate-500">{item.label}</div>
                        <div className="mt-1 font-semibold tabular-nums">{formatHKD(item.value)}</div>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'payments' && (
            <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>付款方式分佈</CardTitle>
                  <CardDescription>按實際銷售金額統計。</CardDescription>
                </CardHeader>
                <CardContent>
                  <ReactECharts option={paymentOption} className="h-[340px] w-full" />
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>付款明細</CardTitle>
                  <CardDescription>依 `/api/pos/report` 的 `summary.byPayment` 顯示。</CardDescription>
                </CardHeader>
                <CardContent className="space-y-2">
                  {paymentPairs.map((item) => (
                    <div key={item.id} className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3 text-sm">
                      <div className="flex items-center gap-2 text-slate-700">
                        <BarChart3 className="size-4 text-sky-600" />
                        {item.label}
                      </div>
                      <span className="font-semibold tabular-nums">{formatHKD(item.value)}</span>
                    </div>
                  ))}
                </CardContent>
              </Card>
            </div>
          )}

          {tab === 'days' && (
            <Card className="overflow-hidden">
              <CardHeader>
                <CardTitle>每日明細</CardTitle>
                <CardDescription>逐日列出門市、交易筆數與收現表現。</CardDescription>
              </CardHeader>
              <div className="overflow-x-auto">
                <table className="min-w-full text-left text-sm">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-4 py-3 font-medium">日期</th>
                      <th className="px-4 py-3 font-medium">門市</th>
                      <th className="px-4 py-3 font-medium text-right">交易筆數</th>
                      <th className="px-4 py-3 font-medium text-right">銷售額</th>
                      <th className="px-4 py-3 font-medium text-right">退款額</th>
                      <th className="px-4 py-3 font-medium text-right">淨額</th>
                      <th className="px-4 py-3 font-medium text-right">應有現金</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(s.days || []).map((d, i) => (
                      <tr key={`${d.date}-${d.store}-${i}`} className="hover:bg-slate-50/70">
                        <td className="px-4 py-3">{formatDate(d.date)}</td>
                        <td className="px-4 py-3">{d.store || s.store || '全部'}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{d.salesCount}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatHKD(d.salesAmount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatHKD(d.refundAmount)}</td>
                        <td className="px-4 py-3 text-right font-semibold tabular-nums">{formatHKD(d.netAmount)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">{formatHKD(d.expectedCash)}</td>
                      </tr>
                    ))}
                    {!(s.days || []).length && (
                      <tr>
                        <td colSpan={7} className="px-4 py-12 text-center text-slate-500">
                          此期間沒有報表資料
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  )
}
