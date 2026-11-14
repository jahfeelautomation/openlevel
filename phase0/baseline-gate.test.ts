/**
 * Baseline-gate unit tests (no Docker/DB). Exercises the gate script against
 * fixture JSONs: exact match passes; new failures fail; silently fixed
 * baseline failures fail.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';

const GATE = new URL('./baseline-gate.mjs', import.meta.url).pathname;
const BASELINE = new URL('./vault-baseline.json', import.meta.url).pathname;

function resultsJson(failures: { file: string; title: string }[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'baseline-gate-'));
  const p = join(dir, 'results.json');
  const byFile = new Map();
  for (const f of failures) {
    if (!byFile.has(f.file)) byFile.set(f.file, []);
    byFile.get(f.file).push({ ancestorTitles: [], title: f.title, status: 'failed' });
  }
  const testResults = [...byFile.entries()].map(([name, assertionResults]) => ({ name, assertionResults }));
  writeFileSync(p, JSON.stringify({ testResults }));
  return p;
}

function runGate(json: string): number {
  try {
    execFileSync(process.execPath, [GATE, json, BASELINE], { stdio: 'pipe' });
    return 0;
  } catch (err) {
    return (err as { status?: number }).status ?? 1;
  }
}

describe('baseline-gate', () => {
  test('passes when observed failures exactly match the baseline', () => {
    const json = resultsJson([
      { file: '/repo/openlevel/server/lib/vault.test.ts', title: 'resolveSecret reads an env var derived from the item name' },
    ]);
    expect(runGate(json)).toBe(0);
  });

  test('fails on any new failure', () => {
    const json = resultsJson([
      { file: '/repo/openlevel/server/lib/vault.test.ts', title: 'resolveSecret reads an env var derived from the item name' },
      { file: '/repo/openlevel/server/routes/contacts.test.ts', title: 'lists contacts' },
    ]);
    expect(runGate(json)).toBe(1);
  });

  test('fails when the pinned failure silently disappears', () => {
    const json = resultsJson([]);
    expect(runGate(json)).toBe(1);
  });

  test('fails when everything passes but the baseline is non-empty (same as above, explicit)', () => {
    const dir = mkdtempSync(join(tmpdir(), 'baseline-gate-'));
    const p = join(dir, 'results.json');
    writeFileSync(p, JSON.stringify({ testResults: [] }));
    expect(runGate(p)).toBe(1);
  });
});
