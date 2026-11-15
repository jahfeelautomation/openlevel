/**
 * P2 staging probe workflows (Phase 0, isolated). Deployed ONLY to the
 * staging worker at Gate D. Three minimal workflows exercising the T2/T3
 * fencing scenarios; all state lands in `p2_probe_log` for evidence.
 *
 * API verified against installed @dbos-inc/dbos-sdk@5.5.0 .d.ts
 * (registerWorkflow/registerStep/registerQueue, setConfig/launch).
 */
import { DBOS } from '@dbos-inc/dbos-sdk';
import { Pool } from 'pg';
import { assertDisposableUrl } from '../db-guard.js';

const url = process.env.P2_DATABASE_URL ?? '';
assertDisposableUrl(url, 'P2_DATABASE_URL');
const pool = new Pool({ connectionString: url, max: 5 });

const markStep = DBOS.registerStep(
  async (workflowId: string, mark: string): Promise<string> => {
    await pool.query(`INSERT INTO p2_probe_log (workflow_id, mark) VALUES ($1, $2)`, [workflowId, mark]);
    return mark;
  },
  { name: 'p2-mark' },
);

const slowStep = DBOS.registerStep(
  async (workflowId: string, ms: number): Promise<string> => {
    await pool.query(`INSERT INTO p2_probe_log (workflow_id, mark) VALUES ($1, 'slow-start')`, [workflowId]);
    await new Promise((r) => setTimeout(r, ms));
    await pool.query(`INSERT INTO p2_probe_log (workflow_id, mark) VALUES ($1, 'slow-end')`, [workflowId]);
    return 'slow-done';
  },
  { name: 'p2-slow' },
);

/** Normal durable-step workflow (T2 case 1). */
export const normalWorkflow = DBOS.registerWorkflow(
  async (input: { tag: string }): Promise<string> => {
    const id = `${input.tag}-normal`;
    await markStep(id, 'step-1');
    await markStep(id, 'step-2');
    return 'normal-done';
  },
  { name: 'p2-normal' },
);

/** Simulated provider call: slow step stands in for network I/O (T2 case 2, T3). */
export const providerWorkflow = DBOS.registerWorkflow(
  async (input: { tag: string }): Promise<string> => {
    const id = `${input.tag}-provider`;
    await markStep(id, 'pre-call');
    await slowStep(id, 15000);
    await markStep(id, 'post-call');
    return 'provider-done';
  },
  { name: 'p2-provider' },
);

/** Uncertain-attempt workflow: persists uncertainty, then waits (T2 case 3). */
export const uncertainWorkflow = DBOS.registerWorkflow(
  async (input: { tag: string }): Promise<string> => {
    const id = `${input.tag}-uncertain`;
    await markStep(id, 'attempt-uncertain');
    return 'uncertain-held';
  },
  { name: 'p2-uncertain' },
);
void normalWorkflow;
void providerWorkflow;
void uncertainWorkflow;

async function main(): Promise<void> {
  DBOS.setConfig({ name: 'openlevel-p2', systemDatabaseUrl: url });
  await DBOS.launch();
  await DBOS.registerQueue('p2');
  console.log('p2 probe worker up (queue: p2)');
  const stop = async (): Promise<void> => {
    await DBOS.shutdown();
    await pool.end();
    process.exit(0);
  };
  process.on('SIGTERM', () => void stop());
  process.on('SIGINT', () => void stop());
}

await main();
