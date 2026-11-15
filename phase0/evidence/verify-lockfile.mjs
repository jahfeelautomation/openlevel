#!/usr/bin/env node
/**
 * Phase 0 lockfile repair verifier (M-15). For each of the 18 repaired
 * entries, asserts: registry metadata == working-tree lockfile value, and
 * HEAD lockfile value differs (i.e. a repair was actually applied).
 * Prints old → new pairs. Network required (registry metadata over HTTPS).
 * Usage: node phase0/evidence/verify-lockfile.mjs   (from repo root)
 */
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const ENTRIES = [
  ['siginfo', '2.0.0'],
  ['bare-events', '2.9.1'],
  ['@vitejs/plugin-react', '6.0.2'],
  ['text-decoder', '1.2.7'],
  ['xtend', '4.0.2'],
  ['pg-cloudflare', '1.4.0'],
  ['@napi-rs/wasm-runtime', '0.2.12'],
  ['@rolldown/binding-darwin-x64', '1.0.3'],
  ['@rolldown/binding-wasm32-wasi', '1.0.3'],
  ['@tailwindcss/oxide-darwin-arm64', '4.3.0'],
  ['@tailwindcss/oxide-linux-arm-gnueabihf', '4.3.0'],
  ['@vitest/snapshot', '4.1.8'],
  ['bare-os', '3.9.1'],
  ['codepage', '1.15.0'],
  ['postcss', '8.5.15'],
  ['react', '19.2.7'],
  ['tslib', '2.8.1'],
  ['zod', '4.4.3'],
];

const workLock = JSON.parse(readFileSync('package-lock.json', 'utf8'));
const headLock = JSON.parse(execSync('git show HEAD:package-lock.json', { maxBuffer: 1 << 24 }).toString());

function integrityOf(lock, name) {
  const direct = lock.packages?.[`node_modules/${name}`]?.integrity;
  if (direct) return direct;
  const nested = Object.entries(lock.packages ?? {}).find(([k, v]) => k.endsWith(`/node_modules/${name}`) && v.integrity);
  return nested?.[1]?.integrity;
}

let failures = 0;
for (const [name, version] of ENTRIES) {
  const urlName = name.replace('/', '%2f');
  let reg;
  try {
    const out = execSync(`curl -s --max-time 30 "https://registry.npmjs.org/${urlName}/${version}"`, {
      maxBuffer: 1 << 20,
    });
    reg = JSON.parse(out.toString()).dist?.integrity;
  } catch (err) {
    console.log(`ERR  ${name}@${version}: registry fetch failed (${String(err).slice(0, 100)})`);
    failures++;
    continue;
  }
  const current = integrityOf(workLock, name);
  const head = integrityOf(headLock, name);
  const okRegistry = reg && reg === current;
  const wasFixed = head && current && head !== current;
  console.log(`${okRegistry && wasFixed ? 'OK  ' : 'FAIL'} ${name}@${version}`);
  console.log(`  head: ${head}`);
  console.log(`  now : ${current}`);
  console.log(`  reg : ${reg}`);
  if (!(okRegistry && wasFixed)) failures++;
}
if (failures > 0) {
  console.log(`\n${failures} entries FAILED verification`);
  process.exit(1);
}
console.log(`\nAll ${ENTRIES.length} entries verified: working tree == registry, HEAD differs (repair present)`);
