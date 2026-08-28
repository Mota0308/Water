import { useState } from 'react'
import { Link } from 'react-router-dom'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { btnClass } from '@/components/ui'

export function SettingsPage() {
  const [busy, setBusy] = useState(false)

  const seed = async (force: boolean) => {
    if (force && !confirm('強制重載會覆蓋示範資料，確定？')) return
    setBusy(true)
    try {
      const res = await apiJson<{
        skipped?: boolean
        sellablesAdded?: number
        membersAdded?: number
        transactionsAdded?: number
        settlementsAdded?: number
      }>('/api/pos/seed-samples', {
        method: 'POST',
        body: JSON.stringify({ force }),
      })
      if (res.skipped) toast.message('示範資料已存在，未重複載入')
      else {
        toast.success(
          `已載入示範：可售 +${res.sellablesAdded || 0}｜會員 +${res.membersAdded || 0}｜交易 +${res.transactionsAdded || 0}｜日結 +${res.settlementsAdded || 0}`,
        )
      }
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mx-auto max-w-lg space-y-4 p-6">
      <h1 className="text-xl font-semibold">POS 設定</h1>
      <p className="text-sm text-slate-600">
        示範資料涵蓋可售商品、會員／積分、多日交易與日結，方便試用各功能。樣本交易不扣調動庫存。
      </p>
      <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
        <p className="text-sm font-medium">示範資料</p>
        <p className="text-xs text-slate-500">示範會員電話：91110001–91110004</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <button
            type="button"
            disabled={busy}
            onClick={() => void seed(false)}
            className={btnClass()}
          >
            載入／補齊示範
          </button>
          <button
            type="button"
            disabled={busy}
            onClick={() => void seed(true)}
            className={btnClass({ variant: 'secondary' })}
          >
            強制重載示範
          </button>
        </div>
      </div>
      <div className="flex flex-col gap-2">
        <Link to="/members" className="rounded-md border border-slate-200 px-3 py-2 text-sm hover:bg-slate-50">
          會員／積分設定 →
        </Link>
        <Link to="/pos" className="rounded-md bg-sky-600 px-3 py-2 text-center text-sm text-white">
          返回收銀
        </Link>
      </div>
    </div>
  )
}
