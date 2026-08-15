import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import type { PosMember, PointsSettings } from '@/lib/types'

export function MembersPage() {
  const [kw, setKw] = useState('')
  const [members, setMembers] = useState<PosMember[]>([])
  const [settings, setSettings] = useState<PointsSettings | null>(null)
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [ptsN, setPtsN] = useState(100)
  const [redeemOn, setRedeemOn] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [m, s] = await Promise.all([
        apiJson<{ members: PosMember[] }>(
          `/api/pos/members?q=${encodeURIComponent(kw)}&includeInactive=0`,
        ),
        apiJson<{ settings: PointsSettings; canEdit: boolean }>('/api/pos/points-settings'),
      ])
      setMembers(m.members || [])
      setSettings(s.settings)
      setCanEdit(!!s.canEdit)
      setPtsN(s.settings?.pointsPerDollar || 100)
      setRedeemOn(s.settings?.redeemEnabled !== false)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [kw])

  useEffect(() => {
    void load()
  }, [load])

  const createMember = async () => {
    try {
      await apiJson('/api/pos/members', {
        method: 'POST',
        body: JSON.stringify({ name, phone }),
      })
      toast.success('已新增會員')
      setName('')
      setPhone('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const savePoints = async () => {
    try {
      await apiJson('/api/pos/points-settings', {
        method: 'PUT',
        body: JSON.stringify({ pointsPerDollar: ptsN, redeemEnabled: redeemOn }),
      })
      toast.success('已儲存積分設定')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-4xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">會員管理</h1>
      {settings && (
        <div className="rounded-lg border border-slate-200 bg-white p-4 text-sm">
          <p className="mb-2 text-slate-600">
            累積：消費小計每 $1＝1 分。折抵：每 {settings.pointsPerDollar} 分＝$1
            {settings.redeemEnabled ? '' : '（折抵已關閉）'}。
          </p>
          {canEdit && (
            <div className="flex flex-wrap items-end gap-3">
              <div>
                <label className="text-xs text-slate-500">每 N 分＝$1</label>
                <input
                  type="number"
                  min={1}
                  value={ptsN}
                  onChange={(e) => setPtsN(parseInt(e.target.value, 10) || 1)}
                  className="mt-1 block h-9 w-28 rounded-md border border-slate-200 px-2"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" checked={redeemOn} onChange={(e) => setRedeemOn(e.target.checked)} />
                啟用折抵
              </label>
              <button
                type="button"
                onClick={() => void savePoints()}
                className="h-9 rounded-md bg-slate-900 px-3 text-white"
              >
                儲存設定
              </button>
            </div>
          )}
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <input
          value={kw}
          onChange={(e) => setKw(e.target.value)}
          placeholder="搜尋姓名／電話"
          className="h-10 min-w-[200px] flex-1 rounded-md border border-slate-200 px-3 text-sm"
        />
        <button
          type="button"
          onClick={() => void load()}
          className="h-10 rounded-md border border-slate-200 px-3 text-sm"
        >
          搜尋
        </button>
      </div>
      <div className="rounded-lg border border-slate-200 bg-white p-4">
        <h2 className="mb-2 font-medium">新增會員</h2>
        <div className="flex flex-wrap gap-2">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="姓名"
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
          />
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            placeholder="電話"
            className="h-9 rounded-md border border-slate-200 px-2 text-sm"
          />
          <button
            type="button"
            onClick={() => void createMember()}
            className="h-9 rounded-md bg-sky-600 px-3 text-sm text-white"
          >
            新增
          </button>
        </div>
      </div>
      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">姓名</th>
              <th className="px-3 py-2">電話</th>
              <th className="px-3 py-2">等級</th>
              <th className="px-3 py-2">積分</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {members.map((m) => (
              <tr key={m.id || m.phone}>
                <td className="px-3 py-2 font-medium">{m.name}</td>
                <td className="px-3 py-2">{m.phone}</td>
                <td className="px-3 py-2">{m.level || '一般會員'}</td>
                <td className="px-3 py-2 tabular-nums">{Number(m.points) || 0}</td>
              </tr>
            ))}
            {!members.length && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  沒有會員
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
