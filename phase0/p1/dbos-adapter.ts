/**
 * P1 prototype — isolated DBOS SDK seam (Phase 0, discardable).
 *
 * Bound to @dbos-inc/dbos-sdk@5.5.0 (installed 2026-11-14, verified
 * against its shipped .d.ts — NOT from memory or docs prose):
 *  - `DBOSClient.create({ systemDatabaseUrl })`
 *  - `client.enqueueInTransaction(tx, options, ...args)` with
 *    `ClientEnqueueOptions` = queueName + workflowName + workflowID +
 *    `workflowIDReusePolicy` (present in installed
 *    `enqueue_options.d.ts`; the V2.1 interface-omission concern does
 *    NOT apply to 5.5.0).
 *  - `duplicationPolicy` is deliberately never passed here (docs:
 *    `return-existing` unsupported in-transaction and throws).
 *  - `client.getWorkflow(workflowID)` for read-only duplicate lookup.
 *  - `DEFAULT_POOL_SIZE = 10` confirmed in installed
 *    `system_database.{js,d.ts}` (closes V2.1's pool-default unknown).
 */
import { DBOSClient } from '@dbos-inc/dbos-sdk';
import type { PoolClient } from 'pg';

export interface EnqueueRequest {
  /** Deterministic workflow ID derived from the business key. */
  workflowId: string;
  /** Registered workflow name (string reference — web never imports impl). */
  workflowName: string;
  /** Queue name the workflow is enqueued to. */
  queueName: string;
  /** JSON-serializable workflow arguments (IDs + bounded metadata only). */
  args: unknown[];
}

export interface WorkflowStatusView {
  workflowId: string;
  status: string;
  result: unknown;
}

export async function createClient(systemDatabaseUrl: string): Promise<DBOSClient> {
  return await DBOSClient.create({ systemDatabaseUrl });
}

/**
 * Process-level shared client (M-13). Handler calls share one client per
 * (URL, pool size) so DBOS system connections are bounded and measurable
 * instead of one pool per request. Tests call resetSharedClients() to
 * isolate suites; production code shares for the process lifetime.
 */
const sharedClients = new Map<string, Promise<DBOSClient>>();
let sharedClientCreations = 0;

export async function sharedClient(systemDatabaseUrl: string, poolSize?: number): Promise<DBOSClient> {
  const key = `${systemDatabaseUrl}|${poolSize ?? 'default'}`;
  let existing = sharedClients.get(key);
  if (!existing) {
    sharedClientCreations++;
    existing = DBOSClient.create(
      poolSize === undefined ? { systemDatabaseUrl } : { systemDatabaseUrl, systemDatabasePoolSize: poolSize },
    );
    sharedClients.set(key, existing);
  }
  return existing;
}

/** Test-only introspection: how many DBOSClient instances were created. */
export function sharedClientCreationCount(): number {
  return sharedClientCreations;
}

export async function resetSharedClients(): Promise<void> {
  const clients = [...sharedClients.values()];
  sharedClients.clear();
  sharedClientCreations = 0;
  for (const c of clients) {
    try {
      (await c).destroy();
    } catch {
      // Best effort: a failed client must not fail teardown.
    }
  }
}

/**
 * Enqueue exactly one workflow inside the caller's transaction.
 * MUST be called with a pg client holding an open transaction on the
 * system database. Never passes duplicationPolicy.
 */
export async function enqueueInCallerTransaction(
  client: DBOSClient,
  tx: PoolClient,
  req: EnqueueRequest,
): Promise<void> {
  await client.enqueueInTransaction<(...args: unknown[]) => Promise<unknown>>(
    tx,
    {
      queueName: req.queueName,
      workflowName: req.workflowName,
      workflowID: req.workflowId,
      workflowIDReusePolicy: 'return-existing',
    },
    ...req.args,
  );
}

/** Read-only status lookup for the duplicate path. Never enqueues. */
export async function getWorkflowStatus(
  client: DBOSClient,
  workflowId: string,
): Promise<WorkflowStatusView | null> {
  const st = await client.getWorkflow(workflowId);
  if (!st) return null;
  return { workflowId: st.workflowID, status: st.status, result: st.output ?? null };
}

/** Test-only: delete a workflow record to simulate history-retention expiry. */
export async function deleteWorkflowById(systemDatabaseUrl: string, workflowId: string): Promise<void> {
  const client = await createClient(systemDatabaseUrl);
  try {
    await client.deleteWorkflow(workflowId);
  } finally {
    await client.destroy();
  }
}
