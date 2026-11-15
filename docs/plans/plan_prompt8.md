I've reviewed the complete 250-line plan. **I approve its overall direction, and Testcontainers-everywhere is a reasonable choice.** It is a significant improvement over the manual PostgreSQL procedure.

I would make **five surgical adjustments before authorizing implementation**. I do not recommend another planning cycle or an architecture redesign.

## **1\. One lifecycle owner, not two**

This is the most important adjustment.

The plan proposes both `phase0/test-env.ts` and `phase0/vitest.global-setup.ts` to manage environment provisioning and teardown.

AUTOMATED\_TESTING\_PLAN.md

I would give `test-env.ts` sole ownership:

* Start PostgreSQL.  
* Generate credentials.  
* Verify the database.  
* Run setup and migrations.  
* Start and supervise the DBOS worker through the existing runner.  
* Execute the test suites.  
* Reconcile evidence.  
* Persist reports.  
* Destroy the container.

Vitest's `globalSetup` executes in a separate global scope from test workers. Sharing information requires explicit `provide`/`inject` mechanisms.

Vitest+1

That is another lifecycle mechanism we do not need. An outer Node.js orchestrator can pass environment variables to its child processes naturally.

**Recommendation:** Remove the proposed global-setup component unless implementation demonstrates a compelling reason to retain it.

## **2\. Resolve duplicate testing and the existing failing test**

There is a small inconsistency in the plan.

Section 4 says `npm run test:phase0` runs unit tests and integration tests. Section 5 also runs unit suites before invoking `npm run test:phase0`.

AUTOMATED\_TESTING\_PLAN.md  
AUTOMATED\_TESTING\_PLAN.md

Define the command contract:

| Command | Responsibility |
| ----- | ----- |
| `npm run test:phase0:unit` | Fast Phase 0 tests, no PostgreSQL |
| `npm run test:phase0:integration` | PostgreSQL, DBOS, P1/P3/backpressure |
| `npm run test:phase0` | Runs both exactly once |

CI should invoke either the combined command or the two component commands, not both.

There is another issue: the existing application suite has one known failure, `vault.test.ts`.

Do not silently exclude it. Run the suite and implement an explicit known-failure baseline comparison: exactly the documented failure is temporarily tolerated, but any new failure makes the CI check fail. The report must continue to display that known failure.

## **3\. Prove Testcontainers networking satisfies our security guard**

The current database guard requires a loopback-only target. Testcontainers obtains its connection host and mapped port from the container runtime.

Testcontainers for NodeJS+1

The plan assumes that the resulting connection automatically satisfies our loopback restriction.

Do not assume that.

During implementation, verify the actual Docker port binding on:

* macOS with Docker Desktop.  
* Ubuntu GitHub Actions.

Record the mapped address, actual published interface, and connectivity. Do not weaken the database guard just to accommodate Testcontainers.

The security requirement remains loopback-only access.

## **4\. Pin the PostgreSQL image before accepting the implementation**

The plan recommends PostgreSQL 16 but defers the exact digest until implementation.

AUTOMATED\_TESTING\_PLAN.md

Make the implementation establish:

* Exact PostgreSQL patch version.  
* Immutable multi-platform image digest.  
* Selected platform and image ID.  
* Explicit SCRAM authentication configuration.

The official PostgreSQL image uses SCRAM by default for host authentication on PostgreSQL 14 and later, but we should still configure it explicitly and verify the active authentication rule.

GitHub

This gives us reproducible local and CI environments across Apple Silicon and Linux runners.

## **5\. Make CI timing and branch protection explicit**

The plan estimates PR feedback under 20 minutes, but the existing application test baseline took 724 seconds.

AUTOMATED\_TESTING\_PLAN.md

Clarify whether the full application suite runs on every PR or whether the required fast unit gate covers only Phase 0 unit tests.

Also, creating GitHub Actions workflows does not automatically configure required branch-protection checks. That is a separate repository-administration action and must be recorded as such.

Finally, define the timing-margin measurement using actual observed durations, rather than relying on estimates before the first CI runs.

## **My recommended final architecture**

**Developer / GitHub Actions**

Same command, same test harness

`npm run test:phase0`

**test-env.ts**

Single environment lifecycle owner

Provision · Verify · Execute · Reconcile · Teardown

**Testcontainers**

Pinned PostgreSQL \+ SCRAM \+ disposable database

**Existing Phase 0 harness**  
P1 · P3 · Backpressure

DBOS worker and actual PostgreSQL integration tests

**Evidence \+ reconciliation**

Persist JSON, logs, summary and verdict before teardown

Fly \+ Neon deployment acceptance remains a separate staging concern, exactly as the plan recommends.

## **Final decision**

APPROVE WITH FIVE ADJUSTMENTS

The plan's central choices are sound:

* Testcontainers for both local and CI.  
* One shared test harness.  
* No PGlite substitution.  
* No manual database creation in the normal workflow.  
* Automatic evidence collection and cleanup.  
* Separate reliability and deployment acceptance.

The five adjustments above should be incorporated directly into the existing `AUTOMATED_TESTING_PLAN.md`. Do not create another planning document.

**After those corrections, authorize implementation.** I would not require another review before the coding agent starts building the automation.

The objective is to reach a point where OpenLevel's developers simply run one command and the infrastructure takes care of the rest.

