import type { ReactNode } from 'react'
import { Store } from 'lucide-react'
import { usePosStore } from '@/store/PosStoreContext'
import { fieldClass } from '@/components/ui'

export function PosShell({ children }: { children: ReactNode }) {
  const { stores, store, setStore, loading, error } = usePosStore()

  return (
    <div className="flex h-[100dvh] min-h-[560px] flex-col bg-slate-50 text-slate-900">
      <header className="z-30 flex shrink-0 items-center gap-3 border-b border-slate-200 bg-white/95 px-3 py-2 backdrop-blur md:px-4">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <Store className="size-4 shrink-0 text-sky-600" aria-hidden />
          <span className="hidden text-sm text-slate-500 sm:inline">現門市</span>
          <select
            value={store}
            disabled={loading || !stores.length}
            onChange={(e) => setStore(e.target.value)}
            className={fieldClass('h-9 max-w-[220px] font-medium')}
            aria-label="切換 POS 門市"
          >
            {!stores.length && <option value="">載入門市中…</option>}
            {stores.map((s) => (
              <option key={s} value={s}>
                {s}店
              </option>
            ))}
          </select>
          {error ? <span className="truncate text-xs text-amber-600">{error}</span> : null}
        </div>
        <div className="shrink-0 text-xs text-slate-400">適用於收銀／交易／日結／報表</div>
      </header>
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
