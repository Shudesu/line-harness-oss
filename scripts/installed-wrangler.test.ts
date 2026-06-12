import { describe, expect, test } from 'vitest';
import { renderInstalledWranglerToml } from '../packages/create-line-harness/src/lib/installed-wrangler';

describe('renderInstalledWranglerToml', () => {
  test('persists admin CORS and cookie topology vars', () => {
    const toml = renderInstalledWranglerToml({
      workerName: 'line-harness-2',
      accountId: 'account-id',
      d1DatabaseName: 'line-harness-2',
      d1DatabaseId: 'database-id',
      r2BucketName: 'line-harness-2-images',
      workerPublicUrl: 'https://line-harness-2.example.workers.dev',
      adminPagesProject: 'line-harness-2-admin',
      adminPublicUrl: 'https://line-harness-2-admin.pages.dev',
      liffPagesProject: 'line-harness-2-liff',
      liffPublicUrl: 'https://line-harness-2.example.workers.dev',
      manifestUrl: 'https://example.com/release-manifest.json',
    });

    expect(toml).toContain('WORKER_URL = "https://line-harness-2.example.workers.dev"');
    expect(toml).toContain('ADMIN_ORIGIN = "https://line-harness-2-admin.pages.dev"');
    expect(toml).toContain('ADMIN_ALLOW_CROSS_SITE = "true"');
  });
});
