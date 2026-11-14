#!/usr/bin/env node
/**
 * Phase 0 summary generator. Reads per-suite vitest JSON reports +
 * reconciliation.json and writes a one-page Markdown verdict.
 * Usage: node phase0/summary.mjs <evidence-dir> <run-id> <output.md>
 * Env (optional): PHASE0_PG_VERSION, PHASE0_SDK_VERSION, PHASE0_IMAGE.
 * Never prints credentials; inputs are already-redacted artifacts.
 */
import { existsSync, readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const [dir, runId, outPath] = process.argv.slice(2);
if (!dir || !runId || !outPath) {
  console.error('usage: node phase0/summary.mjs <evidence-dir> <run-id> <output.md>');
  process.exit(2);
}

const suites = [];
for (const f of readdirSync(dir).filter((x) => x.startsWith('suite-') && x.includes(runId) && x.endsWith('.json'))) {
  try {
    const j = JSON.parse(readFileSync(join(dir, f), 'utf8'));
    suites.push({
      name: f.replace(/^suite-/, '').replace(`-${runId}.json`, ''),
      total: j.numTotalTests ?? 0,
      passed: j.numPassedTests ?? 0,
      failed: j.numFailedTests ?? 0,
      skipped: (j.numPendingTests ?? j.numSkippedTests ?? 0),
    });
  } catch {
    suites.push({ name: f, total: 0, passed: 0, failed: 0, skipped: 0, unreadable: true });
  }
}

let recon = null;
const reconPath = join(dir, `reconciliation-${runId}.json`);
if (existsSync(reconPath)) {
  try {
    recon = JSON.parse(readFileSync(reconPath, 'utf8'));
  } catch {
    recon = { verdict: 'UNREADABLE' };
  }
}

const anyFail = suites.some((s) => s.failed > 0 || s.unreadable) || (recon && recon.verdict !== 'PASS');
const lines = [
  `# Phase 0 run summary — ${runId}`,
  ``,
  `Verdict: **${anyFail ? 'FAIL' : 'PASS'}**`,
  ``,
  `| Suite | Total | Passed | Failed | Skipped |`,
  `|---|---|---|---|---|`,
  ...suites.map((s) => `| ${s.name} | ${s.total} | ${s.passed} | ${s.failed} | ${s.skipped} |`),
  ``,
  `Reconciliation: **${recon ? recon.verdict : 'NOT RUN'}**`,
  ...(recon && recon.invariants ? recon.invariants.map((i) => `- ${i.pass ? 'OK' : 'FAIL'} ${i.name}${i.detail ? ` — ${i.detail}` : ''}`) : []),
  ``,
  `Environment: node ${process.version}, postgres \`${process.env.PHASE0_PG_VERSION ?? 'unrecorded'}\`, SDK \`${process.env.PHASE0_SDK_VERSION ?? 'unrecorded'}\`, image \`${process.env.PHASE0_IMAGE ?? 'unrecorded'}\`.`,
  ``,
];
writeFileSync(outPath, lines.join('\n'));
console.log(`summary: ${anyFail ? 'FAIL' : 'PASS'} -> ${outPath}`);
process.exit(anyFail ? 1 : 0);
