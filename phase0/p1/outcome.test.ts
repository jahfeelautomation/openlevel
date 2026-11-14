/**
 * Outcome-mapping unit tests (m-02). Pure logic — no database required.
 */
import { describe, expect, test } from 'vitest';
import { httpStatusForOutcome } from './handler.js';

describe('httpStatusForOutcome', () => {
  test('accepted and duplicate are successes', () => {
    expect(httpStatusForOutcome('accepted')).toBe(200);
    expect(httpStatusForOutcome('duplicate')).toBe(200);
  });
  test('conflict is 409', () => {
    expect(httpStatusForOutcome('conflict')).toBe(409);
  });
});
