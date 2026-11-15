/**
 * Phase 0 test environment lifecycle owner (sole orchestrator).
 *
 * Usage:
 *   node --import tsx phase0/test-env.ts run [--no-unit] [--repeat-suites] [--sigkill-loop[=N]]
 *   node --import tsx phase0/test-env.ts up      # provision + verify only
 *   node --import tsx phase0/test-env.ts down    # tear down from state file
 *
 * Provisioner selection (prompt11 §1):
 *   PHASE0_PROVISIONER=testcontainers  (default; CI path, Docker required)
 *   PHASE0_PROVISIONER=native          (owner-controlled local PostgreSQL;
 *     requires PHASE0_DATABASE_URL + PHASE0_RT_PASSWORD, see
 *     phase0/LOCAL_POSTGRES_RUNBOOK.md)
 * Anything else fails closed (exit 2). The harness never silently switches
 * provisioners. Both adapters execute these same suites and assertions.
 *
 * Exit codes: 0 pass; 1 test/proof failure; 2 setup/infra failure (nothing
 * proven); 3 cleanup failure after an otherwise green run. Cleanup failures
 * never masquerade as test results and vice versa.
 */
import { spawn } from 'node:child_process';
import { mkdirSync, rmSync } from 'node:fs';
import { assertDisposableUrl, redactUrl } from './db-guard.js';
import { nativeProvisioner } from './provisioners/native.js';
import { testcontainersProvisioner, PG_IMAGE } from './provisioners/testcontainers.js';
import {
  EXIT_CLEANUP_FAIL,
  EXIT_INFRA_FAIL,
  EXIT_PASS,
  EXIT_TEST_FAIL,
  PROVISIONER_ENV_VAR,
  UNIT_TEST_FILES,
  parseProvisioner,
  readProvisionedState,
  recordRunId,
  stateFilePath,
  type Provisioned,
  type Provisioner,
} from './provisioners/types.js';

// Re-exported so existing importers (unit tests) keep working.
export { PG_IMAGE, stateFilePath };
export { EXIT_CLEANUP_FAIL, EXIT_INFRA_FAIL, EXIT_PASS, EXIT_TEST_FAIL };

/** Derive the restricted runtime URL from the bootstrap URL (M-03). Pure and unit-tested. */
export function deriveRuntimeUrl(bootstrapUrl: string, rtPassword: string): string {
  const u = new URL(bootstrapUrl);
  u.username = 'phase0_rt';
  u.password = rtPassword;
  return u.toString();
}

function selectProvisioner(): Provisioner {
  const name = parseProvisioner(process.env[PROVISIONER_ENV_VAR]);
  console.log(`provisioner: ${name}`);
  return name === 'native' ? nativeProvisioner : testcontainersProvisioner;
}

function fail(message: string): never {
  console.error(`FATAL: ${message}`);
  process.exit(EXIT_INFRA_FAIL);
}

function spawnStreaming(cmd: string, args: string[], env: NodeJS.ProcessEnv): Promise<number> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => resolve(code ?? 1));
  });
}

export async function cmdUp(): Promise<Provisioned> {
  return selectProvisioner().up();
}

export async function cmdDown(): Promise<void> {
  const state = readProvisionedState();
  if (!state) {
    rmSync(stateFilePath(), { force: true });
    console.log('no provisioned state; nothing to tear down');
    return;
  }
  const provisioner = state.provisioner === 'native' ? nativeProvisioner : testcontainersProvisioner;
  const report = await provisioner.down(state);
  for (const line of report.cleaned) console.log(`cleaned: ${line}`);
  for (const r of report.retained) console.log(`retained: ${r.item} (${r.reason})`);
}

async function cmdRun(opts: { unit: boolean; repeatSuites?: boolean; sigkillLoop?: number }): Promise<never> {
  const t0 = Date.now();
  let verdict: number = EXIT_PASS;
  let provisioner: Provisioner | null = null;
  let state: Provisioned | null = null;
  try {
    if (opts.unit) {
      console.log('--- unit (no database) ---');
      const rc = await spawnStreaming(
        'npx',
        ['vitest', 'run', '--config', 'phase0/vitest.phase0.config.ts', ...UNIT_TEST_FILES],
        process.env,
      );
      if (rc !== 0) {
        console.log('unit suites failed; skipping integration');
        process.exit(EXIT_TEST_FAIL);
      }
    }
    provisioner = selectProvisioner();
    state = await provisioner.up();
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
      const json = `phase0/evidence/suite-${label}-${state!.executionId}.json`;
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
        try {
          const evidence = await provisioner.verifyRuntime(rtUrl);
          console.log(`runtime: ${evidence.runtimeUser}@${evidence.serverAddress}:${evidence.serverPort} scram=${evidence.scram.verifierFormat}`);
        } catch (err) {
          console.log(`runtime verification FAILED: ${redactUrl(String((err as Error)?.message ?? err)).slice(0, 500)}`);
          verdict = EXIT_INFRA_FAIL;
        }
        process.env.PHASE0_RT_URL = rtUrl;
        process.env.P1_DATABASE_URL = rtUrl;
        process.env.P3_DATABASE_URL = rtUrl;
      }
    }
    if (verdict === EXIT_PASS) {
      // Shared provider journal for the whole run (P3 tests respect a preset
      // path); reconcile.mjs audits it after the suites complete.
      process.env.P3_PROVIDER_LOG = `phase0/evidence/provider-${state.executionId}.jsonl`;
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
      // Worker stderr was piped but never read, so worker-side failures were
      // invisible (the P1 defect only surfaced via dbos.workflow_output).
      worker.stderr?.on('data', (d: Buffer) => {
        process.stderr.write(`[p1 worker] ${d.toString()}`);
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
          // Retained-database rerun: same database, fresh run identity, history kept.
          process.env.PHASE0_RUN_ID = `${state.executionId}-rerun`;
          recordRunId(process.env.PHASE0_RUN_ID);
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
    const reconJson = `phase0/evidence/reconciliation-${state.executionId}.json`;
    const summaryMd = `phase0/evidence/summary-${state.executionId}.md`;
    if (verdict === EXIT_PASS) {
      await run('reconcile', 'node', ['phase0/reconcile.mjs', reconJson]);
    }
    await run('summary', 'node', [
      'phase0/summary.mjs', 'phase0/evidence', state.executionId, summaryMd,
    ]);
    console.log(`run id: ${state.executionId} run_ids=[${[...state.runIds, process.env.PHASE0_RUN_ID ?? ''].filter((v, i, a) => v && a.indexOf(v) === i).join(',')}] elapsed_s=${Math.round((Date.now() - t0) / 1000)}`);
  } catch (err) {
    console.log(`FATAL: ${redactUrl(String((err as Error)?.message ?? err)).slice(0, 500)}`);
    verdict = EXIT_INFRA_FAIL;
  } finally {
    if (process.env.PHASE0_KEEP_DB === '1') {
      console.log('PHASE0_KEEP_DB=1: database retained for debugging (state file keeps the identity; secrets never logged)');
    } else if (provisioner && state) {
      try {
        const report = await provisioner.down(state);
        for (const line of report.cleaned) console.log(`cleaned: ${line}`);
        for (const r of report.retained) console.log(`retained: ${r.item} (${r.reason})`);
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
  try {
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
      console.error(`usage: test-env.ts (up|down|run [--no-unit] [--repeat-suites] [--sigkill-loop[=N]]) [${PROVISIONER_ENV_VAR}=testcontainers|native]`);
      process.exit(2);
    }
  } catch (err) {
    fail(redactUrl(String((err as Error)?.message ?? err)).slice(0, 500));
  }
}
