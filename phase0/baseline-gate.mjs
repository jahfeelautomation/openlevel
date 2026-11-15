#!/usr/bin/env node
/**
 * Known-failure baseline gate (Adjustment 2). Compares vitest JSON failures
 * against the pinned baseline. Passes IFF the failed set EQUALS the baseline:
 * any new failure fails; a silently fixed baseline failure also fails (the
 * baseline must be updated deliberately, with the fix referenced).
 * Usage: node phase0/baseline-gate.mjs <vitest-json> <baseline-json>
 */
import { readFileSync } from 'node:fs';

const [resultsPath, baselinePath] = process.argv.slice(2);
if (!resultsPath || !baselinePath) {
  console.error('usage: node phase0/baseline-gate.mjs <vitest-json> <baseline-json>');
  process.exit(2);
}

const results = JSON.parse(readFileSync(resultsPath, 'utf8'));
const baseline = JSON.parse(readFileSync(baselinePath, 'utf8'));

const failed = [];
for (const suite of results.testResults ?? []) {
  const suitePath = String(suite.name ?? '');
  for (const a of suite.assertionResults ?? []) {
    if (a.status === 'failed') {
      failed.push({
        path: suitePath,
        test: [...(a.ancestorTitles ?? []), a.title].join(' ').replace(/\s+/g, ' ').trim(),
      });
    }
  }
}
// Suffix match: vitest reports absolute paths; the baseline pins repo-relative ones.
const matches = (observed, pinned) =>
  (`/${observed.path}`.endsWith(`/${pinned.file}`) || observed.path === pinned.file) &&
  observed.test === String(pinned.test).replace(/\s+/g, ' ').trim();

const expected = baseline.knownFailures ?? [];
const unexpected = failed.filter((f) => !expected.some((p) => matches(f, p)));
const disappeared = expected.filter((p) => !failed.some((f) => matches(f, p)));
const fmt = (f) => `${f.path ?? f.file} :: ${f.test ?? f.title ?? ''}`;

console.log(`baseline: ${expected.length} known failure(s); observed: ${failed.length} failure(s)`);
for (const f of failed) console.log(`  observed: ${fmt(f)}`);
if (unexpected.length > 0) {
  console.log(`BASELINE-GATE FAIL: ${unexpected.length} unexpected failure(s)`);
  for (const f of unexpected) console.log(`  unexpected: ${fmt(f)}`);
  process.exit(1);
}
if (disappeared.length > 0) {
  console.log('BASELINE-GATE FAIL: pinned failure no longer fails — update the baseline deliberately (with fix reference), do not silently drop it');
  for (const f of disappeared) console.log(`  disappeared: ${fmt(f)}`);
  process.exit(1);
}
console.log('BASELINE-GATE PASS: observed failures exactly match the pinned baseline');
