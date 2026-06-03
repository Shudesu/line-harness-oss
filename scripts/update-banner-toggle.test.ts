import { describe, expect, test } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const updateBanner = readFileSync(
  resolve(root, 'apps/web/src/components/update/update-banner.tsx'),
  'utf8',
);

describe('update banner deployment toggle', () => {
  test('custom client builds can disable the fork/update banner at build time', () => {
    expect(updateBanner).toContain('NEXT_PUBLIC_UPDATE_BANNER_ENABLED');
    expect(updateBanner).toContain("!== 'false'");
    expect(updateBanner).toContain('if (!updateBannerEnabled) return');
    expect(updateBanner).toContain('getCurrentVersion()');
    expect(updateBanner).toContain('detectFork(current, manifest)');
  });
});
