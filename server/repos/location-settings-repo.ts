import type { Database } from '../db/database'
import { type AgentConfig, readAgentConfig } from '../lib/agent-config'

/** The reply mode lives at the settings root (so handleAgentReply reads it with
 *  one field access); the rest of the agent config lives under settings.agent. */
export type ReplyMode = 'approve-first' | 'autonomous'

export interface AgentSettingsView {
  replyMode: ReplyMode
  agent: AgentConfig
}

/** The fields the AI Agent settings page can change. All optional — a PATCH
 *  touches only what it sends. */
export interface AgentSettingsPatch {
  replyMode?: ReplyMode
  enabled?: boolean
  persona?: string
  instructions?: string
  facts?: string[]
}

function view(settings: Record<string, unknown> | null | undefined): AgentSettingsView {
  const s = settings ?? {}
  const replyMode: ReplyMode = (s as { replyMode?: unknown }).replyMode === 'autonomous' ? 'autonomous' : 'approve-first'
  return { replyMode, agent: readAgentConfig(s) }
}

/** Which processor this location connected (Module 48). 'none' = pay-by-link off. */
export type PaymentsProviderChoice = 'stripe' | 'square' | 'none'

export interface PaymentsSettingsView {
  provider: PaymentsProviderChoice
  /** Square's own location id (their concept) — only meaningful for Square. */
  squareLocationId: string | null
}

export interface PaymentsSettingsPatch {
  provider?: PaymentsProviderChoice
  squareLocationId?: string | null
}

function paymentsView(settings: Record<string, unknown> | null | undefined): PaymentsSettingsView {
  const p = ((settings ?? {}) as { payments?: { provider?: unknown; squareLocationId?: unknown } }).payments ?? {}
  const provider: PaymentsProviderChoice =
    p.provider === 'stripe' || p.provider === 'square' ? p.provider : 'none'
  return {
    provider,
    squareLocationId: typeof p.squareLocationId === 'string' && p.squareLocationId ? p.squareLocationId : null,
  }
}

/** Which outbound providers this location connected (Module 49). */
export type EmailProviderChoice = 'brevo' | 'none'
export type SmsProviderChoice = 'twilio' | 'none'

export interface SendingSettingsView {
  emailProvider: EmailProviderChoice
  fromEmail: string | null
  fromName: string | null
  smsProvider: SmsProviderChoice
  smsFrom: string | null
}

export interface SendingSettingsPatch {
  emailProvider?: EmailProviderChoice
  fromEmail?: string | null
  fromName?: string | null
  smsProvider?: SmsProviderChoice
  smsFrom?: string | null
}

/** The social channel ids this location publishes as (Module 50) plus the
 *  Google Business Profile ids review sync reads from (Module 51). Only the
 *  NON-secret ids — the page/access tokens live in the vault (D-36). */
export interface SocialSettingsView {
  facebookPageId: string | null
  instagramUserId: string | null
  linkedinAuthorUrn: string | null
  googleAccountId: string | null
  googleLocationId: string | null
}

export interface SocialSettingsPatch {
  facebookPageId?: string | null
  instagramUserId?: string | null
  linkedinAuthorUrn?: string | null
  googleAccountId?: string | null
  googleLocationId?: string | null
}

function socialView(settings: Record<string, unknown> | null | undefined): SocialSettingsView {
  const s =
    ((settings ?? {}) as {
      social?: {
        facebookPageId?: unknown
        instagramUserId?: unknown
        linkedinAuthorUrn?: unknown
        googleAccountId?: unknown
        googleLocationId?: unknown
      }
    }).social ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    facebookPageId: str(s.facebookPageId),
    instagramUserId: str(s.instagramUserId),
    linkedinAuthorUrn: str(s.linkedinAuthorUrn),
    googleAccountId: str(s.googleAccountId),
    googleLocationId: str(s.googleLocationId),
  }
}

/** Which voice provider this location connected (Module 52) plus the
 *  NON-secret numbers/ids — the Twilio/Vapi KEYS live in the vault (D-36). */
export type VoiceProviderChoice = 'twilio' | 'vapi' | 'none'

export interface VoiceSettingsView {
  provider: VoiceProviderChoice
  fromNumber: string | null
  operatorNumber: string | null
  vapiAssistantId: string | null
  vapiPhoneNumberId: string | null
}

export interface VoiceSettingsPatch {
  provider?: VoiceProviderChoice
  fromNumber?: string | null
  operatorNumber?: string | null
  vapiAssistantId?: string | null
  vapiPhoneNumberId?: string | null
}

function voiceView(settings: Record<string, unknown> | null | undefined): VoiceSettingsView {
  const s =
    ((settings ?? {}) as {
      voice?: {
        provider?: unknown
        fromNumber?: unknown
        operatorNumber?: unknown
        vapiAssistantId?: unknown
        vapiPhoneNumberId?: unknown
      }
    }).voice ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    provider: s.provider === 'twilio' || s.provider === 'vapi' ? s.provider : 'none',
    fromNumber: str(s.fromNumber),
    operatorNumber: str(s.operatorNumber),
    vapiAssistantId: str(s.vapiAssistantId),
    vapiPhoneNumberId: str(s.vapiPhoneNumberId),
  }
}

function sendingView(settings: Record<string, unknown> | null | undefined): SendingSettingsView {
  const s =
    ((settings ?? {}) as {
      sending?: { emailProvider?: unknown; fromEmail?: unknown; fromName?: unknown; smsProvider?: unknown; smsFrom?: unknown }
    }).sending ?? {}
  const str = (v: unknown) => (typeof v === 'string' && v ? v : null)
  return {
    emailProvider: s.emailProvider === 'brevo' ? 'brevo' : 'none',
    fromEmail: str(s.fromEmail),
    fromName: str(s.fromName),
    smsProvider: s.smsProvider === 'twilio' ? 'twilio' : 'none',
    smsFrom: str(s.smsFrom),
  }
}

/**
 * Read and update one location's AI-agent settings.
 *
 * A location IS the tenant root, so this repo takes the locationId and acts on
 * that single row by id — the constructor refuses an empty id so a settings write
 * can never land on "some" location. The update is a single atomic statement: it
 * merges the reply-mode change at the settings root and deep-merges the agent
 * fields under `{agent}`, preserving any agent keys the patch did not touch. There
 * is no read-modify-write window, so two operators editing at once cannot clobber
 * each other's untouched fields.
 */
export class LocationSettingsRepo {
  constructor(
    private readonly db: Database,
    private readonly locationId: string,
  ) {
    if (!locationId) throw new Error('LocationSettingsRepo requires a locationId')
  }

  async getAgentSettings(): Promise<AgentSettingsView> {
    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM locations WHERE id = $1',
      [this.locationId],
    )
    return view(rows[0]?.settings)
  }

  async updateAgentSettings(patch: AgentSettingsPatch): Promise<AgentSettingsView> {
    const rootPatch: Record<string, unknown> = {}
    if (patch.replyMode) rootPatch.replyMode = patch.replyMode

    const agentPatch: Record<string, unknown> = {}
    if (typeof patch.enabled === 'boolean') agentPatch.enabled = patch.enabled
    if (patch.persona !== undefined) agentPatch.persona = patch.persona
    if (patch.instructions !== undefined) agentPatch.instructions = patch.instructions
    if (patch.facts !== undefined) agentPatch.facts = patch.facts

    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      `UPDATE locations
         SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb) || $2::jsonb,
           '{agent}',
           COALESCE(settings -> 'agent', '{}'::jsonb) || $3::jsonb,
           true
         )
       WHERE id = $1
       RETURNING settings`,
      [this.locationId, JSON.stringify(rootPatch), JSON.stringify(agentPatch)],
    )
    return view(rows[0]?.settings)
  }

  async getPaymentsSettings(): Promise<PaymentsSettingsView> {
    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM locations WHERE id = $1',
      [this.locationId],
    )
    return paymentsView(rows[0]?.settings)
  }

  /** Same atomic single-statement merge as the agent settings, under `{payments}`.
   *  Only the choice + Square location id live here — the processor KEYS never
   *  touch the database; they stay in the vault and resolve by name (D-36). */
  async updatePaymentsSettings(patch: PaymentsSettingsPatch): Promise<PaymentsSettingsView> {
    const paymentsPatch: Record<string, unknown> = {}
    if (patch.provider) paymentsPatch.provider = patch.provider
    if (patch.squareLocationId !== undefined) paymentsPatch.squareLocationId = patch.squareLocationId

    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      `UPDATE locations
         SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{payments}',
           COALESCE(settings -> 'payments', '{}'::jsonb) || $2::jsonb,
           true
         )
       WHERE id = $1
       RETURNING settings`,
      [this.locationId, JSON.stringify(paymentsPatch)],
    )
    return paymentsView(rows[0]?.settings)
  }

  async getSendingSettings(): Promise<SendingSettingsView> {
    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM locations WHERE id = $1',
      [this.locationId],
    )
    return sendingView(rows[0]?.settings)
  }

  /** Same atomic single-statement merge, under `{sending}`. Provider choice +
   *  sender identity only — the Brevo/Twilio KEYS never touch the database;
   *  they stay in the vault and resolve by name (D-36). */
  async updateSendingSettings(patch: SendingSettingsPatch): Promise<SendingSettingsView> {
    const sendingPatch: Record<string, unknown> = {}
    if (patch.emailProvider) sendingPatch.emailProvider = patch.emailProvider
    if (patch.fromEmail !== undefined) sendingPatch.fromEmail = patch.fromEmail
    if (patch.fromName !== undefined) sendingPatch.fromName = patch.fromName
    if (patch.smsProvider) sendingPatch.smsProvider = patch.smsProvider
    if (patch.smsFrom !== undefined) sendingPatch.smsFrom = patch.smsFrom

    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      `UPDATE locations
         SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{sending}',
           COALESCE(settings -> 'sending', '{}'::jsonb) || $2::jsonb,
           true
         )
       WHERE id = $1
       RETURNING settings`,
      [this.locationId, JSON.stringify(sendingPatch)],
    )
    return sendingView(rows[0]?.settings)
  }

  async getSocialSettings(): Promise<SocialSettingsView> {
    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM locations WHERE id = $1',
      [this.locationId],
    )
    return socialView(rows[0]?.settings)
  }

  /** Same atomic single-statement merge, under `{social}`. Channel ids only —
   *  the page/access TOKENS never touch the database; they stay in the vault
   *  and resolve by name (D-36). */
  async updateSocialSettings(patch: SocialSettingsPatch): Promise<SocialSettingsView> {
    const socialPatch: Record<string, unknown> = {}
    if (patch.facebookPageId !== undefined) socialPatch.facebookPageId = patch.facebookPageId
    if (patch.instagramUserId !== undefined) socialPatch.instagramUserId = patch.instagramUserId
    if (patch.linkedinAuthorUrn !== undefined) socialPatch.linkedinAuthorUrn = patch.linkedinAuthorUrn
    if (patch.googleAccountId !== undefined) socialPatch.googleAccountId = patch.googleAccountId
    if (patch.googleLocationId !== undefined) socialPatch.googleLocationId = patch.googleLocationId

    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      `UPDATE locations
         SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{social}',
           COALESCE(settings -> 'social', '{}'::jsonb) || $2::jsonb,
           true
         )
       WHERE id = $1
       RETURNING settings`,
      [this.locationId, JSON.stringify(socialPatch)],
    )
    return socialView(rows[0]?.settings)
  }

  async getVoiceSettings(): Promise<VoiceSettingsView> {
    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      'SELECT settings FROM locations WHERE id = $1',
      [this.locationId],
    )
    return voiceView(rows[0]?.settings)
  }

  /** Same atomic single-statement merge, under `{voice}`. Provider choice +
   *  numbers/ids only — the Twilio/Vapi KEYS never touch the database; they
   *  stay in the vault and resolve by name (D-36). */
  async updateVoiceSettings(patch: VoiceSettingsPatch): Promise<VoiceSettingsView> {
    const voicePatch: Record<string, unknown> = {}
    if (patch.provider) voicePatch.provider = patch.provider
    if (patch.fromNumber !== undefined) voicePatch.fromNumber = patch.fromNumber
    if (patch.operatorNumber !== undefined) voicePatch.operatorNumber = patch.operatorNumber
    if (patch.vapiAssistantId !== undefined) voicePatch.vapiAssistantId = patch.vapiAssistantId
    if (patch.vapiPhoneNumberId !== undefined) voicePatch.vapiPhoneNumberId = patch.vapiPhoneNumberId

    const rows = await this.db.query<{ settings: Record<string, unknown> | null }>(
      `UPDATE locations
         SET settings = jsonb_set(
           COALESCE(settings, '{}'::jsonb),
           '{voice}',
           COALESCE(settings -> 'voice', '{}'::jsonb) || $2::jsonb,
           true
         )
       WHERE id = $1
       RETURNING settings`,
      [this.locationId, JSON.stringify(voicePatch)],
    )
    return voiceView(rows[0]?.settings)
  }
}
