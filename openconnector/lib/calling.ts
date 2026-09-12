import { api } from './api'

// Placeholder for Twilio Voice SDK wrapper
// Requires native build to work, so we simulate it for now.

export const CallingService = {
  initialize: async (locationId: string) => {
    console.log('Initializing CallingService...')
    try {
      const token = await api.getVoiceToken(locationId)
      console.log('Got Voice Token', token)
      return true
    } catch (e) {
      console.warn('Failed to init CallingService', e)
      return false
    }
  },

  makeCall: async (locationId: string, to: string) => {
    console.log(`Starting call to ${to}...`)
    try {
      await api.initiateCall(locationId, to)
      console.log('Call initiated')
      return true
    } catch (e) {
      console.warn('Failed to make call', e)
      return false
    }
  },

  hangup: () => {
    console.log('Hanging up call')
  },
}
