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
const FALLBACK_STORES = ['觀塘', '荔枝角', '灣仔', '屯門', '屯門中轉倉', '觀塘中轉倉', '國內倉(秋冬)', '國內倉(春夏)']

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

  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return
      const next = String(e.newValue || '').trim()
      if (next) setStoreState(next)
    }
    function onMessage(e: MessageEvent) {
      const data = e.data as { type?: string; store?: string } | null
      if (!data || data.type !== 'store-web-set-store') return
      const next = String(data.store || '').trim()
      if (next) {
        setStoreState(next)
        writeStoredStore(next)
      }
    }
    window.addEventListener('storage', onStorage)
    window.addEventListener('message', onMessage)
    return () => {
      window.removeEventListener('storage', onStorage)
      window.removeEventListener('message', onMessage)
    }
  }, [])

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
