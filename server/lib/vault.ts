/**
 * Resolve a secret by name.
 *
 * Slice 1: reads from process.env, mapping a vault item name like
 * "Alex:chatwoot:api_token" to the env key Alex_CHATWOOT_API_TOKEN.
 *
 * Later (D-36): this swaps for the Vaultwarden machine API. The agent never
 * sees a raw secret — this layer fetches the value and hands it only to the
 * outbound caller (e.g. the Chatwoot client), then the agent gets a
 * confirmation, not the credential.
 */
export function resolveSecret(name: string): string | undefined {
  const envKey = name.toUpperCase().replace(/[^A-Z0-9]+/g, '_')
  return process.env[envKey]
}

