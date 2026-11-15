I would authorize the agent to **install the container runtime, configure the local environment, execute the tests, push a feature branch, validate GitHub Actions, and configure branch protection once the acceptance criteria are met**.

The important boundary is that it must not bypass macOS security, purchase subscriptions, expose credentials, or touch production infrastructure.

One refinement: Docker Desktop does not always require administrator privileges for its default installation, and Testcontainers also supports Colima. The agent should prefer Docker Desktop to match the approved plan, but have a safe fallback rather than get stuck on one installer.

Docker Docs+2

## **Authorization prompt for the implementation agent**

# **OpenLevel — Full Authorization: Install, Execute, Validate, and Activate Automated Testing**

## **1\. Authorization and objective**

You are authorized to take ownership of completing the OpenLevel automated testing environment and making it operational.

The owner explicitly approves the routine installation, configuration, testing, repository integration, and CI validation work described below.

**Do not return installation instructions or ask the owner to execute routine commands. Perform the work yourself using the available local environment and existing account permissions.**

The implementation of `phase0/AUTOMATED_TESTING_PLAN.md` is complete. Your task is to make it work on the owner's Mac and in GitHub Actions.

The final desired developer experience is:

```
npm run test:phase0
```

This command must provision a disposable real PostgreSQL environment, run the required tests, collect evidence, reconcile results, and clean up automatically.

The objective is not merely to get a green test run. It is to establish a repeatable development and CI environment that OpenLevel can use going forward.

## **2\. First: inspect before installing**

Inspect the actual machine and repository:

* macOS version and support status.  
* CPU architecture: Apple Silicon or Intel.  
* Available memory and disk space.  
* Xcode Command Line Tools.  
* Node.js and npm versions.  
* Existing Docker, Podman, Colima, Lima, or container runtimes.  
* Current Docker contexts and processes.  
* Git branch, commit, remotes, and working-tree changes.  
* GitHub CLI availability and authentication status.  
* Existing GitHub Actions configuration and repository permissions.

Preserve the existing approved dependency versions and source changes.

Do not remove or overwrite unrelated software, databases, containers, images, volumes, or configuration.

## **3\. Install and configure the container runtime**

### **Preferred option: Docker Desktop**

Docker Desktop is the preferred local runtime because it matches the approved testing plan.

You are authorized to:

1. Download Docker Desktop only from the official Docker distribution.  
2. Verify the installer and its checksum/signature using official release information.  
3. Install it using the least-privileged supported configuration.  
4. Place it in the normal application location or an appropriate user-accessible location.  
5. Launch Docker Desktop.  
6. Complete ordinary initial configuration and verify that the Docker Engine is operational.  
7. Pull the exact PostgreSQL image required by `phase0/test-env.ts`.  
8. Verify Docker daemon connectivity and Testcontainers compatibility.

Check macOS compatibility, CPU architecture, and minimum resource requirements before installation.

Do not install experimental components, Kubernetes, or additional developer tooling that the Phase 0 tests do not require.

### **Installation fallback**

If Docker Desktop cannot be installed or operated without prohibited privileged changes or a paid subscription, evaluate Colima as a Docker-compatible alternative.

Testcontainers documents Colima support, with specific socket and port-forwarding considerations. Verify those behaviors against the actual OpenLevel database guard before accepting the fallback.

Do not silently switch container runtimes. Record the reason, configuration, and network verification.

### **Licensing and permissions**

Use Docker Desktop only if the owner's use qualifies under the applicable subscription terms. You are authorized to accept the applicable free-use terms when eligibility is established.

Do not:

* Purchase or initiate a paid subscription.  
* Accept a paid upgrade.  
* Bypass macOS security controls.  
* Disable the firewall or FileVault.  
* Create an unauthenticated remote Docker TCP endpoint.  
* Expose the Docker daemon outside the local machine.  
* Enter or store the owner's administrator password.  
* Use credentials obtained from the owner through chat.

Prefer the default unprivileged installation. If macOS requires an unavoidable administrator, biometric, or account-authorization action that you cannot complete through an already authorized mechanism, continue with other available work and report that specific blocker. Do not attempt to circumvent the operating system.

Keep the container runtime installed after successful setup because it is now part of the intended development workflow. Remove only temporary installer files and mounted installer images after installation.

## **4\. Verify the runtime before running OpenLevel tests**

Prove the runtime works independently:

* Docker CLI version.  
* Docker Engine version.  
* Active context and daemon endpoint.  
* Image-pull capability.  
* Container startup and shutdown.  
* Loopback-only published-port behavior.  
* PostgreSQL readiness.  
* Testcontainers connection discovery.  
* Container cleanup.

Verify the actual published address and port on macOS.

The OpenLevel database guard must remain in force. Do not weaken its loopback security requirements to make Testcontainers work.

Record the exact PostgreSQL image digest, PostgreSQL server version, platform, and Docker runtime version.

Do not use an unpinned PostgreSQL image or modify the established SDK version.

## **5\. Execute the automated test suite**

Use Node.js 22 and the exact committed lockfile.

Run:

1. `npm ci` only if the installed dependencies do not match the lockfile.  
2. Root TypeScript typecheck.  
3. Phase 0 TypeScript typecheck.  
4. Phase 0 unit tests.  
5. Full application suite with the approved `vault.test.ts` baseline comparison.  
6. PostgreSQL-backed P1 tests.  
7. P3 wallet/provider-attempt tests.  
8. Backpressure tests.  
9. Full `npm run test:phase0` command.  
10. Retained-database repeat execution.  
11. Twenty-iteration SIGKILL reliability sequence.

Use the exact test commands defined by the implementation. Do not create a second test harness or duplicate test execution.

### **Acceptance requirements**

All P1, P3, and backpressure assertions must be exercised against actual PostgreSQL.

Preserve the eight P1 acceptance cases and all required P3 evidence fields.

Prove provider-log versus database-ledger consistency while PostgreSQL is still running.

Capture:

* Provider-side accepted-operation counts.  
* Business operation and attempt IDs.  
* Reservations and settlements.  
* Final wallet balances.  
* Workflow execution counts.  
* Database backend counts during backpressure.  
* Test counts and elapsed times.  
* Repeat-run results.  
* All recovery and cleanup outcomes.

The known `vault.test.ts` failure must remain classified as the pre-existing baseline. The baseline gate must fail if a new failure appears or the known failure silently disappears without the expected explicit disposition.

Do not skip tests to produce a green result.

## **6\. Remediate any discovered defects**

You are authorized to correct defects in the approved automated-testing implementation when actual execution reveals them.

Keep corrections minimal and within:

* `phase0/`.  
* Approved package scripts and dependencies required by the automated testing plan.  
* `.github/workflows/` for the two approved workflows.

For every fix, run the targeted test and relevant complete suite again.

Do not:

* Modify application business logic outside Phase 0\.  
* Rewrite V1, V2, or V2.1.  
* Change the DBOS architecture.  
* Introduce another job engine.  
* Add a second worker or Conductor.  
* Use PGlite instead of PostgreSQL.  
* Weaken database guards, wallet assertions, or provider-attempt safety.  
* Change the known vault failure merely to make CI green.

## **7\. GitHub Actions: publish and validate**

Inspect the repository's existing remote and authentication.

You are authorized to:

1. Create a dedicated feature branch for the automated testing implementation.  
2. Commit only the approved testing infrastructure changes and necessary dependency/lockfile changes.  
3. Push the feature branch using existing Git authentication.  
4. Create or update a pull request against the default branch.  
5. Allow GitHub Actions to execute the approved CI workflows.  
6. Inspect CI logs and artifacts.  
7. Correct workflow or test issues within the approved scope.  
8. Repeat runs until acceptance criteria are met.

Never push directly to `master` or the default branch as a shortcut.

Never force-push or rewrite shared Git history.

Do not commit credentials, local database data, Docker socket information, or unredacted logs.

If GitHub authentication is unavailable, do not request a personal access token in chat. Complete the local work and report the precise authentication blocker.

### **CI acceptance**

The PR workflow must demonstrate:

* Pinned Node.js 22\.  
* Reproducible `npm ci`.  
* Root typecheck.  
* Phase 0 typecheck.  
* Unit test results.  
* PostgreSQL integration tests through Testcontainers.  
* Full application baseline comparison.  
* Sanitized artifact upload even on failure.  
* Correct exit codes and failure propagation.

Run the approved three consecutive green CI validation runs, including the forced-failure/redaction drill.

Do not describe a workflow as validated based on YAML parsing alone.

## **8\. Branch protection and repository administration**

After the three green CI runs and forced-failure drill pass:

1. Inspect existing branch protection rules or repository rulesets.  
2. Identify the exact required status-check names from successful workflow runs.  
3. Preserve all existing protections.  
4. Configure the approved typecheck, unit, and integration checks as required for the default branch.  
5. Do not weaken existing review requirements, administrator enforcement, or merge restrictions.  
6. Verify the resulting configuration.

You are authorized to make this limited branch-protection change if the existing GitHub account has the necessary administrative permissions.

Do not change repository visibility, billing, organization settings, collaborator permissions, or unrelated rulesets.

If the necessary permission is unavailable, provide the exact remaining administrative action and its required setting. Do not claim branch protection is active until verified.

## **9\. Nightly reliability workflow**

Enable and validate the approved nightly reliability workflow.

It must:

* Run the twenty-iteration SIGKILL sequence.  
* Run retained-database repeat tests.  
* Perform full reconciliation.  
* Preserve sanitized artifacts.  
* Notify or report failures without automatically weakening required PR gates.

Verify schedule configuration and manual dispatch.

Do not increase GitHub Actions billing limits, change subscription tiers, or enable paid infrastructure.

## **10\. Cleanup and operational handoff**

After each successful local run:

1. Reconcile provider journal and PostgreSQL ledger.  
2. Persist and verify all evidence.  
3. Remove only the Testcontainers resources created by that run.  
4. Verify no test database, worker process, or orphaned container remains.  
5. Retain the local Docker runtime and cached pinned image for future developer use.  
6. Never use global Docker prune commands.

Preserve failed-run diagnostics when requested by the existing `PHASE0_KEEP_DB` mechanism.

CI must always destroy its ephemeral resources after artifact persistence.

## **11\. Final deliverables**

Provide a final execution report containing:

* Installed runtime and versions.  
* PostgreSQL image digest and server version.  
* SDK and Node.js versions.  
* Local full-suite results.  
* P1/P3/backpressure results.  
* Repeat-run results.  
* Twenty-iteration SIGKILL results.  
* Provider-log versus ledger reconciliation.  
* Container cleanup verification.  
* Git branch and commit identifiers.  
* Pull request link.  
* Three consecutive CI run results.  
* Nightly workflow status.  
* Branch-protection verification.  
* Remaining risks or blockers.  
* Final repository delta.

Clearly distinguish actual execution from assumptions and design assertions.

## **12\. Stop conditions**

Do not stop merely because a routine installation or test command fails. Diagnose, correct, and retry within the approved scope.

Stop only if:

* OS security requires an unavailable owner-only authorization.  
* A paid subscription or unexpected cloud billing is required.  
* The local database cannot be safely isolated.  
* GitHub account permissions prevent required remote actions.  
* The work would affect production or unrelated resources.  
* An unresolved architectural or application-level defect is discovered outside the approved scope.

When stopping, explain the exact limitation and complete every other independent task possible.

## **Final instruction**

You have approval to install, configure, execute, test, commit, push, validate CI, and perform the limited repository administration described here.

Do not return a manual setup checklist when you can execute the task yourself.

Do not ask the owner to run routine commands or transfer secrets.

Do not begin Phase 1\.

**The final outcome must be an operational one-command OpenLevel testing workflow, passing real PostgreSQL integration tests locally and in CI, with automatic evidence collection, cleanup, and verified repository protections.**

**My expectation:** the agent should come back with a working local `npm run test:phase0`, a pull request with green CI, the nightly reliability workflow, and verified branch protection—not another report saying what needs to be installed.

One practical caveat: macOS may still require an owner-only security or administrator authorization in some installation scenarios. The agent should exhaust the unprivileged installation path first, never bypass that boundary. Docker's current installation documentation describes the default unprivileged setup and its limited privileged configuration cases.

Docker Docs+1  
