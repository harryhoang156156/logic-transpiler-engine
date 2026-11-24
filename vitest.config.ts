import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    // Several integration tests run the full pipeline plus a real
    // `ts.createProgram` type-check, which can exceed Vitest's 5s default on a
    // cold start. Tests with tighter budgets still pass explicit per-test
    // timeouts that override this value.
    testTimeout: 20000,
    hookTimeout: 20000,
  },
});
