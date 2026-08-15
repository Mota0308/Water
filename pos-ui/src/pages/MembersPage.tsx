import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatDateTime, formatHKD } from '@/lib/format'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, btnClass, fieldClass, textareaClass } from '@/components/ui'
import type { PosMember, PosPointLedger, PosTransaction } from '@/lib/types'

function memberNoFor(member: PosMember) {
  return member.memberNo || `M${String(member.phone || member.id).padStart(8, '0')}`
}

function memberLevelLabel(level?: string) {
  const raw = String(level || '')
  if (raw === 'vip' || raw === 'VIP' || raw.includes('VIP')) return 'VIP 會員'
  return '一般會員'
}

function isVipLevel(level?: string) {
  return memberLevelLabel(level) === 'VIP 會員'
}

function memberStatusLabel(active?: boolean) {
  return active === false ? '已停用' : '啟用中'
}

export function MembersPage() {
  const [kw, setKw] = useState('')
  const [members, setMembers] = useState<PosMember[]>([])
  const [transactions, setTransactions] = useState<PosTransaction[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [ledger, setLedger] = useState<PosPointLedger[]>([])
  const [canEdit, setCanEdit] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [levelFilter, setLevelFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [showAddDialog, setShowAddDialog] = useState(false)
  const [addForm, setAddForm] = useState({ name: '', phone: '', level: 'normal', remark: '' })
  const [pointDelta, setPointDelta] = useState('')
  const [pointReason, setPointReason] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [m, tx] = await Promise.all([
        apiJson<{ members: PosMember[]; canEdit?: boolean }>(
          `/api/pos/members?q=${encodeURIComponent(kw)}&includeInactive=1`,
        ),
        apiJson<{ transactions: PosTransaction[] }>('/api/pos/transactions'),
      ])
      setMembers(m.members || [])
      setTransactions(tx.transactions || [])
      setCanEdit(!!m.canEdit)
      setSelectedId((prev) => prev || m.members?.[0]?.id || '')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [kw])

  useEffect(() => {
    void load()
  }, [load])

  const selectedMember = useMemo(
    () => members.find((member) => member.id === selectedId) || null,
    [members, selectedId],
  )

  const loadLedger = useCallback(async (memberId: string) => {
    if (!memberId) return
    try {
      const res = await apiJson<{ ledger: PosPointLedger[] }>(`/api/pos/members/${encodeURIComponent(memberId)}/points`)
      setLedger(res.ledger || [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (selectedId) void loadLedger(selectedId)
  }, [loadLedger, selectedId])

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      if (levelFilter === 'vip' && !isVipLevel(member.level)) return false
      if (levelFilter === 'normal' && isVipLevel(member.level)) return false
      if (statusFilter === 'active' && member.active === false) return false
      if (statusFilter === 'inactive' && member.active !== false) return false
      return true
    })
  }, [levelFilter, members, statusFilter])

  const purchases = useMemo(() => {
    if (!selectedMember) return []
    return transactions
      .filter((tx) => tx.memberId === selectedMember.id || tx.memberPhone === selectedMember.phone)
      .sort((a, b) => Number(b.createdAtMs || 0) - Number(a.createdAtMs || 0))
  }, [selectedMember, transactions])

  const createMember = async () => {
    try {
      await apiJson<{ member: PosMember }>('/api/pos/members', {
        method: 'POST',
        body: JSON.stringify(addForm),
      })
      toast.success('已新增會員')
      setAddForm({ name: '', phone: '', level: 'normal', remark: '' })
      setShowAddDialog(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const adjustPoints = async () => {
    if (!selectedMember) return
    try {
      await apiJson(`/api/pos/members/${encodeURIComponent(selectedMember.id)}/points`, {
        method: 'POST',
        body: JSON.stringify({ delta: Number(pointDelta), reason: pointReason }),
      })
      toast.success('已調整積分')
      setPointDelta('')
      setPointReason('')
      await loadLedger(selectedMember.id)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const toggleActive = async () => {
    if (!selectedMember) return
    try {
      await apiJson(`/api/pos/members/${encodeURIComponent(selectedMember.id)}/active`, {
        method: 'POST',
        body: JSON.stringify({ active: selectedMember.active === false }),
      })
      toast.success(selectedMember.active === false ? '已重新啟用會員' : '已停用會員')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">會員管理</h1>
          <p className="mt-1 text-sm text-slate-500">會員列表、積分流水與購買記錄集中在同一頁處理。</p>
        </div>
        {canEdit && (
          <button type="button" onClick={() => setShowAddDialog(true)} className={btnClass({ variant: 'primary' })}>
            新增會員
          </button>
        )}
      </div>

      <Card>
        <CardHeader>
          <CardTitle>查詢與篩選</CardTitle>
          <CardDescription>可依姓名、電話、會員級別與狀態快速縮小名單。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[minmax(240px,1fr)_180px_180px_auto]">
          <input
            value={kw}
            onChange={(e) => setKw(e.target.value)}
            placeholder="搜尋姓名 / 電話"
            className={fieldClass()}
          />
          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className={fieldClass()}>
            <option value="all">全部級別</option>
            <option value="normal">一般會員</option>
            <option value="vip">VIP 會員</option>
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={fieldClass()}>
            <option value="all">全部狀態</option>
            <option value="active">啟用中</option>
            <option value="inactive">已停用</option>
          </select>
          <button type="button" onClick={() => void load()} className={btnClass({ variant: 'outline' })}>
            搜尋
          </button>
        </CardContent>
      </Card>

      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}

      <div className="grid gap-5 xl:grid-cols-[1.25fr_1fr]">
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>會員列表</CardTitle>
            <CardDescription>共 {filteredMembers.length} 位會員</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">會員編號</th>
                  <th className="px-4 py-3 font-medium">姓名</th>
                  <th className="px-4 py-3 font-medium">電話</th>
                  <th className="px-4 py-3 font-medium">級別</th>
                  <th className="px-4 py-3 font-medium text-right">積分</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredMembers.map((member) => (
                  <tr
                    key={member.id}
                    onClick={() => setSelectedId(member.id)}
                    className={`cursor-pointer transition hover:bg-slate-50 ${selectedId === member.id ? 'bg-sky-50/70' : ''}`}
                  >
                    <td className="px-4 py-3 font-mono text-xs text-slate-500">{memberNoFor(member)}</td>
                    <td className="px-4 py-3 font-medium text-slate-900">{member.name}</td>
                    <td className="px-4 py-3">{member.phone}</td>
                    <td className="px-4 py-3">{memberLevelLabel(member.level)}</td>
                    <td className="px-4 py-3 text-right font-semibold tabular-nums">{Number(member.points || 0).toLocaleString()}</td>
                    <td className="px-4 py-3">
                      <Badge tone={member.active === false ? 'red' : 'emerald'}>{memberStatusLabel(member.active)}</Badge>
                    </td>
                  </tr>
                ))}
                {!filteredMembers.length && !loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      沒有符合條件的會員
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>會員詳情</CardTitle>
            <CardDescription>選取左側會員後，可查看流水與最近購買記錄。</CardDescription>
          </CardHeader>
          <CardContent>
            {!selectedMember ? (
              <div className="rounded-2xl bg-slate-50 px-4 py-10 text-center text-sm text-slate-500">
                請先從左側選擇會員
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-3 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="text-lg font-semibold text-slate-900">{selectedMember.name}</div>
                      <div className="mt-1 font-mono text-xs text-slate-500">{memberNoFor(selectedMember)}</div>
                    </div>
                    <Badge tone={isVipLevel(selectedMember.level) ? 'amber' : 'sky'}>{memberLevelLabel(selectedMember.level)}</Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div>
                      <div className="text-xs text-slate-500">電話</div>
                      <div className="mt-1">{selectedMember.phone}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">狀態</div>
                      <div className="mt-1">{memberStatusLabel(selectedMember.active)}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">目前積分</div>
                      <div className="mt-1 font-semibold tabular-nums">{Number(selectedMember.points || 0).toLocaleString()}</div>
                    </div>
                    <div>
                      <div className="text-xs text-slate-500">備註</div>
                      <div className="mt-1">{selectedMember.remark || '—'}</div>
                    </div>
                  </div>
                  {canEdit && (
                    <div className="flex flex-wrap gap-2">
                      <button type="button" onClick={() => void toggleActive()} className={btnClass({ variant: selectedMember.active === false ? 'success' : 'danger' })}>
                        {selectedMember.active === false ? '重新啟用' : '停用會員'}
                      </button>
                    </div>
                  )}
                </div>

                {canEdit && (
                  <div className="space-y-3 rounded-2xl border border-slate-200 p-4">
                    <div className="text-sm font-medium text-slate-900">手動調整積分</div>
                    <div className="grid gap-3 sm:grid-cols-[140px_1fr]">
                      <input
                        type="number"
                        value={pointDelta}
                        onChange={(e) => setPointDelta(e.target.value)}
                        placeholder="例如 +100 / -50"
                        className={fieldClass()}
                      />
                      <input
                        value={pointReason}
                        onChange={(e) => setPointReason(e.target.value)}
                        placeholder="調分原因"
                        className={fieldClass()}
                      />
                    </div>
                    <button type="button" onClick={() => void adjustPoints()} className={btnClass({ variant: 'secondary' })}>
                      送出調分
                    </button>
                  </div>
                )}

                <div className="space-y-3">
                  <div className="text-sm font-medium text-slate-900">積分流水</div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {ledger.length ? (
                      ledger.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-slate-900">{entry.reason || entry.type}</div>
                              <div className="mt-1 text-xs text-slate-500">
                                {formatDateTime(entry.createdAt)} | 結餘 {Number(entry.balanceAfter || 0).toLocaleString()}
                              </div>
                              {entry.posOrderNo ? (
                                <div className="mt-1 text-xs text-slate-400">單號 {entry.posOrderNo}</div>
                              ) : null}
                            </div>
                            <div className={`font-semibold tabular-nums ${Number(entry.delta) >= 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                              {Number(entry.delta) > 0 ? '+' : ''}
                              {entry.delta}
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">暫無積分流水</div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium text-slate-900">購買記錄</div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {purchases.length ? (
                      purchases.map((tx) => (
                        <div key={tx.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <div className="font-mono text-xs text-slate-500">{tx.receiptNo || tx.orderNo || tx.id}</div>
                              <div className="mt-1 text-slate-800">{formatDateTime(tx.createdAt)} | {tx.store || '—'}</div>
                              <div className="mt-1 text-xs text-slate-400">
                                {(tx.items || []).map((item) => item.name).filter(Boolean).slice(0, 2).join('、') || '—'}
                              </div>
                            </div>
                            <div className="text-right">
                              <div className="font-semibold tabular-nums">{formatHKD(Number(tx.orderTotal) || 0)}</div>
                              <div className="mt-1 text-xs text-slate-500">{tx.orderStatus || tx.status || '—'}</div>
                            </div>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">暫無購買記錄</div>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {showAddDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/45 p-4">
          <div className="w-full max-w-md rounded-3xl bg-white p-5 shadow-xl">
            <div className="mb-4">
              <div className="text-lg font-semibold text-slate-900">新增會員</div>
              <div className="mt-1 text-sm text-slate-500">建立後即可在 POS 搜尋與累積積分。</div>
            </div>
            <div className="space-y-3">
              <input
                value={addForm.name}
                onChange={(e) => setAddForm((prev) => ({ ...prev, name: e.target.value }))}
                placeholder="姓名"
                className={fieldClass()}
              />
              <input
                value={addForm.phone}
                onChange={(e) => setAddForm((prev) => ({ ...prev, phone: e.target.value }))}
                placeholder="8 位香港電話"
                className={fieldClass()}
              />
              <select
                value={addForm.level}
                onChange={(e) => setAddForm((prev) => ({ ...prev, level: e.target.value }))}
                className={fieldClass()}
              >
                <option value="normal">一般會員</option>
                <option value="vip">VIP 會員</option>
              </select>
              <textarea
                value={addForm.remark}
                onChange={(e) => setAddForm((prev) => ({ ...prev, remark: e.target.value }))}
                placeholder="備註（選填）"
                className={textareaClass()}
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={() => setShowAddDialog(false)} className={btnClass({ variant: 'outline' })}>
                取消
              </button>
              <button type="button" onClick={() => void createMember()} className={btnClass({ variant: 'primary' })}>
                確認新增
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
