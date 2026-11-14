/**
 * Phase 0 suite checker (m-05, m-14). Reads a vitest --reporter=json file and
 * emits one SUITE marker line. Exits non-zero when any test failed OR when
 * zero tests executed (all-skipped must never read as green).
 *
 * Usage: node phase0/check-suite.mjs <json-file> <suite-name>
 */
import { readFileSync } from 'node:fs';

const [file, name] = process.argv.slice(2);
if (!file || !name) {
  console.error('usage: node phase0/check-suite.mjs <json-file> <suite-name>');
  process.exit(2);
}

let doc;
try {
  doc = JSON.parse(readFileSync(file, 'utf8'));
} catch (err) {
  console.log(`SUITE ${name}: NO-RESULT (${String(err).slice(0, 120)})`);
  process.exit(1);
}

// Vitest JSON reporter mirrors the jest summary shape; be liberal in what we accept.
const total = doc.numTotalTests ?? doc.numTotalTestSuites ?? 0;
const passed = doc.numPassedTests ?? 0;
const failed = doc.numFailedTests ?? doc.numFailedTestSuites ?? 0;
const skipped = doc.numPendingTests ?? doc.numSkippedTests ?? Math.max(0, total - passed - failed);

if (failed > 0) {
  console.log(`SUITE ${name}: FAIL (total=${total} passed=${passed} failed=${failed} skipped=${skipped})`);
  process.exit(1);
}
if (passed === 0) {
  console.log(`SUITE ${name}: NOT-EXECUTED (total=${total} passed=0 skipped=${skipped}) — no evidence`);
  process.exit(1);
}
console.log(`SUITE ${name}: PASS (total=${total} passed=${passed} skipped=${skipped})`);
