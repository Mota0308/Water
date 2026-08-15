import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { apiJson } from '@/lib/api'
import { formatHKD } from '@/lib/format'
import type { PosProduct } from '@/lib/types'

type CatalogOpt = {
  transferProductId: string
  name: string
  category?: string
  color?: string
  size: string
  suggestedSku: string
}

export function ProductsPage() {
  const [products, setProducts] = useState<PosProduct[]>([])
  const [options, setOptions] = useState<CatalogOpt[]>([])
  const [canManage, setCanManage] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [pick, setPick] = useState('')
  const [price, setPrice] = useState('')
  const [sku, setSku] = useState('')

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
      if (!price) setPrice('')
    }
  }, [pick, options, price])

  const addSellable = async () => {
    const o = options.find((x) => `${x.transferProductId}__${x.size}` === pick)
    if (!o) {
      toast.error('請選擇貨品尺碼')
      return
    }
    try {
      await apiJson('/api/pos/sellables', {
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

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-4">
      <h1 className="text-xl font-semibold">可售商品</h1>
      {loading && <p className="text-slate-500">載入中…</p>}
      {error && <p className="text-red-600">{error}</p>}
      {canManage && (
        <div className="space-y-2 rounded-lg border border-slate-200 bg-white p-4">
          <h2 className="font-medium">加入可售（掛靠調動庫存）</h2>
          <div className="flex flex-wrap gap-2">
            <select
              value={pick}
              onChange={(e) => setPick(e.target.value)}
              className="h-10 min-w-[240px] flex-1 rounded-md border border-slate-200 px-2 text-sm"
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
              className="h-10 w-40 rounded-md border border-slate-200 px-2 text-sm"
            />
            <input
              type="number"
              step="0.01"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="售價"
              className="h-10 w-28 rounded-md border border-slate-200 px-2 text-sm"
            />
            <button
              type="button"
              onClick={() => void addSellable()}
              className="h-10 rounded-md bg-sky-600 px-3 text-sm text-white"
            >
              加入
            </button>
          </div>
        </div>
      )}
      <div className="overflow-hidden rounded-lg border border-slate-200 bg-white">
        <table className="w-full text-left text-sm">
          <thead className="bg-slate-50 text-slate-500">
            <tr>
              <th className="px-3 py-2">SKU</th>
              <th className="px-3 py-2">名稱</th>
              <th className="px-3 py-2">尺碼</th>
              <th className="px-3 py-2">售價</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {products.map((p) => (
              <tr key={p.id}>
                <td className="px-3 py-2 font-mono text-xs">{p.sku}</td>
                <td className="px-3 py-2">{p.name}</td>
                <td className="px-3 py-2">{p.size}</td>
                <td className="px-3 py-2 tabular-nums">{formatHKD(Number(p.price) || 0)}</td>
              </tr>
            ))}
            {!products.length && !loading && (
              <tr>
                <td colSpan={4} className="px-3 py-8 text-center text-slate-500">
                  尚未加入可售商品
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  )
}
