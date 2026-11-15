I can't get the log — same wall as you (`403` on API, `404` on web endpoints, no `gh`, no token). But the public metadata pins the failure down tightly, and I reproduced the likely cause locally.

## What the public metadata proves

| Signal | Value | What it rules out |
|---|---|---|
| Step 5 exit code | **1** (`EXIT_TEST_FAIL`) | Not **2** (`EXIT_INFRA_FAIL`) → container started, `waitReady` OK, `assertScram` OK, static `assertDisposableUrl` on the container URL OK, worker-ready OK, `PHASE0_RT_PASSWORD` set |
| Step 5 duration | **10.0s** | Rules out suites (worker readiness alone allows 60s + suite runtime), rules out reconcile |
| Unit job | 34 pass, includes `test-env.test.ts` which statically imports `./test-env.js` → `@testcontainers/postgresql` | Rules out `MODULE_NOT_FOUND` — the import chain provably loads |
| `npm ci` | success (19s) | Deps installed |

Only one branch satisfies *exit 1 + 10s*: a `run()` call returned non-zero **before any suite ran** → `preflight` (→ `db-guard.ts:119`) or `setup` (→ `db-guard.ts:150`).

**Your hypothesis #1 needs one correction.** The guard that judges the *mapped host* is the static `assertDisposableUrl`, and it **passed** — otherwise `cmdUp()` would have exited **2**, not 1. So `container.getHost()` was loopback. The failure is in the **live** check, `inet_server_addr()`, read from *inside* the container.

## I reproduced the root cause locally

My Gate C run died at exactly that live check. Verbatim:

```
setup target database: phase0_proofs (static check passed; live check follows)
connecting via: postgres://anton:<redacted>@127.0.0.1:5433/phase0_proofs
/Users/.../phase0/db-guard.ts:150
  if (addr !== '127.0.0.1' && addr !== '::1') throw new Error(`refusing destructive work: server "${addr}" not loopback`);
                                                    ^
Error: refusing destructive work: server "127.0.0.1/32" not loopback
    at verifyLiveIdentity (.../db-guard.ts:150:53)
    at async main (.../setup-db.ts:43:5)
```

Proof of the defect (both lines select `inet_server_addr()::text`):

```
inet_server_addr()::text = '127.0.0.1/32'  len=12   → guard would throw: TRUE
host(inet_server_addr()) = '127.0.0.1'     len=9    → would pass
```

`inet_server_addr()::text` carries the **netmask**, so it can never equal `'127.0.0.1'`. The guard fails closed on *every* real PostgreSQL — this is not Testcontainers-specific. It slipped through because `db-guard.test.ts` has **0** references to `verifyLiveIdentity` / `connectGuarded` / `inet_server_addr`; the 24-case table only exercises the static path, exactly as `REMEDIATION_REPORT.md` concedes ("live addr/port check code-complete BLOCKED").

## Two independent defects, either one fails the run

1. **`/32` suffix** — fails even on genuine loopback. Present locally *and* in CI.
2. **Bridge source IP** — inside the container the client arrives via Docker's published port, so `inet_server_addr()` is likely `172.17.0.1`, not loopback.

The log's address string is the discriminator: `127.0.0.1/32` → defect 1 alone; `172.17.0.1/32` → both. Note your proposed "log the actual address, then decide" **cannot** let defect 1 pass — `127.0.0.1/32` still fails the comparison. So the `host()` change is required regardless of what the address turns out to be.

```sql
-- db-guard.ts:111 and :144 — strictly more correct, not a weakening
SELECT current_database() AS db, host(inet_server_addr()) AS addr, inet_server_port() AS port
```

If the address then reads `172.17.0.1`, that's defect 2 — a genuine non-loopback *server-side* view under port-forwarding, and the policy call (how to prove disposability when the oracle is the server's view rather than the client's target) is yours, as you framed it.

## Two other things you should know

- **`phase0/evidence/RUNTIME_VERDICT.md` and `ENVIRONMENT.md` are wrong about this machine.** Both record `bind-tcp:EPERM / connect:EPERM / shmget: Operation not permitted` and conclude "no database server can start here — CI is the only executable path." I disproved all three: `bind-tcp:OK`, `connect-self:OK`, `shmget:OK`, and PostgreSQL 16.16 is **running right now** on `127.0.0.1:5433`. Whatever session produced those verdicts had a tighter sandbox than this one.
- **Local Gate C status: stopped, DB up, per your protocol.** Phases 1–3 otherwise clean — Node `v22.23.5`, SDK `5.5.0`, `initdb`+server OK, `createdb phase0_proofs` OK (SCRAM verified over TCP), credentials in gitignored `phase0/.env` (600). Blocked at `setup-db.ts`. I changed no repo files.

Want the verbatim log? Give me a token (`GH_TOKEN` env, or install+auth `gh`) and I'll pull job `132618633813` and paste the ~40 lines above the first error, redaction-checked. Otherwise, your CI run after the `host()` change will name the address directly.
