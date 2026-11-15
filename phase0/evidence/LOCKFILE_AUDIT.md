# Lockfile Integrity Audit — Evidence (Phase 0, Gate A)

Regenerated per M-15 from `git show HEAD:package-lock.json` (originals) and
the working-tree lockfile (restored values). Sanitized: hashes, package
names, versions, and URLs only. No credentials.

## Finding

The committed `package-lock.json` (matching HEAD, untouched in the working
tree before this repair) contained corrupted integrity hashes sharing one
identical signature: every occurrence of the base64 fragment `JF`/`Jf`
replaced with `AL` (e.g. `...Sn3JFlW3...` → `...Sn3ALlW3...`). No other
differences in any affected entry. `npm ci` could never succeed with these
values (deterministic `EINTEGRITY` on every attempt, retried 3× per package).

## Reconciled arithmetic (M-15)

- 6 entries found via install failures, restored to registry values.
- 20 further candidates found by sweeping for the `AL` signature; of those,
  12 confirmed corrupted (same signature, verified against registry) and
  8 verified clean (legitimate `AL` fragments: esbuild ×2,
  rolldown-freebsd, standard-schema, chai, vitest/utils, ansi-styles, frac).
- Totals: 6 + 12 = **18 repaired**; 8 verified-clean; 6 + 20 = **26 examined**.
- Post-repair `npm ci` completed with zero integrity failures (202 packages),
  independently confirming no further corrupted entries on this platform.

## Per-entry record

Full URL + HEAD/NOW hash pairs: [`LOCKFILE_PAIRS.md`](./LOCKFILE_PAIRS.md)
(machine-generated from git + working tree — not hand-transcribed).
Verification: `node phase0/evidence/verify-lockfile.mjs` asserts each NOW
value equals live registry metadata and differs from HEAD; last run
2026-11-14: all 18 OK (output in the Phase 0 session record).

Repaired packages: siginfo, bare-events, @vitejs/plugin-react, text-decoder,
xtend, pg-cloudflare, @napi-rs/wasm-runtime, @rolldown/binding-darwin-x64,
@rolldown/binding-wasm32-wasi, @tailwindcss/oxide-darwin-arm64,
@tailwindcss/oxide-linux-arm-gnueabihf, @vitest/snapshot, bare-os, codepage,
postcss, react, tslib, zod.

## Disposition

Restored values are registry truth fetched over HTTPS at execution time.
No broad upgrades, no `npm audit fix`, no other dependency changes.
Lockfile history: only commits `3669aa7` and `12d348b` touch
`package-lock.json`; corruption predates this work (tree was clean).
