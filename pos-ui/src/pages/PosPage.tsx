import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Barcode,
  Bookmark,
  CreditCard,
  FileText,
  Minus,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
  User,
  UserPlus,
  X,
} from 'lucide-react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'
import { cn } from '@/lib/utils'
import type { PosCartLine, PosMember, PosProduct, PointsSettings } from '@/lib/types'
import { PAYMENT_METHODS } from '@/lib/types'

type PosDraft = {
  id: string
  store: string
  label?: string
  remark?: string
  paymentMethod?: string
  pointsToRedeem?: number
  memberId?: string
  memberName?: string
  memberPhone?: string
  items: PosCartLine[]
  subtotal?: number
  itemCount?: number
  createdAt?: string
  createdById?: string
  createdByName?: string
  updatedAt?: string
  updatedAtMs?: number
}

type PosDraftListResponse = {
  drafts: PosDraft[]
  canManage: boolean
  me: { id: string; name: string }
}

function stockOf(p: PosProduct, store: string) {
  return Number(p.stock?.[store] || 0)
}

export function PosPage() {
  const navigate = useNavigate()
  const barcodeRef = useRef<HTMLInputElement>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [products, setProducts] = useState<PosProduct[]>([])
  const [stores, setStores] = useState<string[]>([])
  const [store, setStore] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [barcodeInput, setBarcodeInput] = useState('')
  const [cart, setCart] = useState<PosCartLine[]>([])
  const [member, setMember] = useState<PosMember | null>(null)
  const [memberPhone, setMemberPhone] = useState('')
  const [showMemberDialog, setShowMemberDialog] = useState(false)
  const [pointsSettings, setPointsSettings] = useState<PointsSettings>({
    pointsPerDollar: 100,
    redeemEnabled: true,
  })
  const [pointsToRedeem, setPointsToRedeem] = useState(0)
  const [paymentMethod, setPaymentMethod] = useState('cash')
  const [remark, setRemark] = useState('')
  const [showPayDialog, setShowPayDialog] = useState(false)
  const [cashReceived, setCashReceived] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [drafts, setDrafts] = useState<PosDraft[]>([])
  const [draftsLoading, setDraftsLoading] = useState(false)
  const [showDraftsDialog, setShowDraftsDialog] = useState(false)
  const [savingDraft, setSavingDraft] = useState(false)
  const [activeDraftId, setActiveDraftId] = useState('')
  const [draftAccess, setDraftAccess] = useState<{ canManage: boolean; me: { id: string; name: string } }>(
    { canManage: false, me: { id: '', name: '' } },
  )

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [prods, pts] = await Promise.all([
        apiJson<{ products: PosProduct[]; stores: string[] }>('/api/pos/products'),
        apiJson<{ settings: PointsSettings }>('/api/pos/points-settings').catch(() => ({
          settings: { pointsPerDollar: 100, redeemEnabled: true },
        })),
      ])
      setProducts(prods.products || [])
      const st = prods.stores || []
      setStores(st)
      setStore((prev) => (prev && st.includes(prev) ? prev : st[0] || ''))
      if (pts.settings) setPointsSettings(pts.settings)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
    barcodeRef.current?.focus()
  }, [load])

  const loadDrafts = useCallback(async (targetStore: string) => {
    if (!targetStore) {
      setDrafts([])
      setDraftAccess({ canManage: false, me: { id: '', name: '' } })
      return
    }
    setDraftsLoading(true)
    try {
      const res = await apiJson<PosDraftListResponse>(
        `/api/pos/drafts?store=${encodeURIComponent(targetStore)}`,
      )
      setDrafts(res.drafts || [])
      setDraftAccess({
        canManage: !!res.canManage,
        me: res.me || { id: '', name: '' },
      })
    } catch (e) {
      setDrafts([])
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setDraftsLoading(false)
    }
  }, [])

  useEffect(() => {
    setActiveDraftId('')
    void loadDrafts(store)
  }, [store, loadDrafts])

  const filtered = useMemo(() => {
    const q = searchQuery.trim().toLowerCase()
    return products.filter((p) => {
      if (p.active === false) return false
      if (!q) return true
      return (
        p.name.toLowerCase().includes(q) ||
        String(p.sku).toLowerCase().includes(q) ||
        String(p.size).toLowerCase().includes(q) ||
        String(p.transferProductId || '')
          .toLowerCase()
          .includes(q)
      )
    })
  }, [products, searchQuery])

  const subtotal = useMemo(
    () => cart.reduce((s, l) => s + l.unitPrice * l.qty, 0),
    [cart],
  )
  const n = Math.max(1, pointsSettings.pointsPerDollar || 100)
  const pointsDiscount = pointsSettings.redeemEnabled ? pointsToRedeem / n : 0
  const grandTotal = Math.max(0, Math.round((subtotal - pointsDiscount) * 100) / 100)
  const cashRecv = Number(cashReceived)
  const change =
    paymentMethod === 'cash' && isFinite(cashRecv) ? Math.round((cashRecv - grandTotal) * 100) / 100 : 0
  const activeDraft = useMemo(
    () => drafts.find((draft) => draft.id === activeDraftId) || null,
    [drafts, activeDraftId],
  )

  const addProduct = (p: PosProduct, qty = 1) => {
    if (!store) {
      toast.error('請先選擇店舖')
      return
    }
    const avail = stockOf(p, store)
    setCart((prev) => {
      const existing = prev.find((x) => x.productId === p.id)
      const nextQty = (existing?.qty || 0) + qty
      if (nextQty > avail) {
        toast.error(`庫存不足，${store}僅剩 ${avail}`)
        return prev
      }
      if (existing) {
        return prev.map((x) => (x.productId === p.id ? { ...x, qty: nextQty } : x))
      }
      return [
        ...prev,
        {
          productId: p.id,
          name: p.name,
          sku: p.sku,
          size: p.size,
          unitPrice: Number(p.price) || 0,
          qty,
        },
      ]
    })
  }

  const handleBarcode = (e: React.FormEvent) => {
    e.preventDefault()
    const code = barcodeInput.trim()
    if (!code) return
    const hit =
      products.find((p) => String(p.sku).toLowerCase() === code.toLowerCase()) ||
      products.find((p) => String(p.sku).toLowerCase().includes(code.toLowerCase()))
    if (!hit || hit.active === false) {
      toast.error('找不到商品，請檢查條碼／SKU')
    } else {
      addProduct(hit)
      toast.success(`已加入：${hit.name} ${hit.size}`)
    }
    setBarcodeInput('')
    barcodeRef.current?.focus()
  }

  const updateQty = (productId: string, delta: number) => {
    const p = products.find((x) => x.id === productId)
    setCart((prev) =>
      prev
        .map((line) => {
          if (line.productId !== productId) return line
          const next = line.qty + delta
          if (next <= 0) return null
          const avail = p ? stockOf(p, store) : 9999
          if (next > avail) {
            toast.error(`庫存不足，僅剩 ${avail}`)
            return line
          }
          return { ...line, qty: next }
        })
        .filter(Boolean) as PosCartLine[],
    )
  }

  const findMember = useCallback(async (query: string) => {
    const q = query.trim()
    if (!q) return null
    const res = await apiJson<{ members: PosMember[] }>(
      `/api/pos/members?q=${encodeURIComponent(q)}&includeInactive=0`,
    )
    const list = res.members || []
    return (
      list.find((x) => x.id === q || x.phone === q) ||
      list.find((x) => String(x.phone).includes(q)) ||
      list[0] ||
      null
    )
  }, [])

  const searchMember = async () => {
    const phone = memberPhone.trim()
    if (!phone) {
      toast.error('請輸入電話號碼')
      return
    }
    try {
      const m = await findMember(phone)
      if (!m) {
        toast.error('找不到會員')
        return
      }
      if (m.active === false) {
        toast.error('會員已停用')
        return
      }
      setMember(m)
      setPointsToRedeem(0)
      setShowMemberDialog(false)
      toast.success(`已登入會員：${m.name}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const maxRedeemable = useMemo(() => {
    if (!member || !pointsSettings.redeemEnabled) return 0
    const bal = Math.max(0, Number(member.points) || 0)
    const maxByTotal = Math.floor(subtotal) * n
    return Math.min(bal, maxByTotal - (maxByTotal % n))
  }, [member, pointsSettings.redeemEnabled, subtotal, n])

  const openPay = () => {
    if (!store) {
      toast.error('請先選擇店舖')
      return
    }
    if (!cart.length) {
      toast.error('購物車是空的')
      return
    }
    if (pointsToRedeem > 0) {
      if (pointsToRedeem % n !== 0) {
        toast.error(`折抵積分須為 ${n} 的倍數`)
        return
      }
      if (pointsToRedeem > maxRedeemable) {
        toast.error('折抵積分超出可用額度')
        return
      }
    }
    setCashReceived(String(grandTotal))
    setShowPayDialog(true)
  }

  const saveDraft = async () => {
    if (!store) {
      toast.error('請先選擇店舖')
      return
    }
    if (!cart.length) {
      toast.error('購物車是空的，無法保存草稿')
      return
    }
    const labelInput = prompt('草稿暱稱（選填）', activeDraft?.label || '')
    if (labelInput === null) return
    setSavingDraft(true)
    try {
      const res = await apiJson<{ draft: PosDraft }>('/api/pos/drafts', {
        method: 'POST',
        body: JSON.stringify({
          id: activeDraftId || undefined,
          store,
          label: labelInput.trim(),
          remark,
          paymentMethod,
          pointsToRedeem,
          memberId: member?.id || '',
          memberName: member?.name || '',
          memberPhone: member?.phone || '',
          items: cart.map((line) => ({
            productId: line.productId,
            name: line.name,
            sku: line.sku,
            size: line.size,
            unitPrice: line.unitPrice,
            qty: line.qty,
          })),
        }),
      })
      setActiveDraftId(res.draft?.id || activeDraftId)
      await loadDrafts(store)
      toast.success(activeDraftId ? '草稿已更新' : '草稿已保存')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setSavingDraft(false)
    }
  }

  const restoreDraft = async (draft: PosDraft) => {
    if (cart.length && !confirm('恢復草稿會覆蓋目前購物車，確定繼續？')) return
    setCart(
      (draft.items || []).map((item) => ({
        productId: item.productId,
        name: item.name,
        sku: item.sku,
        size: item.size,
        unitPrice: Number(item.unitPrice) || 0,
        qty: Number(item.qty) || 0,
      })),
    )
    setRemark(draft.remark || '')
    setPaymentMethod(draft.paymentMethod || 'cash')
    setPointsToRedeem(Math.max(0, Math.floor(Number(draft.pointsToRedeem) || 0)))
    setMemberPhone(draft.memberPhone || '')
    if (draft.memberId || draft.memberName || draft.memberPhone) {
      setMember({
        id: draft.memberId || draft.memberPhone || draft.id,
        name: draft.memberName || '會員',
        phone: draft.memberPhone || '',
      })
      try {
        const freshMember = await findMember(draft.memberId || draft.memberPhone || '')
        if (freshMember) setMember(freshMember)
      } catch {
        /* keep saved member snapshot */
      }
    } else {
      setMember(null)
    }
    setActiveDraftId(draft.id)
    setShowDraftsDialog(false)
    toast.success('已恢復草稿')
  }

  const deleteDraft = async (draft: PosDraft) => {
    if (!confirm(`確定刪除草稿「${draft.label || draft.updatedAt || draft.id}」？`)) return
    try {
      await apiJson(`/api/pos/drafts/${encodeURIComponent(draft.id)}`, { method: 'DELETE' })
      if (draft.id === activeDraftId) setActiveDraftId('')
      await loadDrafts(store)
      toast.success('草稿已刪除')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const checkout = async () => {
    if (checkingOut) return
    if (paymentMethod === 'cash' && isFinite(cashRecv) && cashRecv < grandTotal) {
      toast.error('收款金額不足')
      return
    }
    setCheckingOut(true)
    try {
      const body: Record<string, unknown> = {
        store,
        paymentMethod,
        remark,
        memberId: member?.id || '',
        memberName: member?.name || '',
        memberPhone: member?.phone || '',
        items: cart.map((l) => ({ productId: l.productId, qty: l.qty })),
      }
      if (pointsToRedeem > 0) body.pointsToRedeem = pointsToRedeem
      if (activeDraftId) body.draftId = activeDraftId
      const res = await apiJson<{ transaction: { id: string; orderNo?: string } }>(
        '/api/pos/checkout',
        { method: 'POST', body: JSON.stringify(body) },
      )
      const tx = res.transaction
      toast.success(`結帳成功${tx?.orderNo ? `：${tx.orderNo}` : ''}`)
      setActiveDraftId('')
      setCart([])
      setMember(null)
      setPointsToRedeem(0)
      setRemark('')
      setShowPayDialog(false)
      await load()
      await loadDrafts(store)
      if (tx?.id) navigate(`/receipt/${encodeURIComponent(tx.id)}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
      await load()
    } finally {
      setCheckingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="flex h-[70vh] items-center justify-center text-slate-500">載入 POS 資料…</div>
    )
  }
  if (error) {
    return (
      <div className="flex h-[70vh] flex-col items-center justify-center gap-3 p-6">
        <p className="text-red-600">{error}</p>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md bg-slate-900 px-4 py-2 text-sm text-white"
        >
          重試
        </button>
      </div>
    )
  }
  if (!stores.length) {
    return (
      <div className="flex h-[70vh] items-center justify-center p-6 text-red-600">
        你的賬戶沒有港店所屬單位，無法使用 POS。
      </div>
    )
  }

  return (
    <div className="flex h-[calc(100vh-8px)] min-h-[560px] bg-slate-50 text-slate-900">
      {/* Left: products */}
      <div className="flex w-[340px] shrink-0 flex-col border-r border-slate-200 bg-white lg:w-[380px]">
        <div className="space-y-2 border-b border-slate-200 p-3">
          <div className="flex items-center gap-2">
            <label className="text-xs font-medium text-slate-500">店舖</label>
            <select
              value={store}
              onChange={(e) => {
                setStore(e.target.value)
                setCart([])
              }}
              className="h-9 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm"
            >
              {stores.map((s) => (
                <option key={s} value={s}>
                  {s}店
                </option>
              ))}
            </select>
          </div>
          <form onSubmit={handleBarcode} className="flex gap-2">
            <div className="relative flex-1">
              <Barcode className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-slate-400" />
              <input
                ref={barcodeRef}
                value={barcodeInput}
                onChange={(e) => setBarcodeInput(e.target.value)}
                placeholder="掃描／輸入條碼或 SKU"
                className="h-9 w-full rounded-md border border-slate-200 bg-slate-50 pr-3 pl-8 text-sm outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-100"
              />
            </div>
            <button
              type="submit"
              className="h-9 rounded-md bg-slate-900 px-3 text-sm font-medium text-white"
            >
              加入
            </button>
          </form>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-2 size-4 -translate-y-1/2 text-slate-400" />
            <input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜尋商品名稱／SKU"
              className="h-9 w-full rounded-md border border-slate-200 bg-white pr-3 pl-8 text-sm outline-none focus:border-sky-500"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto p-3">
          <div className="grid grid-cols-2 gap-2">
            {filtered.map((p) => {
              const avail = stockOf(p, store)
              return (
                <button
                  key={p.id}
                  type="button"
                  disabled={avail <= 0}
                  onClick={() => {
                    addProduct(p)
                    toast.success(`已加入：${p.name}`)
                  }}
                  className={cn(
                    'group flex flex-col overflow-hidden rounded-md border border-slate-200 bg-white text-left transition-colors hover:border-sky-400',
                    avail <= 0 && 'cursor-not-allowed opacity-50',
                  )}
                >
                  <div className="flex aspect-[4/3] items-center justify-center bg-slate-100 text-xs text-slate-400">
                    {p.size}
                  </div>
                  <div className="space-y-1 p-2">
                    <p className="line-clamp-2 h-8 text-xs leading-tight font-medium">{p.name}</p>
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-bold text-sky-700">{formatHKD(p.price)}</span>
                      <span
                        className={cn(
                          'text-[10px] tabular-nums',
                          avail <= 2 ? 'font-semibold text-red-600' : 'text-slate-500',
                        )}
                      >
                        庫存 {avail}
                      </span>
                    </div>
                    <p className="truncate text-[10px] text-slate-400">{p.sku}</p>
                  </div>
                </button>
              )
            })}
          </div>
          {!filtered.length && (
            <div className="py-12 text-center text-sm text-slate-500">找不到符合的商品</div>
          )}
        </div>
      </div>

      {/* Middle: cart */}
      <div className="flex min-w-0 flex-1 flex-col bg-white">
        <div className="flex items-center justify-between border-b border-slate-200 bg-white p-3">
          <h2 className="font-semibold">購物清單</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setShowDraftsDialog(true)}
              className="inline-flex h-8 items-center gap-1 rounded-md border border-slate-200 px-2 text-sm text-slate-600 hover:bg-slate-50"
            >
              <Bookmark className="size-3.5" />
              草稿 ({drafts.length})
            </button>
            <span className="text-sm text-slate-500">{cart.length} 項商品</span>
            {cart.length > 0 && (
              <button
                type="button"
                onClick={() => setCart([])}
                className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-sm text-red-600 hover:bg-red-50"
              >
                <Trash2 className="size-3.5" />
                清空
              </button>
            )}
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {!cart.length ? (
            <div className="flex h-full flex-col items-center justify-center text-slate-400">
              <ShoppingCart className="mb-3 size-16 opacity-20" />
              <p className="text-sm">購物車為空</p>
              <p className="text-xs">掃描條碼或點擊商品加入</p>
            </div>
          ) : (
            <div className="divide-y divide-slate-100">
              {cart.map((item) => (
                <div key={item.productId} className="flex gap-3 p-3 hover:bg-slate-50">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium">{item.name}</p>
                        <p className="text-xs text-slate-500">
                          {item.size} · {item.sku}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => setCart((prev) => prev.filter((x) => x.productId !== item.productId))}
                        className="shrink-0 p-1 text-slate-400 hover:text-red-600"
                      >
                        <X className="size-4" />
                      </button>
                    </div>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-1 rounded-md border border-slate-200">
                        <button
                          type="button"
                          onClick={() => updateQty(item.productId, -1)}
                          className="p-1.5 hover:bg-slate-100"
                        >
                          <Minus className="size-3.5" />
                        </button>
                        <span className="w-8 text-center text-sm font-medium tabular-nums">
                          {item.qty}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQty(item.productId, 1)}
                          className="p-1.5 hover:bg-slate-100"
                        >
                          <Plus className="size-3.5" />
                        </button>
                      </div>
                      <div className="text-right text-sm font-semibold tabular-nums">
                        {formatHKD(item.unitPrice * item.qty)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Right: summary */}
      <div className="flex w-72 shrink-0 flex-col border-l border-slate-200 bg-white lg:w-80">
        <div className="border-b border-slate-200 p-3">
          <h2 className="mb-2 font-semibold">交易摘要</h2>
          {member ? (
            <div className="rounded-lg border border-sky-200 bg-sky-50 p-3">
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="flex size-8 items-center justify-center rounded-full bg-sky-100">
                    <User className="size-4 text-sky-700" />
                  </div>
                  <div>
                    <p className="text-sm font-medium">{member.name}</p>
                    <p className="text-xs text-slate-500">
                      {member.level || '一般會員'} · {member.phone}
                    </p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setMember(null)
                    setPointsToRedeem(0)
                  }}
                  className="text-slate-400 hover:text-slate-700"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-2 border-t border-sky-100 pt-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-slate-500">可用積分</span>
                  <span className="font-medium tabular-nums">
                    {(Number(member.points) || 0).toLocaleString()}
                  </span>
                </div>
                {pointsSettings.redeemEnabled && (Number(member.points) || 0) > 0 && (
                  <div className="mt-2 space-y-2">
                    <div className="flex gap-2">
                      <input
                        type="number"
                        min={0}
                        step={1}
                        value={pointsToRedeem || ''}
                        onChange={(e) => setPointsToRedeem(Math.max(0, Math.floor(Number(e.target.value) || 0)))}
                        className="h-9 min-w-0 flex-1 rounded-md border border-slate-200 bg-white px-2 text-sm"
                        placeholder="輸入折抵積分"
                      />
                      <button
                        type="button"
                        disabled={!maxRedeemable}
                        onClick={() => setPointsToRedeem(maxRedeemable)}
                        className="shrink-0 rounded-md border border-slate-200 px-3 text-sm font-medium text-slate-700 hover:bg-slate-100 disabled:opacity-40"
                      >
                        用盡
                      </button>
                    </div>
                    <div className="space-y-1 text-[11px] text-slate-500">
                      <p>每 {n} 分＝$1，預估折抵 {formatHKD(pointsDiscount)}</p>
                      <p>
                        須為 {n} 倍數，最多可用 {(Number(member.points) || 0).toLocaleString()} 分，本單最多折抵{' '}
                        {maxRedeemable.toLocaleString()} 分
                      </p>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">折抵積分</span>
                      <span className="font-medium text-sky-700 tabular-nums">
                        {pointsToRedeem.toLocaleString()} = -{formatHKD(pointsDiscount)}
                      </span>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setShowMemberDialog(true)}
              className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-dashed border-slate-300 text-sm text-slate-500 transition-colors hover:border-sky-400 hover:text-sky-700"
            >
              <UserPlus className="size-4" />
              輸入會員電話
            </button>
          )}
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3 text-sm">
          <div className="flex justify-between">
            <span className="text-slate-500">商品小計</span>
            <span className="tabular-nums">{formatHKD(subtotal)}</span>
          </div>
          {pointsDiscount > 0 && (
            <div className="flex justify-between text-red-600">
              <span>積分折抵</span>
              <span className="tabular-nums">-{formatHKD(pointsDiscount)}</span>
            </div>
          )}
          <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold">
            <span>應收</span>
            <span className="tabular-nums text-sky-700">{formatHKD(grandTotal)}</span>
          </div>
          <label className="mt-2 block text-xs text-slate-500">備註</label>
          <input
            value={remark}
            onChange={(e) => setRemark(e.target.value)}
            className="h-9 w-full rounded-md border border-slate-200 px-2 text-sm"
            placeholder="選填"
          />
        </div>

        <div className="space-y-2 border-t border-slate-200 p-3">
          <button
            type="button"
            disabled={!cart.length}
            onClick={openPay}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-md bg-sky-600 text-base font-semibold text-white hover:bg-sky-700 disabled:opacity-40"
          >
            <CreditCard className="size-5" />
            結帳 {formatHKD(grandTotal)}
          </button>
          <button
            type="button"
            disabled={!cart.length || savingDraft}
            onClick={() => void saveDraft()}
            className="flex h-10 w-full items-center justify-center gap-2 rounded-md border border-slate-200 bg-white text-sm font-medium text-slate-700 hover:bg-slate-50 disabled:opacity-40"
          >
            <FileText className="size-4" />
            {savingDraft ? '保存中…' : '保存草稿'}
          </button>
          {activeDraft && (
            <p className="text-[11px] text-slate-500">
              目前草稿：{activeDraft.label || activeDraft.updatedAt || activeDraft.id}
            </p>
          )}
        </div>
      </div>

      {/* Member dialog */}
      {showMemberDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-sm rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">會員登入</h3>
              <button type="button" onClick={() => setShowMemberDialog(false)}>
                <X className="size-4" />
              </button>
            </div>
            <input
              value={memberPhone}
              onChange={(e) => setMemberPhone(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void searchMember()
              }}
              placeholder="電話號碼"
              className="mb-3 h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
              autoFocus
            />
            <button
              type="button"
              onClick={() => void searchMember()}
              className="h-10 w-full rounded-md bg-slate-900 text-sm font-medium text-white"
            >
              搜尋並登入
            </button>
          </div>
        </div>
      )}

      {/* Drafts dialog */}
      {showDraftsDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-3xl rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <h3 className="font-semibold">POS 草稿</h3>
                <p className="text-xs text-slate-500">{store}店草稿</p>
              </div>
              <button type="button" onClick={() => setShowDraftsDialog(false)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="max-h-[70vh] overflow-y-auto">
              {draftsLoading ? (
                <div className="py-12 text-center text-sm text-slate-500">讀取草稿中…</div>
              ) : !drafts.length ? (
                <div className="py-12 text-center text-sm text-slate-500">此店舖暫時沒有草稿</div>
              ) : (
                <div className="space-y-2">
                  {drafts.map((draft) => {
                    const canDelete =
                      String(draft.createdById || '') === String(draftAccess.me.id || '') ||
                      draftAccess.canManage
                    return (
                      <div
                        key={draft.id}
                        className={cn(
                          'rounded-lg border border-slate-200 p-3',
                          draft.id === activeDraftId && 'border-sky-300 bg-sky-50/50',
                        )}
                      >
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate text-sm font-semibold">
                              {draft.label || draft.createdAt || draft.updatedAt || draft.id}
                            </p>
                            <p className="mt-1 text-xs text-slate-500">
                              {draft.createdByName || '未知建立者'} · {draft.store}店 · {(draft.itemCount || 0).toLocaleString()} 件
                              · {formatHKD(draft.subtotal || 0)}
                            </p>
                            <p className="mt-1 text-xs text-slate-400">
                              更新時間：{draft.updatedAt || '未提供'}
                            </p>
                          </div>
                          <div className="flex shrink-0 items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void restoreDraft(draft)}
                              className="rounded-md bg-sky-600 px-3 py-2 text-sm font-medium text-white hover:bg-sky-700"
                            >
                              恢復
                            </button>
                            {canDelete && (
                              <button
                                type="button"
                                onClick={() => void deleteDraft(draft)}
                                className="rounded-md border border-red-200 px-3 py-2 text-sm font-medium text-red-600 hover:bg-red-50"
                              >
                                刪除
                              </button>
                            )}
                          </div>
                        </div>
                      </div>
                    )
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Payment dialog */}
      {showPayDialog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-lg bg-white p-4 shadow-xl">
            <div className="mb-3 flex items-center justify-between">
              <h3 className="font-semibold">選擇付款方式</h3>
              <button type="button" onClick={() => setShowPayDialog(false)}>
                <X className="size-4" />
              </button>
            </div>
            <div className="mb-4 grid grid-cols-2 gap-2">
              {PAYMENT_METHODS.map((pm) => (
                <button
                  key={pm.id}
                  type="button"
                  onClick={() => setPaymentMethod(pm.id)}
                  className={cn(
                    'h-11 rounded-md border text-sm font-medium',
                    paymentMethod === pm.id
                      ? 'border-sky-500 bg-sky-50 text-sky-800'
                      : 'border-slate-200 hover:bg-slate-50',
                  )}
                >
                  {pm.name}
                </button>
              ))}
            </div>
            <div className="mb-3 flex justify-between text-sm">
              <span className="text-slate-500">應收金額</span>
              <span className="text-lg font-bold tabular-nums">{formatHKD(grandTotal)}</span>
            </div>
            {paymentMethod === 'cash' && (
              <div className="mb-3 space-y-2">
                <label className="text-xs text-slate-500">實收現金</label>
                <input
                  type="number"
                  step="0.01"
                  value={cashReceived}
                  onChange={(e) => setCashReceived(e.target.value)}
                  className="h-10 w-full rounded-md border border-slate-200 px-3 text-sm"
                />
                <div className="flex justify-between text-sm">
                  <span className="text-slate-500">找續</span>
                  <span className={cn('font-semibold tabular-nums', change < 0 && 'text-red-600')}>
                    {formatHKD(change)}
                  </span>
                </div>
              </div>
            )}
            <button
              type="button"
              disabled={checkingOut}
              onClick={() => void checkout()}
              className="h-11 w-full rounded-md bg-sky-600 text-sm font-semibold text-white hover:bg-sky-700 disabled:opacity-50"
            >
              {checkingOut ? '處理中…' : '確認收款並完成'}
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
