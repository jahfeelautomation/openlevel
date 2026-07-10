import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const BASE_URL =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:8790' // Android emulator loopback
    : 'http://localhost:8790'

const TOKEN_KEY = 'ol_session_token'

export async function getToken() {
  return await SecureStore.getItemAsync(TOKEN_KEY)
}

export async function setToken(token: string) {
  await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function removeToken() {
  await SecureStore.deleteItemAsync(TOKEN_KEY)
}

async function apiFetch(endpoint: string, options: RequestInit = {}) {
  const token = await getToken()
  const headers = new Headers(options.headers)

  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  if (!headers.has('Content-Type') && options.method !== 'GET') {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${BASE_URL}${endpoint}`, {
    ...options,
    headers,
  })

  if (!response.ok) {
    let errorMsg = 'An error occurred'
    try {
      const data = await response.json()
      errorMsg = data.error || errorMsg
    } catch {}
    throw new Error(errorMsg)
  }

  return response.json()
}

export const api = {
  login: async (email: string, password: string) => {
    const data = await apiFetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    })
    if (data.token) {
      await setToken(data.token)
    }
    return data
  },

  logout: async () => {
    try {
      await apiFetch('/api/auth/logout', { method: 'POST' })
    } catch (err) {}
    await removeToken()
  },

  getMe: async () => {
    return apiFetch('/api/auth/me')
  },

  getLocations: async () => {
    return apiFetch('/api/locations')
  },
  
  registerPushToken: async (token: string) => {
    return apiFetch('/api/push-tokens', {
      method: 'POST',
      body: JSON.stringify({
        token,
        platform: Platform.OS,
      }),
    })
  },

  getConversations: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/conversations`)
  },

  getConversation: async (locationId: string, conversationId: string) => {
    return apiFetch(`/api/loc/${locationId}/conversations/${conversationId}`)
  },

  sendMessage: async (locationId: string, conversationId: string, body: string) => {
    return apiFetch(`/api/loc/${locationId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  },

  getContacts: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts`)
  },

  getContact: async (locationId: string, contactId: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}`)
  },

  getCalendars: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/calendars`)
  },

  getAppointments: async (locationId: string, from?: string, to?: string) => {
    let url = `/api/loc/${locationId}/calendars/appointments`
    if (from || to) {
      const params = new URLSearchParams()
      if (from) params.append('from', from)
      if (to) params.append('to', to)
      url += `?${params.toString()}`
    }
    return apiFetch(url)
  },

  getPipelines: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/opportunities/pipelines`)
  },

  getOpportunities: async (locationId: string, pipelineId: string) => {
    return apiFetch(`/api/loc/${locationId}/opportunities?pipelineId=${pipelineId}`)
  },

  getReviews: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/reviews`)
  },
}
