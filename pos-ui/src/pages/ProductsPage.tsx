import { Fragment, useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, btnClass, fieldClass } from '@/components/ui'
import { cn } from '@/lib/utils'
import type { PosProduct } from '@/lib/types'

type CatalogOpt = {
  transferProductId: string
  name: string
  category?: string
  color?: string
  size: string
  suggestedSku: string
}

type ViewMode = 'table' | 'grid'

type ProductGroup = {
  id: string
  name: string
  category: string
  color: string
  transferProductId?: string
  activeCount: number
  totalStock: number
  items: PosProduct[]
}

const STORE_ORDER = ['觀塘', '荔枝角', '灣仔', '屯門']

function groupProducts(products: PosProduct[]): ProductGroup[] {
  const map = new Map<string, ProductGroup>()
  for (const product of products) {
    const groupId = product.transferProductId || product.name
    const current = map.get(groupId) || {
      id: groupId,
      name: product.name,
      category: product.category || '未分類',
      color: product.color || '',
      transferProductId: product.transferProductId,
      activeCount: 0,
      totalStock: 0,
      items: [],
    }
    current.items.push(product)
    if (product.active !== false) current.activeCount += 1
    current.totalStock += Object.values(product.stock || {}).reduce((sum, qty) => sum + (Number(qty) || 0), 0)
    map.set(groupId, current)
  }
  return Array.from(map.values()).sort((a, b) => a.name.localeCompare(b.name, 'zh-HK'))
}

export function ProductsPage() {
  const [products, setProducts] = useState<PosProduct[]>([])
  const [options, setOptions] = useState<CatalogOpt[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [search, setSearch] = useState('')
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [statusFilter, setStatusFilter] = useState('all')
  const [viewMode, setViewMode] = useState<ViewMode>('table')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [pick, setPick] = useState('')
  const [price, setPrice] = useState('')
  const [sku, setSku] = useState('')
  const [draftPrice, setDraftPrice] = useState<Record<string, string>>({})

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const prods = await apiJson<{ products: PosProduct[]; canManage: boolean }>('/api/pos/products')
      setProducts(prods.products || [])
      setCanManage(!!prods.canManage)
      if (prods.canManage) {
        const opts = await apiJson<{ options: CatalogOpt[] }>('/api/pos/catalog-options')
        setOptions(opts.options || [])
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const o = options.find((x) => `${x.transferProductId}__${x.size}` === pick)
    if (o) {
      setSku(o.suggestedSku)
    }
  }, [pick, options])

  const addSellable = async () => {
    const o = options.find((x) => `${x.transferProductId}__${x.size}` === pick)
    if (!o) {
      toast.error('請選擇貨品尺碼')
      return
    }
    try {
      await apiJson<{ product: PosProduct }>('/api/pos/sellables', {
        method: 'POST',
        body: JSON.stringify({
          transferProductId: o.transferProductId,
          size: o.size,
          price: Number(price),
          sku: sku || o.suggestedSku,
          name: o.name,
        }),
      })
      toast.success('已加入可售目錄')
      setPick('')
      setPrice('')
      await load()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const grouped = useMemo(() => groupProducts(products), [products])

  const categories = useMemo(() => {
    return Array.from(new Set([...products.map((p) => p.category || '未分類'), ...options.map((o) => o.category || '未分類')])).sort(
      (a, b) => a.localeCompare(b, 'zh-HK'),
    )
  }, [options, products])

  const filteredGroups = useMemo(() => {
    const q = search.trim().toLowerCase()
    return grouped.filter((group) => {
      const matchesStatus =
        statusFilter === 'all' ||
        group.items.some((item) => (statusFilter === 'active' ? item.active !== false : item.active === false))
      const matchesCategory = categoryFilter === 'all' || group.category === categoryFilter
      const matchesSearch =
        !q ||
        [group.name, group.transferProductId, group.category, ...group.items.flatMap((item) => [item.sku, item.size])]
          .filter(Boolean)
          .join(' ')
          .toLowerCase()
          .includes(q)
      return matchesStatus && matchesCategory && matchesSearch
    })
  }, [categoryFilter, grouped, search, statusFilter])

  const updateProduct = async (product: PosProduct, patch: { price?: number; active?: boolean }) => {
    try {
      const res = await apiJson<{ product: PosProduct }>(`/api/pos/products/${encodeURIComponent(product.id)}/adjust`, {
        method: 'POST',
        body: JSON.stringify(patch),
      })
      const next = res.product
      setProducts((prev) => prev.map((item) => (item.id === next.id ? { ...next, active: patch.active ?? next.active } : item)))
      if (patch.active === true) await load()
      toast.success('商品已更新')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <div className="mx-auto max-w-7xl space-y-5 p-4 lg:p-6">
      <div>
        <h1 className="text-2xl font-bold text-slate-900">可售商品</h1>
        <p className="mt-1 text-sm text-slate-500">按貨品群組查看各尺碼 SKU、價格與四店庫存。</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>搜尋與篩選</CardTitle>
          <CardDescription>支援搜尋貨品名稱、調動貨號、SKU 與尺碼。</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 lg:grid-cols-[minmax(260px,1fr)_180px_180px_auto_auto]">
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜尋貨品 / 調動貨號 / SKU / 尺碼"
            className={fieldClass()}
          />
          <select value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)} className={fieldClass()}>
            <option value="all">全部分類</option>
            {categories.map((category) => (
              <option key={category} value={category}>
                {category}
              </option>
            ))}
          </select>
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className={fieldClass()}>
            <option value="all">全部狀態</option>
            <option value="active">上架中</option>
            <option value="inactive">已停用</option>
          </select>
          <div className="flex rounded-xl border border-slate-200 bg-white p-1">
            <button
              type="button"
              onClick={() => setViewMode('table')}
              className={cn('rounded-lg px-3 py-2 text-sm', viewMode === 'table' ? 'bg-slate-900 text-white' : 'text-slate-600')}
            >
              表格
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              className={cn('rounded-lg px-3 py-2 text-sm', viewMode === 'grid' ? 'bg-slate-900 text-white' : 'text-slate-600')}
            >
              卡片
            </button>
          </div>
          <button type="button" onClick={() => void load()} className={btnClass({ variant: 'outline' })}>
            重新整理
          </button>
        </CardContent>
      </Card>

      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {canManage && (
        <Card>
          <CardHeader>
            <CardTitle>加入可售商品</CardTitle>
            <CardDescription>從 `/api/pos/catalog-options` 選取未掛靠的貨品尺碼加入 POS。</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className={fieldClass('min-w-[260px] flex-1')}
            >
              <option value="">選擇貨品×尺碼</option>
              {options.map((o) => (
                <option key={`${o.transferProductId}__${o.size}`} value={`${o.transferProductId}__${o.size}`}>
                  {o.name}｜{o.size}｜{o.transferProductId}
                </option>
              ))}
            </select>
            <input
              value={sku}
              onChange={(e) => setSku(e.target.value)}
              placeholder="SKU"
              className={fieldClass('w-40')}
            />
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="售價"
              className={fieldClass('w-32')}
            />
            <button type="button" onClick={() => void addSellable()} className={btnClass({ variant: 'primary' })}>
              加入
            </button>
          </CardContent>
        </Card>
      )}

      {viewMode === 'table' ? (
        <Card className="overflow-hidden">
          <CardHeader>
            <CardTitle>商品群組列表</CardTitle>
            <CardDescription>共 {filteredGroups.length} 個群組</CardDescription>
          </CardHeader>
          <div className="overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead className="bg-slate-50 text-slate-500">
                <tr>
                  <th className="px-4 py-3 font-medium">貨品</th>
                  <th className="px-4 py-3 font-medium">分類</th>
                  <th className="px-4 py-3 font-medium">調動貨號</th>
                  <th className="px-4 py-3 font-medium text-right">尺碼數</th>
                  <th className="px-4 py-3 font-medium text-right">總庫存</th>
                  <th className="px-4 py-3 font-medium">狀態</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filteredGroups.map((group) => (
                  <Fragment key={group.id}>
                    <tr
                      onClick={() => setExpanded((prev) => ({ ...prev, [group.id]: !prev[group.id] }))}
                      className="cursor-pointer hover:bg-slate-50"
                    >
                      <td className="px-4 py-3">
                        <div className="font-medium text-slate-900">{group.name}</div>
                        <div className="mt-1 text-xs text-slate-400">{group.color || '—'}</div>
                      </td>
                      <td className="px-4 py-3">{group.category}</td>
                      <td className="px-4 py-3 font-mono text-xs text-slate-500">{group.transferProductId || '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{group.items.length}</td>
                      <td className="px-4 py-3 text-right tabular-nums">{group.totalStock}</td>
                      <td className="px-4 py-3">
                        <Badge tone={group.activeCount === group.items.length ? 'emerald' : group.activeCount === 0 ? 'red' : 'amber'}>
                          {group.activeCount === group.items.length ? '全部上架' : group.activeCount === 0 ? '全部停用' : '部分上架'}
                        </Badge>
                      </td>
                    </tr>
                    {expanded[group.id] && (
                      <tr className="bg-slate-50/70">
                        <td colSpan={6} className="px-4 py-4">
                          <div className="space-y-3">
                            {group.items.map((item) => (
                              <div key={item.id} className="rounded-2xl border border-slate-200 bg-white p-4">
                                <div className="grid gap-3 xl:grid-cols-[120px_180px_repeat(4,110px)_220px_auto]">
                                  <div>
                                    <div className="text-xs text-slate-500">尺碼</div>
                                    <div className="mt-1 font-medium">{item.size}</div>
                                  </div>
                                  <div>
                                    <div className="text-xs text-slate-500">SKU</div>
                                    <div className="mt-1 font-mono text-xs">{item.sku}</div>
                                  </div>
                                  {STORE_ORDER.map((store) => (
                                    <div key={store}>
                                      <div className="text-xs text-slate-500">{store}</div>
                                      <div className="mt-1 tabular-nums">{Number(item.stock?.[store]) || 0}</div>
                                    </div>
                                  ))}
                                  <div>
                                    <div className="text-xs text-slate-500">售價</div>
                                    <div className="mt-1 flex items-center gap-2">
                                      <input
                                        type="number"
                                        step="0.01"
                                        value={draftPrice[item.id] ?? String(item.price ?? '')}
                                        onChange={(e) => setDraftPrice((prev) => ({ ...prev, [item.id]: e.target.value }))}
                                        className={fieldClass('h-9')}
                                      />
                                      <button
                                        type="button"
                                        onClick={() => void updateProduct(item, { price: Number(draftPrice[item.id] ?? item.price ?? 0) })}
                                        className={btnClass({ variant: 'outline', size: 'sm' })}
                                      >
                                        儲存
                                      </button>
                                    </div>
                                  </div>
                                  <div className="flex items-end justify-end gap-2">
                                    <Badge tone={item.active === false ? 'red' : 'emerald'}>{item.active === false ? '停用' : '上架'}</Badge>
                                    {canManage && (
                                      <button
                                        type="button"
                                        onClick={() => void updateProduct(item, { active: item.active === false })}
                                        className={btnClass({ variant: item.active === false ? 'success' : 'danger', size: 'sm' })}
                                      >
                                        {item.active === false ? '重新上架' : '停用'}
                                      </button>
                                    )}
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
                {!filteredGroups.length && !loading && (
                  <tr>
                    <td colSpan={6} className="px-4 py-12 text-center text-slate-500">
                      沒有符合條件的商品
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {filteredGroups.map((group) => (
            <Card key={group.id}>
              <CardHeader>
                <CardTitle>{group.name}</CardTitle>
                <CardDescription>
                  {group.category} | {group.transferProductId || '無調動貨號'}
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                <div className="flex items-center justify-between text-sm">
                  <Badge tone={group.activeCount === group.items.length ? 'emerald' : group.activeCount === 0 ? 'red' : 'amber'}>
                    {group.items.length} 個尺碼
                  </Badge>
                  <span className="tabular-nums text-slate-500">總庫存 {group.totalStock}</span>
                </div>
                <div className="space-y-2">
                  {group.items.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-slate-200 px-3 py-3 text-sm">
                      <div className="flex items-center justify-between">
                        <span className="font-medium">{item.size}</span>
                        <span className="font-semibold tabular-nums">{formatHKD(Number(item.price) || 0)}</span>
                      </div>
                      <div className="mt-1 font-mono text-xs text-slate-400">{item.sku}</div>
                      <div className="mt-2 grid grid-cols-4 gap-2 text-xs text-slate-500">
                        {STORE_ORDER.map((store) => (
                          <div key={store} className="rounded-lg bg-slate-50 px-2 py-2 text-center">
                            <div>{store}</div>
                            <div className="mt-1 font-semibold text-slate-700 tabular-nums">{Number(item.stock?.[store]) || 0}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
