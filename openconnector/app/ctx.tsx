import { useContext, createContext, type PropsWithChildren, useState, useEffect } from 'react'
import { api, getToken } from '../lib/api'
import { registerForPushNotificationsAsync } from '../lib/push'

interface AuthContextType {
  signIn: (email: string, password: string) => Promise<void>
  signOut: () => void
  session: string | null
  isLoading: boolean
  operator: any | null
  location: any | null
}

const AuthContext = createContext<AuthContextType>({
  signIn: async () => {},
  signOut: () => null,
  session: null,
  isLoading: true,
  operator: null,
  location: null,
})

export function useSession() {
  const value = useContext(AuthContext)
  if (process.env.NODE_ENV !== 'production') {
    if (!value) {
      throw new Error('useSession must be wrapped in a <SessionProvider />')
    }
  }
  return value
}

export function SessionProvider({ children }: PropsWithChildren) {
  const [session, setSession] = useState<string | null>(null)
  const [operator, setOperator] = useState<any | null>(null)
  const [location, setLocation] = useState<any | null>(null)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    async function loadSession() {
      try {
        const token = await getToken()
        if (token) {
          const [meRes, locRes] = await Promise.all([
            api.getMe(),
            api.getLocations()
          ])
          setSession(token)
          setOperator(meRes.operator)
          if (locRes.locations?.length > 0) {
            setLocation(locRes.locations[0])
          }
          try {
            const pushToken = await registerForPushNotificationsAsync()
            if (pushToken) await api.registerPushToken(pushToken)
          } catch (e) {
            console.warn('Push registration failed', e)
          }
        }
      } catch (e) {
        // Token invalid or network error
      } finally {
        setIsLoading(false)
      }
    }
    loadSession()
  }, [])

  return (
    <AuthContext.Provider
      value={{
        signIn: async (email, password) => {
          const data = await api.login(email, password)
          setSession(data.token)
          setOperator(data.operator)
          const locRes = await api.getLocations()
          if (locRes.locations?.length > 0) {
            setLocation(locRes.locations[0])
          }
          try {
            const pushToken = await registerForPushNotificationsAsync()
            if (pushToken) await api.registerPushToken(pushToken)
          } catch (e) {
            console.warn('Push registration failed', e)
          }
        },
        signOut: () => {
          setSession(null)
          setOperator(null)
          setLocation(null)
          api.logout().catch(() => {})
        },
        session,
        isLoading,
        operator,
        location,
      }}
    >
      {children}
    </AuthContext.Provider>
  )
}

