/**
 * P1 prototype worker (Phase 0, discardable). Run ONLY against scratch PG.
 *
 * Registers on queue "p1":
 *  - `p1-echo`: one step inserting into p1_execution_log. Performs NO
 *    external calls, so any duplicate execution is observable as a row
 *    count > 1 for the workflow ID.
 *
 * API verified against installed @dbos-inc/dbos-sdk@5.5.0 .d.ts:
 * setConfig/launch/shutdown, registerWorkflow/registerStep/registerQueue
 * (function form — no decorators, no tsconfig changes).
 *
 * Usage (after Gates A+B+C):
 *   P1_DATABASE_URL=postgres://... node --import tsx phase0/p1/worker.ts
 *
 * Executor identity is deliberately unset here — P2 owns identity/fencing.
 */
import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import { assertDisposableUrl } from '../db-guard.js';

const url = process.env.P1_DATABASE_URL ?? '';
assertDisposableUrl(url, 'P1_DATABASE_URL');

const pool = new Pool({ connectionString: url, max: 5 });

const echoStep = DBOS.registerStep(
  async (workflowId: string): Promise<string> => {
    await pool.query(`INSERT INTO p1_execution_log (workflow_id) VALUES ($1)`, [workflowId]);
    return `echo:${workflowId}`;
  },
  { name: 'p1-echo-step' },
);

const echoWorkflow = DBOS.registerWorkflow(
  async (input: { workflowRunTag: string }): Promise<string> => {
    return await echoStep(input.workflowRunTag);
  },
  { name: 'p1-echo' },
);
void echoWorkflow;

async function main(): Promise<void> {
  DBOS.setConfig({ name: 'openlevel-p1', systemDatabaseUrl: url });
  await DBOS.launch();
  await DBOS.registerQueue('p1');
  console.log('p1 worker up (queue: p1)');
  const stop = async (): Promise<void> => {
    await DBOS.shutdown();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

await main();
