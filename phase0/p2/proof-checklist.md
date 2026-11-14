# P2 fencing proof — execution checklist (Gate D)

Proves V2.1 §10 on staging: exactly one active `worker-1`, no overlap,
no blind provider repeats. All observations recorded with timestamps;
evidence excerpts go in the Phase 0 report.

## Preconditions

- [ ] Staging Fly app + Neon (or scratch PG) reachable; `flyctl auth` works.
- [ ] Worker image contains boot wrapper + heartbeat emitter + probe workflows.
- [ ] `fly scale count worker=1` confirmed; `fly status` shows 1 worker Machine.
- [ ] No `DBOS__VMID` in app-wide env (`fly secrets list` + config inspect).

## T1. Identity fail-closed

- [ ] Start worker with `ROLE` unset → expect exit 2, zero DBOS activity.
- [ ] Start worker with conflicting `DBOS__VMID` → expect exit 2.
- [ ] Start worker without sysdb URL → expect exit 2 before dequeue.

## T2. Rolling deploy during active workflows

1. Start a normal durable-step workflow + a simulated-provider-call workflow
   + one workflow with a persisted uncertain attempt.
2. `fly deploy` (rolling, `max_unavailable = 1`); capture all Machine
   states/transitions with timestamps.
3. Assert: old worker `stopped` before replacement executes (no timestamp
   overlap of active `worker-1` executors); replacement healthy only after
   init + recovery; in-flight provider call not blindly repeated
   (attempt log shows ≤1 dispatch); uncertain attempt still quarantined.

## T3. Forced replacement

1. `fly machine kill <worker>` mid-workflow and mid-provider-call (two runs).
2. Assert: replacement recovers pending workflows; no duplicate provider
   dispatch; heartbeat gap detected and paged (simulated alert check).

## T4. Restart policy + graceful shutdown

1. `kill -TERM <worker-pid>` (via `fly ssh console`): assert dequeue stops,
   in-flight steps bounded, pools closed, exit < 120s.
2. Crash-loop the worker process: assert Fly restart policy behavior matches
   the documented selection (record policy name + observed backoff).
3. Intentional deploy shutdown: assert no uncontrolled restart loop.

## T5. Heartbeat monitoring

- [ ] Stop the worker process without stopping the Machine (if possible) or
      block sysdb: assert stale-heartbeat alert fires within 3 min + check
      interval while web `/health` stays green (proves liveness separation).

## Capture bundle (attach to report)

Machine list + states, deploy events log, executor-ID log lines, worker
heartbeat rows, DBOS workflow histories, provider-attempt records,
timestamps for every transition. Any overlap or blind repeat = FAIL with
exact excerpt; do not add advisory-lock fencing unless overlap is observed.
