import * as SecureStore from 'expo-secure-store'
import { Platform } from 'react-native'

const BASE_URL =
  Platform.OS === 'android'
    ? 'http://10.0.2.2:8790' // Android emulator loopback
    : 'http://localhost:8790'

const TOKEN_KEY = 'ol_session_token'

export async function getToken() {
  if (Platform.OS === 'web') return localStorage.getItem(TOKEN_KEY)
  return await SecureStore.getItemAsync(TOKEN_KEY)
}

export async function setToken(token: string) {
  if (Platform.OS === 'web') localStorage.setItem(TOKEN_KEY, token)
  else await SecureStore.setItemAsync(TOKEN_KEY, token)
}

export async function removeToken() {
  if (Platform.OS === 'web') localStorage.removeItem(TOKEN_KEY)
  else await SecureStore.deleteItemAsync(TOKEN_KEY)
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

// ---------------------------------------------------------------------------
// Utility helpers — ported from src/lib/utils.ts so the mobile app renders
// identically to the web.
// ---------------------------------------------------------------------------

/** Up-to-two-letter initials for avatar fallbacks. */
export function initials(name?: string | null): string {
  if (!name) return '?'
  const parts = name.trim().split(/\s+/).slice(0, 2)
  const joined = parts.map((p) => p[0]?.toUpperCase() ?? '').join('')
  return joined || '?'
}

/** Compact relative time ("just now", "12m", "3h", "2d", or a date). */
export function relativeTime(iso?: string | null): string {
  if (!iso) return ''
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const min = Math.round((Date.now() - then) / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.round(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.round(hr / 24)
  if (d < 30) return `${d}d`
  return new Date(iso).toLocaleDateString()
}

/** Format a phone number for display; falls back to the raw string. */
export function formatPhone(raw?: string | null): string {
  if (!raw) return ''
  const digits = raw.replace(/[^\d]/g, '')
  const ten = digits.length === 11 && digits.startsWith('1') ? digits.slice(1) : digits
  if (ten.length === 10) return `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}`
  return raw
}

/** Deterministic avatar color from a name string — same palette as the web. */
const AVATAR_COLORS = [
  '#f43f5e', // rose-500
  '#f97316', // orange-500
  '#f59e0b', // amber-500
  '#10b981', // emerald-500
  '#14b8a6', // teal-500
  '#0ea5e9', // sky-500
  '#6366f1', // brand-500 (indigo)
  '#8b5cf6', // violet-500
  '#d946ef', // fuchsia-500
]

export function avatarColor(seed: string): string {
  let h = 0
  for (let i = 0; i < seed.length; i++) h = (h * 31 + seed.charCodeAt(i)) >>> 0
  return AVATAR_COLORS[h % AVATAR_COLORS.length] ?? '#64748b'
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

  /** Thread messages for a single conversation (same endpoint as getConversation). */
  thread: async (locationId: string, conversationId: string) => {
    return apiFetch(`/api/loc/${locationId}/conversations/${conversationId}`)
  },

  sendMessage: async (locationId: string, conversationId: string, body: string) => {
    return apiFetch(`/api/loc/${locationId}/conversations/${conversationId}/messages`, {
      method: 'POST',
      body: JSON.stringify({ body }),
    })
  },

  /** AI draft — same endpoint the web's Composer.tsx calls. */
  draft: async (locationId: string, conversationId: string) => {
    return apiFetch(`/api/loc/${locationId}/conversations/${conversationId}/draft`, {
      method: 'POST',
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

  createAppointment: async (locationId: string, data: { title: string; calendar_id: string; contact_id?: string; starts_at: string; ends_at: string }) => {
    return apiFetch(`/api/loc/${locationId}/calendars/appointments`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  getPipelines: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/opportunities/pipelines`)
  },

  getOpportunities: async (locationId: string, pipelineId: string) => {
    return apiFetch(`/api/loc/${locationId}/opportunities?pipelineId=${pipelineId}`)
  },

  updateOpportunityStatus: async (locationId: string, oppId: string, status: 'won' | 'lost') => {
    return apiFetch(`/api/loc/${locationId}/opportunities/${oppId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },

  createOpportunity: async (locationId: string, data: { pipeline_id: string; name: string; stage_id: string; contact_id?: string; value_cents?: number }) => {
    return apiFetch(`/api/loc/${locationId}/opportunities`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  getReviews: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/reviews`)
  },

  requestReview: async (locationId: string, data: { contact_id: string; channel: 'sms' | 'email' }) => {
    return apiFetch(`/api/loc/${locationId}/reviews/request`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  getVoiceToken: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/calls/token`)
  },

  initiateCall: async (locationId: string, to: string) => {
    return apiFetch(`/api/loc/${locationId}/calls`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    })
  },

  createContact: async (locationId: string, data: { name?: string; phones?: string[]; emails?: string[]; source?: string }) => {
    return apiFetch(`/api/loc/${locationId}/contacts`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  updateContact: async (locationId: string, contactId: string, data: Record<string, any>) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  addContactTag: async (locationId: string, contactId: string, tag: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/tags`, {
      method: 'POST',
      body: JSON.stringify({ tag }),
    })
  },

  removeContactTag: async (locationId: string, contactId: string, tag: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/tags/${encodeURIComponent(tag)}`, {
      method: 'DELETE',
    })
  },

  getLocationTags: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/tags`)
  },

  getNotes: async (locationId: string, contactId: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/notes`)
  },

  createNote: async (locationId: string, contactId: string, body: string, author?: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/notes`, {
      method: 'POST',
      body: JSON.stringify({ body, author }),
    })
  },

  updateNote: async (locationId: string, contactId: string, noteId: string, data: Record<string, any>) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/notes/${noteId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  deleteNote: async (locationId: string, contactId: string, noteId: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/notes/${noteId}`, {
      method: 'DELETE',
    })
  },

  getTasks: async (locationId: string, contactId: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/tasks`)
  },

  createTask: async (locationId: string, contactId: string, data: { title: string; due_at?: string }) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  updateTask: async (locationId: string, contactId: string, taskId: string, data: Record<string, any>) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    })
  },

  deleteTask: async (locationId: string, contactId: string, taskId: string) => {
    return apiFetch(`/api/loc/${locationId}/contacts/${contactId}/tasks/${taskId}`, {
      method: 'DELETE',
    })
  },

  createAppointment: async (locationId: string, data: { title: string; calendar_id: string; contact_id?: string; starts_at: string; ends_at: string }) => {
    return apiFetch(`/api/loc/${locationId}/calendars/appointments`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  updateOpportunityStatus: async (locationId: string, oppId: string, status: 'won' | 'lost' | 'open') => {
    return apiFetch(`/api/loc/${locationId}/opportunities/${oppId}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    })
  },

  createOpportunity: async (locationId: string, data: { pipeline_id: string; name: string; stage_id: string; contact_id?: string; value_cents?: number }) => {
    return apiFetch(`/api/loc/${locationId}/opportunities`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  requestReview: async (locationId: string, data: { contact_id: string; channel: 'sms' | 'email' }) => {
    return apiFetch(`/api/loc/${locationId}/reviews/request`, {
      method: 'POST',
      body: JSON.stringify(data),
    })
  },

  getVoiceToken: async (locationId: string) => {
    return apiFetch(`/api/loc/${locationId}/calls/token`)
  },

  initiateCall: async (locationId: string, to: string) => {
    return apiFetch(`/api/loc/${locationId}/calls`, {
      method: 'POST',
      body: JSON.stringify({ to }),
    })
  },
}
