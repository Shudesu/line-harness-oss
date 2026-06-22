import { defineConfig } from 'vitest/config';

// Root vitest config — picks up repository-level tests that do not belong to
// a workspace package.
// Per-package tests (apps/worker, packages/*) keep their own configs.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['scripts/**/*.test.ts', 'api/**/*.test.ts'],
  },
});
