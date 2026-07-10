import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import { api, type Location } from '../lib/api'
import { useAuth } from './auth'

interface TenantValue {
  status: 'loading' | 'ready' | 'empty'
  locations: Location[]
  current: Location | null
  setCurrentId: (id: string) => void
}

const TenantContext = createContext<TenantValue | null>(null)
const STORAGE_KEY = 'ol.locationId'

/** Loads the locations the operator can access once authed, and tracks the
 *  selected one (persisted to localStorage). "location" == GHL sub-account ==
 *  one SIAS client. Tenancy entry point for every loc-scoped page. */
export function TenantProvider({ children }: { children: ReactNode }) {
  const { status: authStatus } = useAuth()
  const [locations, setLocations] = useState<Location[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'empty'>('loading')
  const [currentId, setCurrentIdState] = useState<string | null>(() => localStorage.getItem(STORAGE_KEY))

  useEffect(() => {
    if (authStatus !== 'authed') return
    let active = true
    setStatus('loading')
    api
      .locations()
      .then((r) => {
        if (!active) return
        setLocations(r.locations)
        setStatus(r.locations.length > 0 ? 'ready' : 'empty')
      })
      .catch(() => {
        if (active) setStatus('empty')
      })
    return () => {
      active = false
    }
  }, [authStatus])

  const setCurrentId = (id: string) => {
    setCurrentIdState(id)
    localStorage.setItem(STORAGE_KEY, id)
  }

  const current = locations.find((l) => l.id === currentId) ?? locations[0] ?? null

  return (
    <TenantContext.Provider value={{ status, locations, current, setCurrentId }}>
      {children}
    </TenantContext.Provider>
  )
}

export function useTenant(): TenantValue {
  const ctx = useContext(TenantContext)
  if (!ctx) throw new Error('useTenant must be used within TenantProvider')
  return ctx
}
