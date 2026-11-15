/**
 * Phase 0 provisioner contract (prompt11 §1/§4).
 *
 * One test harness, two provisioning adapters. The adapter supplies a
 * verified database connection plus a teardown strategy; the suites never
 * learn which adapter ran. Lifecycle boundary:
 *
 *   provision → verify → prepare → execute → reconcile → persist → teardown
 *
 * Only `up`/`verifyRuntime`/`down` differ per adapter. Everything between
 * (preflight, setup, suites, worker, reconcile, summary) is shared.
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export type ProvisionerName = 'testcontainers' | 'native';

/** Explicit default: CI runs Testcontainers; native is always opt-in. */
export const DEFAULT_PROVISIONER: ProvisionerName = 'testcontainers';

export const PROVISIONER_ENV_VAR = 'PHASE0_PROVISIONER';

/**
 * Parse the provisioner selection (pure; unit-tested). Unset/blank means
 * the explicit default. Anything else unknown fails closed — the harness
 * must never silently switch provisioners when one fails.
 */
export function parseProvisioner(raw: string | undefined): ProvisionerName {
  const value = (raw ?? '').trim().toLowerCase();
  if (value === '' || value === 'testcontainers') return 'testcontainers';
  if (value === 'native') return 'native';
  throw new Error(
    `refusing to run: ${PROVISIONER_ENV_VAR}="${raw}" is not a known provisioner ` +
      `(want "testcontainers" or "native")`,
  );
}

export const EXIT_PASS = 0;
export const EXIT_TEST_FAIL = 1;
export const EXIT_INFRA_FAIL = 2;
export const EXIT_CLEANUP_FAIL = 3;

/** Unit files the `run` command executes before provisioning (single list). */
export const UNIT_TEST_FILES = [
  'phase0/db-guard.test.ts',
  'phase0/p1/outcome.test.ts',
  'phase0/test-env.test.ts',
  'phase0/baseline-gate.test.ts',
  'phase0/container-identity.test.ts',
  'phase0/provisioners/provisioners.test.ts',
];

/** What `up` established. Persisted to the state file for `down`. */
export interface Provisioned {
  provisioner: ProvisionerName;
  /** Execution identity: the PHASE0_RUN_ID active at `up` time. Reruns get
   *  derived run ids recorded alongside; teardown owns the whole execution. */
  executionId: string;
  runIds: string[];
  database: string;
  startedAt: string;
}

export interface DownReport {
  provisioner: ProvisionerName;
  cleaned: string[];
  retained: Array<{ item: string; reason: string }>;
}

export interface RuntimeEvidence {
  provisioner: ProvisionerName;
  runtimeUser: string;
  serverVersion: string;
  serverAddress: string;
  serverPort: number;
  scram: {
    passwordEncryption: string;
    hbaRule: string;
    verifierFormat: 'scram-sha-256' | 'container-managed';
    passwordLogin: boolean;
  };
}

export interface Provisioner {
  readonly name: ProvisionerName;
  /** Provision + verify. Sets PHASE0_DATABASE_URL (+ adapter env) or throws. */
  up(): Promise<Provisioned>;
  /**
   * Mode-specific runtime checks AFTER setup derived the runtime URL.
   * Shared caller asserts the runtime user is the restricted role; each
   * adapter adds its own evidence (native: demonstrated SCRAM).
   */
  verifyRuntime(rtUrl: string): Promise<RuntimeEvidence>;
  /** Teardown per the ownership rules. Never throws past a best-effort
   *  report: cleanup failures are reported, not hidden. */
  down(state: Provisioned): Promise<DownReport>;
}

export function stateFilePath(): string {
  return join(tmpdir(), 'phase0-test-env.json');
}

export function newRunId(): string {
  return (
    process.env.PHASE0_RUN_ID ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`
  );
}

export function readProvisionedState(): Provisioned | null {
  const path = stateFilePath();
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as Partial<Provisioned>;
    if (raw.provisioner !== 'testcontainers' && raw.provisioner !== 'native') return null;
    if (typeof raw.executionId !== 'string' || !Array.isArray(raw.runIds)) return null;
    return raw as Provisioned;
  } catch {
    return null;
  }
}

export function writeProvisionedState(state: Provisioned): void {
  writeFileSync(stateFilePath(), JSON.stringify(state, null, 2), { mode: 0o600 });
}

/** Record a derived run id (rerun) so teardown owns the whole execution. */
export function recordRunId(runId: string): void {
  const state = readProvisionedState();
  if (!state || state.runIds.includes(runId)) return;
  state.runIds.push(runId);
  writeProvisionedState(state);
}
