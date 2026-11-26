import { defineConfig } from 'vitest/config';

// Root vitest config — scripts/ と、独自設定を持たない packages/mcp-server を拾う。
// Per-package tests (apps/worker, packages/*) keep their own configs.
export default defineConfig({
  test: {
    environment: 'node',
    globals: false,
    // mcp-server は独自の vitest 設定を持たないので、ここで拾って CI
    // （scripts-tests ジョブ）で必ず回るようにする。
    include: ['scripts/**/*.test.ts', 'packages/mcp-server/test/**/*.test.ts'],
  },
});
