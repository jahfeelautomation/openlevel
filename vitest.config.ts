import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['server/**/*.test.ts', 'scripts/**/*.test.ts'],
    // PGlite spins up a fresh in-process WASM Postgres and reloads the full
    // schema per `setup()`; on a loaded Windows box that cold-start can exceed
    // the 5s default and flake out the route-integration tests. 30s is generous
    // headroom (a healthy file finishes in well under 10s) without masking a
    // genuine hang.
    testTimeout: 30000,
  },
})
