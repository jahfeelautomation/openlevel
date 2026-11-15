# Container Runtime Verdict — prompt9 §3 (observed 2026-11-14T18:12Z)

> Scope: observed from the **agent sandbox session** on the machine
> described below. The Docker/Colima incompatibility verdicts rest on
> vendor documentation, not session behavior, and stand regardless of
> session. The bind/shmget/connect denials govern only sandboxed sessions;
> an interactive owner-Mac session may legitimately differ
> (cf. `docs/plans/review3.md`).

Machine: macOS 12.7.6 (Monterey, build 21H1320 — Apple security support
ended 2023), Intel x86_64 (i5-5250U), 4.0 GB RAM, 115 GB free disk.
No container tooling present: no docker/podman/colima/lima binaries, apps,
or state dirs. No gh CLI.

## Docker Desktop: NOT INSTALLABLE (verified against official docs)

- Docker supports "the current and two previous major macOS releases"
  (docs.docker.com/desktop/setup/install/mac-install).
- Release notes state the minimum install version is macOS Ventura 13.3
  (docs-stage.docker.com/desktop/release-notes).
- Versions older than 6 months are not available for download
  (docs.docker.com/desktop/release-notes).
- This machine (12.7.6) fails all three conditions. No download attempted:
  there is no official distribution for this OS, and unofficial archives
  are prohibited (prompt9 §3: official distribution + verified checksum).

## Colima fallback: EVALUATED, REJECTED (verified against official docs)

- Official FAQ (colima.run/docs/faq): "Colima requires macOS 13 or newer."
- Building from source on older versions "may be possible but requires
  Lima and QEMU dependencies" — i.e., compiling a VM stack (QEMU needs
  glib/pixman and 30–60+ min on this CPU) for an outcome the vendor does
  not support, on a 4 GB machine where the VM would then starve the test
  workloads. Rejected as disproportionate and unreliable, not as a safe
  user-local alternative.
- No silent switch made; no Colima/QEMU/Lima software installed.

## Sandbox constraints (re-verified this session, single observation)

```
bind-tcp:EPERM  bind-unix:EPERM  connect:EPERM
```

- No process here can listen (TCP or unix socket) or open raw outbound
  connections; only proxied HTTPS works (verified: registry/API fetches OK).
- Unix-socket CONNECT semantics untested beyond EPERM on TCP; irrelevant —
  no daemon exists to connect to, and none can be started.
- Earlier: PostgreSQL `initdb` fails (`shmget: Operation not permitted`).

## Conclusion

No supported container runtime can run on this machine, and no database
server or client connection can originate from this sandbox. Local
Docker-backed execution (§§4–5) is impossible here — this is a prompt9 §12
stop condition ("no safe user-local alternative exists"), recorded with
evidence rather than worked around. The remaining executable path is CI:
push the prepared branch so GitHub-hosted runners (Docker-native) execute
the workflows, pending push authorization.

## Addendum 2026-11-15 — Track B native result (owner Mac)

"no database server can originate from this sandbox" still holds for the
sandbox seat. It never held for the owner's interactive Mac: PostgreSQL
16.16 (Postgres.app, Apple Silicon) runs there on `127.0.0.1:5433`, and
Track B `run-2026-11-15T03-19-34-525Z-29438` executed fully against it
with exit 0 (evidence: `docs/plans/prompt11_imp.md`, 30 artifacts under
`phase0/evidence/`). The Docker/Colima "not installable" verdicts above
rest on vendor docs and stand regardless of seat; container-image
provenance remains CI's gate (CI-CONTAINER).
