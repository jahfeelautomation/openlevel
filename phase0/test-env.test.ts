/**
 * test-env unit tests (no Docker required). Cover the pure orchestration
 * logic: image pin format, runtime URL derivation, exit-code contract.
 * Container lifecycle itself is proven by real runs, not mocks.
 */
import { describe, expect, test } from 'vitest';
import {
  EXIT_CLEANUP_FAIL,
  EXIT_INFRA_FAIL,
  EXIT_PASS,
  EXIT_TEST_FAIL,
  PG_IMAGE,
  deriveRuntimeUrl,
} from './test-env.js';

describe('image pin', () => {
  test('is digest-pinned, not floating-tagged', () => {
    expect(PG_IMAGE).toMatch(/^postgres@sha256:[0-9a-f]{64}$/);
  });
});

describe('deriveRuntimeUrl', () => {
  test('swaps user/password, preserves host/port/database', () => {
    const out = new URL(deriveRuntimeUrl('postgres://owner:bootpw@127.0.0.1:5433/phase0_proofs', 'rtpw123'));
    expect(out.username).toBe('phase0_rt');
    expect(out.password).toBe('rtpw123');
    expect(out.hostname).toBe('127.0.0.1');
    expect(out.port).toBe('5433');
    expect(out.pathname).toBe('/phase0_proofs');
  });
  test('never returns the bootstrap identity', () => {
    const out = deriveRuntimeUrl('postgres://owner:bootpw@127.0.0.1:5433/phase0_proofs', 'x');
    expect(out).not.toContain('owner');
    expect(out).not.toContain('bootpw');
  });
});

describe('exit-code contract', () => {
  test('codes are distinct and documented', () => {
    expect(new Set([EXIT_PASS, EXIT_TEST_FAIL, EXIT_INFRA_FAIL, EXIT_CLEANUP_FAIL]).size).toBe(4);
    expect(EXIT_PASS).toBe(0);
  });
});
