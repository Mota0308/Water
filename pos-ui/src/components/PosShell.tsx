import type { ReactNode } from 'react'
import { usePosStore } from '@/store/PosStoreContext'

export function PosShell({ children }: { children: ReactNode }) {
  const { error } = usePosStore()

  return (
    <div className="flex h-[100dvh] min-h-[560px] flex-col bg-slate-50 text-slate-900">
      {error ? (
        <div className="shrink-0 border-b border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
          {error}
        </div>
      ) : null}
      <div className="min-h-0 flex-1 overflow-auto">{children}</div>
    </div>
  )
}
