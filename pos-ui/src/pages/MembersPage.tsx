import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatDateTime, formatHKD } from '@/lib/format'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, btnClass, fieldClass, textareaClass } from '@/components/ui'
import { MEMBER_LEVELS, memberLevelNote, memberLevelTone, normalizeMemberLevel } from '@/lib/members'
import type { PosMember, PosPointLedger, PosReferredMember, PosTransaction } from '@/lib/types'

function memberNoFor(member: PosMember) {
  return member.memberNo || member.id || `M${String(member.phone || '').padStart(8, '0')}`
}

function memberLevelLabel(level?: string) {
  return normalizeMemberLevel(level)
}

function memberStatusLabel(active?: boolean) {
  return active === false ? '已停用' : '啟用中'
}

const emptyAddForm = { name: '', phone: '', email: '', birthDay: '', birthMonth: '', level: '新會員', remark: '', referrerQuery: '' }
const emptyEditForm = { name: '', phone: '', email: '', birthDay: '', birthMonth: '', level: '新會員', remark: '' }

function memberReferrerLabel(member?: Pick<PosMember, 'referrerName' | 'referrerPhone' | 'referrerId' | 'referrer'> | null) {
  if (!member) return ''
  const name = String(member.referrerName || member.referrer || '').trim()
  const no = String(member.referrerId || '').trim()
  const phone = String(member.referrerPhone || '').trim()
  if (!name && !no && !phone) return ''
  const bits = [name, no, phone].filter(Boolean)
  return bits.join(' · ')
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
  const [addForm, setAddForm] = useState(emptyAddForm)
  const [editForm, setEditForm] = useState(emptyEditForm)
  const [savingProfile, setSavingProfile] = useState(false)
  const [pointDelta, setPointDelta] = useState('')
  const [pointReason, setPointReason] = useState('')
  const [referredMembers, setReferredMembers] = useState<PosReferredMember[]>([])
  const [referrerLookup, setReferrerLookup] = useState<{
    status: 'idle' | 'loading' | 'found' | 'miss'
    member: PosMember | null
  }>({ status: 'idle', member: null })

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

  const selectedReferrerLabel = useMemo(() => {
    if (!selectedMember) return ''
    const live = selectedMember.referrerId
      ? members.find((member) => member.id === selectedMember.referrerId)
      : null
    return memberReferrerLabel(
      live
        ? { referrerId: live.id, referrerName: live.name, referrerPhone: live.phone }
        : selectedMember,
    )
  }, [members, selectedMember])

  useEffect(() => {
    if (!selectedMember) {
      setEditForm(emptyEditForm)
      return
    }
    setEditForm({
      name: selectedMember.name || '',
      phone: selectedMember.phone || '',
      email: selectedMember.email || '',
      birthDay: selectedMember.birthDay || '',
      birthMonth: selectedMember.birthMonth || '',
      level: normalizeMemberLevel(selectedMember.level),
      remark: selectedMember.remark || '',
    })
  }, [selectedMember])

  const loadLedger = useCallback(async (memberId: string) => {
    if (!memberId) return
    try {
      const res = await apiJson<{ ledger: PosPointLedger[]; referredMembers?: PosReferredMember[] }>(
        `/api/pos/members/${encodeURIComponent(memberId)}/points`,
      )
      setLedger(res.ledger || [])
      setReferredMembers(res.referredMembers || [])
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }, [])

  useEffect(() => {
    if (selectedId) {
      void loadLedger(selectedId)
    } else {
      setReferredMembers([])
    }
  }, [loadLedger, selectedId])

  useEffect(() => {
    const q = addForm.referrerQuery.trim()
    if (!showAddDialog) return
    if (!q) {
      setReferrerLookup({ status: 'idle', member: null })
      return
    }
    let cancelled = false
    setReferrerLookup((prev) => ({ ...prev, status: 'loading' }))
    const timer = window.setTimeout(() => {
      void apiJson<{ member: PosMember | null }>(`/api/pos/members/lookup?q=${encodeURIComponent(q)}`)
        .then((res) => {
          if (cancelled) return
          setReferrerLookup(res.member ? { status: 'found', member: res.member } : { status: 'miss', member: null })
        })
        .catch((e) => {
          if (cancelled) return
          setReferrerLookup({ status: 'miss', member: null })
          toast.error(e instanceof Error ? e.message : String(e))
        })
    }, 350)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [addForm.referrerQuery, showAddDialog])

  const filteredMembers = useMemo(() => {
    return members.filter((member) => {
      if (levelFilter !== 'all' && normalizeMemberLevel(member.level) !== levelFilter) return false
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
      const referrerQuery = addForm.referrerQuery.trim()
      if (referrerQuery && referrerLookup.status === 'loading') {
        toast.error('正在核對介紹人，請稍候')
        return
      }
      if (referrerQuery && referrerLookup.status !== 'found') {
        toast.error('找不到介紹人：請輸入已登記會員的電話或會員編號')
        return
      }
      const payload = {
        name: addForm.name,
        phone: addForm.phone,
        email: addForm.email,
        birthDay: addForm.birthDay,
        birthMonth: addForm.birthMonth,
        level: addForm.level,
        remark: addForm.remark,
        referrerId: referrerLookup.member?.id || '',
      }
      await apiJson<{ member: PosMember }>('/api/pos/members', {
        method: 'POST',
        body: JSON.stringify(payload),
      })
      toast.success('已新增會員')
      setAddForm(emptyAddForm)
      setReferrerLookup({ status: 'idle', member: null })
      setShowAddDialog(false)
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const saveProfile = async () => {
    if (!selectedMember) return
    setSavingProfile(true)
    try {
      await apiJson<{ member: PosMember }>(`/api/pos/members/${encodeURIComponent(selectedMember.id)}`, {
        method: 'PUT',
        body: JSON.stringify(editForm),
      })
      toast.success('已更新會員資料')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingProfile(false)
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
        <button
          type="button"
          onClick={() => {
            setAddForm(emptyAddForm)
            setReferrerLookup({ status: 'idle', member: null })
            setShowAddDialog(true)
          }}
          className={btnClass({ variant: 'primary' })}
        >
          新增會員
        </button>
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
            placeholder="搜尋姓名 / 電話 / 會員編號"
            className={fieldClass()}
          />
          <select value={levelFilter} onChange={(e) => setLevelFilter(e.target.value)} className={fieldClass()}>
            <option value="all">全部級別</option>
            {MEMBER_LEVELS.map((lv) => (
              <option key={lv.id} value={lv.id}>
                {lv.label}
              </option>
            ))}
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
                    <td className="px-4 py-3">
                      <Badge tone={memberLevelTone(member.level)}>{memberLevelLabel(member.level)}</Badge>
                    </td>
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
            <CardDescription>選取左側會員後，可修改個人資料、轉換會員類別，並查看積分與購買記錄。</CardDescription>
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
                    <Badge tone={memberLevelTone(selectedMember.level)}>{memberLevelLabel(selectedMember.level)}</Badge>
                  </div>
                  <p className="text-xs text-slate-500">{memberLevelNote(selectedMember.level)}</p>
                  {selectedMember.pricing?.fold ? (
                    <p className="text-xs text-sky-700">今日結帳：{selectedMember.pricing.fold}</p>
                  ) : null}
                  <p className="text-xs text-slate-600">
                    介紹人：{selectedReferrerLabel || '無'}
                  </p>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <label className="text-sm">
                      <span className="text-xs text-slate-500">姓名</span>
                      <input
                        value={editForm.name}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, name: e.target.value }))}
                        className={fieldClass('mt-1')}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs text-slate-500">電話</span>
                      <input
                        value={editForm.phone}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, phone: e.target.value }))}
                        className={fieldClass('mt-1')}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs text-slate-500">電郵</span>
                      <input
                        value={editForm.email}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, email: e.target.value }))}
                        className={fieldClass('mt-1')}
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs text-slate-500">會員類別</span>
                      <select
                        value={editForm.level}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, level: e.target.value }))}
                        className={fieldClass('mt-1')}
                      >
                        {MEMBER_LEVELS.map((lv) => (
                          <option key={lv.id} value={lv.id}>
                            {lv.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="text-sm">
                      <span className="text-xs text-slate-500">出生日期（日）</span>
                      <input
                        value={editForm.birthDay}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, birthDay: e.target.value }))}
                        className={fieldClass('mt-1')}
                        placeholder="1–31"
                      />
                    </label>
                    <label className="text-sm">
                      <span className="text-xs text-slate-500">出生月份</span>
                      <input
                        value={editForm.birthMonth}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, birthMonth: e.target.value }))}
                        className={fieldClass('mt-1')}
                        placeholder="1–12"
                      />
                    </label>
                    <label className="text-sm sm:col-span-2">
                      <span className="text-xs text-slate-500">備註</span>
                      <textarea
                        value={editForm.remark}
                        onChange={(e) => setEditForm((prev) => ({ ...prev, remark: e.target.value }))}
                        className={textareaClass('mt-1')}
                      />
                    </label>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <button type="button" disabled={savingProfile} onClick={() => void saveProfile()} className={btnClass({ variant: 'primary' })}>
                      {savingProfile ? '儲存中…' : '儲存資料'}
                    </button>
                    <div className="text-xs text-slate-500">狀態：{memberStatusLabel(selectedMember.active)} · 積分 {Number(selectedMember.points || 0).toLocaleString()}</div>
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
                  <div className="text-sm font-medium text-slate-900">介紹名單</div>
                  <p className="text-xs text-slate-500">此會員作為介紹人，其介紹的會員消費獲得積分時，這裡的介紹人也會獲得同等積分。</p>
                  <div className="max-h-56 space-y-2 overflow-y-auto">
                    {referredMembers.length ? (
                      referredMembers.map((row) => (
                        <button
                          key={row.id}
                          type="button"
                          onClick={() => setSelectedId(row.id)}
                          className="flex w-full items-center justify-between gap-3 rounded-2xl border border-slate-200 px-4 py-3 text-left text-sm hover:bg-slate-50"
                        >
                          <div>
                            <div className="font-medium text-slate-900">{row.name}</div>
                            <div className="mt-1 font-mono text-xs text-slate-500">
                              {row.memberNo || row.id} · {row.phone}
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="font-semibold tabular-nums">{Number(row.points || 0).toLocaleString()} 分</div>
                            <div className="mt-1 text-xs text-slate-500">{row.active === false ? '已停用' : '啟用中'}</div>
                          </div>
                        </button>
                      ))
                    ) : (
                      <div className="rounded-2xl bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">尚未介紹其他會員</div>
                    )}
                  </div>
                </div>

                <div className="space-y-3">
                  <div className="text-sm font-medium text-slate-900">積分流水</div>
                  <div className="max-h-72 space-y-2 overflow-y-auto">
                    {ledger.length ? (
                      ledger.map((entry) => (
                        <div key={entry.id} className="rounded-2xl border border-slate-200 px-4 py-3 text-sm">
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <div className="font-medium text-slate-900">
                                {entry.type === 'referral_earn' ? '介紹獎勵' : entry.reason || entry.type}
                              </div>
                              {entry.type === 'referral_earn' && entry.reason ? (
                                <div className="mt-1 text-xs text-slate-500">{entry.reason}</div>
                              ) : null}
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
              <div className="mt-1 text-sm text-slate-500">會員編號會自動編成 8 位數字；建立後即可在 POS 搜尋與累積積分。</div>
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
              <input
                value={addForm.email}
                onChange={(e) => setAddForm((prev) => ({ ...prev, email: e.target.value }))}
                placeholder="電郵（選填）"
                className={fieldClass()}
              />
              <select
                value={addForm.level}
                onChange={(e) => setAddForm((prev) => ({ ...prev, level: e.target.value }))}
                className={fieldClass()}
              >
                {MEMBER_LEVELS.map((lv) => (
                  <option key={lv.id} value={lv.id}>
                    {lv.label}
                  </option>
                ))}
              </select>
              <p className="text-xs text-slate-500">{memberLevelNote(addForm.level)}</p>
              <textarea
                value={addForm.remark}
                onChange={(e) => setAddForm((prev) => ({ ...prev, remark: e.target.value }))}
                placeholder="備註（選填）"
                className={textareaClass()}
              />
              <div>
                <input
                  value={addForm.referrerQuery}
                  onChange={(e) => setAddForm((prev) => ({ ...prev, referrerQuery: e.target.value }))}
                  placeholder="介紹人電話或會員編號（選填）"
                  className={fieldClass()}
                />
                <div className="mt-1 text-xs">
                  {!addForm.referrerQuery.trim() ? (
                    <span className="text-slate-500">輸入後會自動核對已有會員；一位介紹人可介紹多位會員。</span>
                  ) : referrerLookup.status === 'loading' ? (
                    <span className="text-slate-500">正在核對介紹人…</span>
                  ) : referrerLookup.status === 'found' && referrerLookup.member ? (
                    <span className="text-emerald-700">
                      已找到：{referrerLookup.member.name} · {memberNoFor(referrerLookup.member)} · {referrerLookup.member.phone}
                    </span>
                  ) : (
                    <span className="text-red-600">找不到此電話／會員編號的會員</span>
                  )}
                </div>
              </div>
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => {
                  setShowAddDialog(false)
                  setAddForm(emptyAddForm)
                  setReferrerLookup({ status: 'idle', member: null })
                }}
                className={btnClass({ variant: 'outline' })}
              >
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
