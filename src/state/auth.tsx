import { createContext, type ReactNode, useCallback, useContext, useEffect, useState } from 'react'
import { api, type Operator } from '../lib/api'

type Status = 'loading' | 'authed' | 'anon'

interface AuthValue {
  status: Status
  operator: Operator | null
  login: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthValue | null>(null)

/** Resolves the current operator from the session cookie on mount, and exposes
 *  login/logout. `status` drives the route guard (loading → anon → authed). */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<Status>('loading')
  const [operator, setOperator] = useState<Operator | null>(null)

  useEffect(() => {
    let active = true
    api
      .me()
      .then((r) => {
        if (!active) return
        setOperator(r.operator)
        setStatus('authed')
      })
      .catch(() => {
        if (!active) return
        setOperator(null)
        setStatus('anon')
      })
    return () => {
      active = false
    }
  }, [])

  const login = useCallback(async (email: string, password: string) => {
    const r = await api.login(email, password)
    setOperator(r.operator)
    setStatus('authed')
  }, [])

  const logout = useCallback(async () => {
    await api.logout().catch(() => {})
    setOperator(null)
    setStatus('anon')
  }, [])

  return <AuthContext.Provider value={{ status, operator, login, logout }}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
