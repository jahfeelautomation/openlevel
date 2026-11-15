# Environment Establishment — review2 §1 (observed 2026-11-14)

> Scope: this file records probes executed from the **agent sandbox
> session**. A different session on different hardware (e.g. the owner's
> interactive Mac session reported in `docs/plans/review3.md`) may
> legitimately observe different capabilities. Neither observation
> retroactively falsifies the other; each governs only the session that
> made it.

- Repo root: `/Users/sherwin/Documents/openlevel/openlevel`, branch `master`,
  commit `2634f8cd0eaccfdc9d589fad3fc967fd1b3ba0bb`.
- Tree: `M .gitignore` (owner), `M package.json` + `M package-lock.json`
  (approved SDK pin + 18 verified hash repairs), untracked `deepwiki.md`,
  `docs/`, `phase0/`. Nothing else.
- Node v22.23.5 (user-local `/tmp`, runs), npm 10.9.9, `node_modules` present.
- `@dbos-inc/dbos-sdk`: `5.5.0` in manifest AND installed (exact match).
- PostgreSQL: none installed, none running (`/Applications/Postgres.app`,
  `/Library/PostgreSQL` absent; no `psql`/`pg_ctl`; no postmaster process).
- Package managers/services: no brew, port, Docker, flyctl, neonctl.

## Capability verdict (re-probed this session, single observation)

```
bind-tcp:EPERM  bind-unix:EPERM  connect:EPERM
```

plus previously observed `shmget: Operation not permitted` from `initdb`.
Consequences, all definitive for this sandbox:

1. No PostgreSQL server can start here (bind + shared memory denied).
2. No PostgreSQL client connection can be made from here (outbound raw
   TCP denied; only proxied HTTP(S) works).
3. Therefore no DB-backed proof (P1/P3/backpressure/retention/fencing) can
   execute from this seat, locally or remotely. Cloud branches, tunnels,
   and substitutes are each independently closed (review2 §6, account
   rules, PGlite prohibition).

Per review2 §9 this is a stop condition for autonomous DB execution only.
Everything else in review2 proceeds here; the single narrow handoff is the
owner-side run of the prepared package (`bash phase0/run-all.sh`).

## Addendum 2026-11-15 — owner-Mac native success (Track B)

The verdicts above govern the restricted agent-sandbox seat only. On the
owner's Mac (Apple Silicon, Postgres.app), PostgreSQL 16.16 runs normally
on loopback `127.0.0.1:5433`, and the full native Track B execution
`run-2026-11-15T03-19-34-525Z-29438` passed against it (P1 9/9, P3 11/11,
backpressure 1/1, rerun identical, 20/20 SIGKILL, reconciliation 4/4;
see `docs/plans/prompt11_imp.md` and the `phase0/evidence/` artifacts).
The sandbox EPERM observations are preserved as history, not deleted:
each environment's verdict stands for the seat that produced it.
