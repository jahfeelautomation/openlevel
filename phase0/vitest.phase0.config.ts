import { defineConfig } from 'vitest/config'

// Phase 0 isolated config (the repo root config only includes server/ +
// scripts/). Invoke explicitly:
//   npx vitest run --config phase0/vitest.phase0.config.ts [file...]
export default defineConfig({
  test: {
    environment: 'node',
    include: ['phase0/**/*.test.ts'],
    // Crash/kill/flood tests spawn processes and wait on real timeouts.
    testTimeout: 120000,
    // Sequential files: p1/p3 suites TRUNCATE shared tables, so files must
    // never run concurrently (verified key name in installed vitest types).
    fileParallelism: false,
  },
})
