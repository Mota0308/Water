import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { apiJson } from '@/lib/api'

const STORAGE_KEY = 'store-web-pos-current-store-v1'
const FALLBACK_STORES = ['觀塘', '荔枝角', '灣仔', '屯門']

type PosStoreContextValue = {
  stores: string[]
  store: string
  setStore: (store: string) => void
  loading: boolean
  error: string
  reload: () => Promise<void>
}

const PosStoreContext = createContext<PosStoreContextValue | null>(null)

function readStoredStore() {
  try {
    return String(localStorage.getItem(STORAGE_KEY) || '').trim()
  } catch {
    return ''
  }
}

function writeStoredStore(store: string) {
  try {
    if (store) localStorage.setItem(STORAGE_KEY, store)
    else localStorage.removeItem(STORAGE_KEY)
  } catch {
    /* ignore */
  }
}

export function PosStoreProvider({ children }: { children: ReactNode }) {
  const [stores, setStores] = useState<string[]>([])
  const [store, setStoreState] = useState(readStoredStore)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const setStore = useCallback((next: string) => {
    setStoreState(next)
    writeStoredStore(next)
  }, [])

  const reload = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await apiJson<{ stores?: string[] }>('/api/pos/products')
      const list = (res.stores || []).filter(Boolean)
      const nextStores = list.length ? list : FALLBACK_STORES
      setStores(nextStores)
      setStoreState((prev) => {
        const preferred = prev && nextStores.includes(prev) ? prev : readStoredStore()
        const chosen =
          preferred && nextStores.includes(preferred) ? preferred : nextStores[0] || ''
        writeStoredStore(chosen)
        return chosen
      })
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setStores((prev) => (prev.length ? prev : FALLBACK_STORES))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const value = useMemo(
    () => ({ stores, store, setStore, loading, error, reload }),
    [stores, store, setStore, loading, error, reload],
  )

  return <PosStoreContext.Provider value={value}>{children}</PosStoreContext.Provider>
}

export function usePosStore() {
  const ctx = useContext(PosStoreContext)
  if (!ctx) throw new Error('usePosStore must be used within PosStoreProvider')
  return ctx
}
