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
