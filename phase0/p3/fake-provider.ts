/**
 * P3 fake provider (Phase 0, isolated). Simulates an Anthropic-style
 * non-idempotent model API with fault injection for crash testing.
 *
 * Modes (set per test):
 *  - ok: accept the request, record the charge, return a result.
 *  - die-before-response: record accept+charge, then kill the process
 *    (simulates provider-success-then-crash before local settlement).
 *  - timeout-unknown: record accept+charge, never respond (caller times out).
 *  - fail: reject without charge.
 *
 * The provider keeps its own durable log (a JSONL file) so tests can assert
 * "exactly one accepted charge" independently of the application database.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type FakeMode = 'ok' | 'die-before-response' | 'timeout-unknown' | 'fail';

export interface ProviderLogEntry {
  attemptId: string;
  operationId: string;
  inputTokens: number;
  outputTokens: number;
  charged: boolean;
  at: string;
}

export interface ProviderResult {
  attemptId: string;
  requestId: string;
  inputTokens: number;
  outputTokens: number;
}

const latencyMs = Number(process.env.P3_FAKE_LATENCY_MS ?? '20');

function logPath(): string {
  const p = process.env.P3_PROVIDER_LOG;
  if (!p) throw new Error('P3_PROVIDER_LOG is required');
  mkdirSync(dirname(p), { recursive: true });
  return p;
}

export function readProviderLog(): ProviderLogEntry[] {
  const p = process.env.P3_PROVIDER_LOG ?? '';
  if (!p || !existsSync(p)) return [];
  return readFileSync(p, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => JSON.parse(line) as ProviderLogEntry);
}

export function countCharges(operationId: string): number {
  return readProviderLog().filter((e) => e.operationId === operationId && e.charged).length;
}

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

/** Provider accepted (charge durable) but the response never arrived. */
export class ProviderTimeoutError extends Error {
  readonly code = 'P3_PROVIDER_TIMEOUT';
  constructor(attemptId: string) {
    super(`fake provider: timeout with uncertain outcome for ${attemptId}`);
  }
}

export async function fakeModelCall(args: {
  attemptId: string;
  operationId: string;
  inputTokens: number;
  outputTokens: number;
  mode: FakeMode;
}): Promise<ProviderResult> {
  await delay(latencyMs);
  if (args.mode === 'fail') throw new Error('fake provider: rejected request (no charge)');
  // Accept + charge FIRST (durable provider-side), then exhibit the fault.
  const entry: ProviderLogEntry = {
    attemptId: args.attemptId,
    operationId: args.operationId,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
    charged: true,
    at: new Date().toISOString(),
  };
  appendFileSync(logPath(), JSON.stringify(entry) + '\n');
  if (args.mode === 'die-before-response') process.exit(137);
  if (args.mode === 'timeout-unknown') {
    // Charge is durable; the response never arrives. Tests control the wait
    // via P3_FAKE_TIMEOUT_MS (default 60s real-hang for external-kill tests).
    await delay(Number(process.env.P3_FAKE_TIMEOUT_MS ?? '60000'));
    throw new ProviderTimeoutError(args.attemptId);
  }
  return {
    attemptId: args.attemptId,
    requestId: `p3-req-${args.attemptId}`,
    inputTokens: args.inputTokens,
    outputTokens: args.outputTokens,
  };
}
