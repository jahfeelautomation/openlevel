/**
 * Password hashing via argon2id (prebuilt @node-rs/argon2 — no native toolchain).
 * verify never throws: a malformed/empty stored hash returns false so callers
 * treat it as an auth failure rather than a 500.
 */
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'

export function hashPassword(plain: string): Promise<string> {
  return argonHash(plain)
}

export async function verifyPassword(storedHash: string, plain: string): Promise<boolean> {
  try {
    return await argonVerify(storedHash, plain)
  } catch {
    return false
  }
}
