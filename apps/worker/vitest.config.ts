import { defineConfig } from 'vitest/config';
import path from 'path';

export default defineConfig({
  resolve: {
    alias: {
      // @line-crm/line-sdk has main=dist/index.js but dist may not exist in
      // the worktree; point Vitest directly at the TS sources so tests resolve
      // without a build step.
      '@line-crm/line-sdk': path.resolve(__dirname, '../../packages/line-sdk/src/index.ts'),
      // cloudflare:workers only resolves inside the real Workers runtime; this
      // repo's tests run under plain Node (no vitest-pool-workers). Many test
      // files transitively import index.ts (which re-exports the
      // TenantScheduler Durable Object), so a global stub is needed rather
      // than mocking it per test file. See test-support/cloudflare-workers-stub.ts.
      'cloudflare:workers': path.resolve(__dirname, 'src/test-support/cloudflare-workers-stub.ts'),
    },
  },
  test: {
    environment: 'node',
    globals: false,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
  },
});
