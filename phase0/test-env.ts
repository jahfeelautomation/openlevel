/**
 * Phase 0 test environment lifecycle owner (sole orchestrator).
 *
 * Usage:
 *   node --import tsx phase0/test-env.ts run [--no-unit] [--keep-db]
 *   node --import tsx phase0/test-env.ts up      # start container, print env exports
 *   node --import tsx phase0/test-env.ts down    # stop container from state file
 *
 * Exit codes: 0 pass; 1 test/proof failure; 2 setup/infra failure (nothing
 * proven); 3 cleanup failure after an otherwise green run. Cleanup failures
 * never masquerade as test results and vice versa.
 *
 * Pinned image (Adjustment 4 — captured 2026-11-15 from Docker Hub API):
 * postgres:16.16 manifest list
 * sha256:30551eca978d79ccf49d037bc297b5670baea61a04ceca42ff7fd3100163d3ce
 * (multi-arch; amd64+arm64 cover CI runners and Apple Silicon.)
 *
 * Requires Docker. Without it, exit 2 with instructions (the manual
 * runbook remains the Docker-less fallback diagnostic path).
 */
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { assertDisposableUrl, redactUrl } from './db-guard.js';

export const PG_IMAGE = 'postgres@sha256:30551eca978d79ccf49d037bc297b5670baea61a04ceca42ff7fd3100163d3ce';
export const PG_IMAGE_TAG = 'postgres:16.16'; // human label for the pinned digest above
export const SCRAM_REQUIRED = 'scram-sha-256';

export const EXIT_PASS = 0;
export const EXIT_TEST_FAIL = 1;
export const EXIT_INFRA_FAIL = 2;
export const EXIT_CLEANUP_FAIL = 3;

export function stateFilePath(): string {
  return join(tmpdir(), 'phase0-test-env.json');
}

/** Derive the restricted runtime URL from the bootstrap URL (M-03). Pure and unit-tested. */
export function deriveRuntimeUrl(bootstrapUrl: string, rtPassword: string): string {
  const u = new URL(bootstrapUrl);
  u.username = 'phase0_rt';
  u.password = rtPassword;
  return u.toString();
}

export interface EnvState {
  containerId: string;
  containerName: string;
  host: string;
  port: number;
  database: string;
  bootstrapUser: string;
  image: string;
  runId: string;
  startedAt: string;
}

/** Build a postgres URL without ever logging the password beside it. */
export function buildUrl(opts: { user: string; password: string; host: string; port: number; database: string }): string {
  const u = new URL('postgres://placeholder.invalid/');
  u.hostname = opts.host;
  u.port = String(opts.port);
  u.username = opts.user;
  u.password = opts.password;
  u.pathname = `/${opts.database}`;
  return u.toString();
}

function fail(message: string): never {
  console.error(`FATAL: ${message}`);
  process.exit(EXIT_INFRA_FAIL);
}

async function waitReady(url: string, timeoutMs: number): Promise<string> {
  const start = Date.now();
  let last: unknown = null;
  while (Date.now() - start < timeoutMs) {
    const probe = new Pool({ connectionString: url, max: 1, connectionTimeoutMillis: 5000 });
    try {
      const r = await probe.query('SELECT version() AS v');
      await probe.end().catch(() => undefined);
      return (r.rows[0] as { v: string }).v;
    } catch (err) {
      last = err;
      await probe.end().catch(() => undefined);
      await new Promise((res) => setTimeout(res, 1000));
    }
  }
  throw new Error(`postgres readiness timeout: ${String(last).slice(0, 200)}`);
}

async function assertScram(url: string): Promise<void> {
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    const r = await pool.query('SHOW password_encryption');
    const value = (r.rows[0] as { password_encryption: string }).password_encryption;
    if (value !== SCRAM_REQUIRED) throw new Error(`password_encryption is '${value}', required '${SCRAM_REQUIRED}'`);
  } finally {
    await pool.end().catch(() => undefined);
  }
}

function runId(): string {
  return process.env.PHASE0_RUN_ID ?? `run-${new Date().toISOString().replace(/[:.]/g, '-')}-${process.pid}`;
}

function spawnStreaming(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function cmdUp(): Promise<EnvState> {
  const id = runId();
  const password = randomBytes(24).toString('hex');
  const user = 'phase0_owner';
  const database = 'phase0_proofs';
  let container: StartedPostgreSqlContainer;
  try {
    container = await new PostgreSqlContainer(PG_IMAGE)
      .withDatabase(database)
      .withUsername(user)
      .withPassword(password)
      .withLabels({ 'openlevel.phase0.run': id, 'openlevel.phase0.disposable': 'true' })
      .withStartupTimeout(180_000)
      .start();
  } catch (err) {
    fail(
      `container start failed (is Docker running?): ${String(err).slice(0, 300)}. ` +
        `Without Docker, use phase0/LOCAL_POSTGRES_RUNBOOK.md instead.`,
    );
  }
  const host = container!.getHost();
  const port = container!.getMappedPort(5432);
  const url = buildUrl({ user, password, host, port, database });
  // Adjustment 3: the existing loopback-only guard judges the container URL.
  // Never weakened: a non-loopback mapping fails the run, loudly.
  assertDisposableUrl(url, 'test-env(container)');
  const version = await waitReady(url, 120_000);
  await assertScram(url);
  const state: EnvState = {
    containerId: container!.getId(),
    containerName: container!.getName(),
    host,
    port,
    database,
    bootstrapUser: user,
    image: `${PG_IMAGE_TAG} (${PG_IMAGE})`,
    runId: id,
    startedAt: new Date().toISOString(),
  };
  console.log(`container: ${state.containerName} (${state.containerId.slice(0, 12)}) host=${host} port=${port}`);
  console.log(`postgres: ${version.split(' ').slice(0, 2).join(' ')} auth=${SCRAM_REQUIRED} (verified)`);
  console.log(`url: ${redactUrl(url)}`);
  writeFileSync(stateFilePath(), JSON.stringify({ ...state, bootstrapPassword: password }, null, 2), { mode: 0o600 });
  // Stash the live container handle for in-process teardown (run mode).
  (globalThis as Record<string, unknown>).__phase0_container = container;
  process.env.PHASE0_DATABASE_URL = url;
  process.env.PHASE0_BOOT_PASSWORD = password;
  process.env.PHASE0_RT_PASSWORD = randomBytes(24).toString('hex');
  process.env.PHASE0_RUN_ID = id;
  return state;
}

export async function cmdDown(): Promise<void> {
  const live = (globalThis as Record<string, unknown>).__phase0_container as
    | StartedPostgreSqlContainer
    | undefined;
  if (live) {
    await live.stop();
    delete (globalThis as Record<string, unknown>).__phase0_container;
    console.log('container stopped (in-process handle)');
  } else if (existsSync(stateFilePath())) {
    console.log('no live handle; remove the container with: docker rm -f <id from evidence log>');
  }
  rmSync(stateFilePath(), { force: true });
  console.log('teardown complete');
}

async function cmdRun(opts: { unit: boolean; repeatSuites?: boolean; sigkillLoop?: number }): Promise<never> {
  const t0 = Date.now();
  let verdict: number = EXIT_PASS;
  try {
    if (opts.unit) {
      console.log('--- unit (no container) ---');
      const rc = await spawnStreaming('npx', ['vitest', 'run', '--config', 'phase0/vitest.phase0.config.ts', 'phase0/db-guard.test.ts', 'phase0/p1/outcome.test.ts'], process.env);
      if (rc !== 0) {
        console.log('unit suites failed; skipping integration');
        process.exit(EXIT_TEST_FAIL);
      }
    }
    const state = await cmdUp();
    mkdirSync('phase0/evidence', { recursive: true });
    const run = async (label: string, cmd: string, args: string[]): Promise<void> => {
      console.log(`--- ${label} ---`);
      const rc = await spawnStreaming(cmd, args, { ...process.env });
      if (rc !== 0) {
        console.log(`${label} FAILED (exit ${rc})`);
        verdict = EXIT_TEST_FAIL;
      }
    };
    const runSuite = async (label: string, file: string, extraArgs: string[] = []): Promise<void> => {
      const json = `phase0/evidence/suite-${label}-${state.runId}.json`;
      await run(label, 'npx', [
        'vitest', 'run', '--config', 'phase0/vitest.phase0.config.ts',
        '--reporter=default', '--reporter=json', `--outputFile=${json}`, file, ...extraArgs,
      ]);
      // Zero-execution guard (m-14): a skipped suite must fail loudly.
      const rc = await spawnStreaming('node', ['phase0/check-suite.mjs', json, label], { ...process.env });
      if (rc !== 0) verdict = EXIT_TEST_FAIL;
    };
    await run('preflight', 'node', ['--import', 'tsx', 'phase0/preflight.ts']);
    if (verdict === EXIT_PASS) await run('setup', 'node', ['--import', 'tsx', 'phase0/setup-db.ts']);
    if (verdict === EXIT_PASS) {
      // From here on, tests and workers run as phase0_rt, never bootstrap.
      const rtUrl = deriveRuntimeUrl(
        process.env.PHASE0_DATABASE_URL ?? '',
        process.env.PHASE0_RT_PASSWORD ?? '',
      );
      if (!process.env.PHASE0_RT_PASSWORD) {
        console.log('FATAL: PHASE0_RT_PASSWORD is not set');
        verdict = EXIT_INFRA_FAIL;
      } else {
        assertDisposableUrl(rtUrl, 'test-env(runtime)');
        process.env.PHASE0_RT_URL = rtUrl;
        process.env.P1_DATABASE_URL = rtUrl;
        process.env.P3_DATABASE_URL = rtUrl;
      }
    }
    if (verdict === EXIT_PASS) {
      // Shared provider journal for the whole run (P3 tests respect a preset
      // path); reconcile.mjs audits it after the suites complete.
      process.env.P3_PROVIDER_LOG = `phase0/evidence/provider-${state.runId}.jsonl`;
      rmSync(process.env.P3_PROVIDER_LOG, { force: true });
      // Worker supervision: spawn, wait for readiness, kill on teardown.
      const worker = spawn('node', ['--import', 'tsx', 'phase0/p1/worker.ts'], {
        env: { ...process.env, P1_DATABASE_URL: process.env.PHASE0_RT_URL ?? process.env.PHASE0_DATABASE_URL ?? '' },
        stdio: ['ignore', 'pipe', 'pipe'],
      });
      let ready = false;
      worker.stdout?.on('data', (d: Buffer) => {
        if (d.toString().includes('p1 worker up')) ready = true;
      });
      const deadline = Date.now() + 60_000;
      while (!ready && Date.now() < deadline) {
        if (worker.exitCode !== null) break;
        await new Promise((res) => setTimeout(res, 500));
      }
      if (!ready) {
        console.log('FATAL: p1 worker did not become ready');
        worker.kill('SIGKILL');
        verdict = EXIT_INFRA_FAIL;
      } else {
        await runSuite('P1', 'phase0/p1/p1.test.ts');
        await runSuite('backpressure', 'phase0/p1/backpressure.test.ts');
        await runSuite('P3', 'phase0/p3/p3.test.ts');
        if (opts.repeatSuites) {
          // Retained-database rerun: same container, fresh run identity, history kept.
          process.env.PHASE0_RUN_ID = `${state.runId}-rerun`;
          await runSuite('P1-rerun', 'phase0/p1/p1.test.ts');
          await runSuite('backpressure-rerun', 'phase0/p1/backpressure.test.ts');
          await runSuite('P3-rerun', 'phase0/p3/p3.test.ts');
        }
        const loops = opts.sigkillLoop ?? 0;
        for (let i = 1; i <= loops; i++) {
          await runSuite(`sigkill-${i}-of-${loops}`, 'phase0/p3/p3.test.ts', ['-t', 'SIGKILL']);
        }
        worker.kill('SIGTERM');
        await new Promise((resolve) => {
          const t = setTimeout(() => {
            worker.kill('SIGKILL');
            resolve(undefined);
          }, 10_000);
          worker.on('close', () => {
            clearTimeout(t);
            resolve(undefined);
          });
        });
      }
    }
    const reconJson = `phase0/evidence/reconciliation-${state.runId}.json`;
    const summaryMd = `phase0/evidence/summary-${state.runId}.md`;
    if (verdict === EXIT_PASS) {
      await run('reconcile', 'node', ['phase0/reconcile.mjs', reconJson]);
    }
    await run('summary', 'node', [
      'phase0/summary.mjs', 'phase0/evidence', state.runId, summaryMd,
    ]);
    console.log(`run id: ${state.runId} container: ${state.containerName} elapsed_s=${Math.round((Date.now() - t0) / 1000)}`);
  } catch (err) {
    console.log(`FATAL: ${redactUrl(String((err as Error)?.message ?? err)).slice(0, 500)}`);
    verdict = EXIT_INFRA_FAIL;
  } finally {
    if (process.env.PHASE0_KEEP_DB === '1') {
      console.log('PHASE0_KEEP_DB=1: container retained for debugging (state file keeps the id; password shown once at startup only)');
    } else {
      try {
        await cmdDown();
      } catch (err) {
        console.log(`cleanup FAILED: ${String((err as Error)?.message ?? err).slice(0, 200)}`);
        if (verdict === EXIT_PASS) verdict = EXIT_CLEANUP_FAIL;
      }
    }
  }
  process.exit(verdict);
}

// CLI entrypoint: runs ONLY when executed directly, never on import
// (unit tests import the pure helpers from this module).
import { pathToFileURL } from 'node:url';

const invokedAsScript = process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invokedAsScript) {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === 'up') {
    await cmdUp();
    process.exit(0);
  } else if (cmd === 'down') {
    await cmdDown();
    process.exit(0);
  } else if (cmd === 'run') {
    const loopArg = rest.find((a) => a.startsWith('--sigkill-loop'));
    const loopCount = loopArg?.includes('=') ? Number(loopArg.split('=')[1]) : loopArg ? 20 : 0;
    await cmdRun({
      unit: !rest.includes('--no-unit'),
      repeatSuites: rest.includes('--repeat-suites'),
      sigkillLoop: Number.isInteger(loopCount) && loopCount > 0 ? loopCount : 0,
    });
  } else {
    console.error('usage: test-env.ts (up|down|run [--no-unit])');
    process.exit(2);
  }
}
