import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const mocks = vi.hoisted(() => ({
  repoPnpm: vi.fn(),
  pinRepoToTag: vi.fn(),
  ensureAuth: vi.fn(),
  fetchLatestRelease: vi.fn(),
}));

vi.mock('../src/lib/pnpm.js', () => ({ repoPnpm: mocks.repoPnpm }));
vi.mock('../src/steps/check-deps.js', () => ({ checkDeps: vi.fn() }));
vi.mock('../src/steps/auth.js', () => ({ ensureAuth: mocks.ensureAuth, getAccountId: vi.fn() }));
vi.mock('../src/steps/release-bundle.js', () => ({ fetchLatestRelease: mocks.fetchLatestRelease }));
vi.mock('../src/steps/clone-repo.js', async (importOriginal) => ({
  ...await importOriginal<typeof import('../src/steps/clone-repo.js')>(),
  pinRepoToTag: mocks.pinRepoToTag,
}));
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { warn: vi.fn(), info: vi.fn() },
}));

import { runSetup } from '../src/commands/setup.js';

describe('setup dependency preparation', () => {
  let repoDir: string;
  const stopBeforeAuth = new Error('stop before Cloudflare authentication');

  beforeEach(() => {
    vi.resetAllMocks();
    repoDir = mkdtempSync(join(tmpdir(), 'clh-source-deps-'));
    mocks.repoPnpm.mockResolvedValue(undefined);
    mocks.ensureAuth.mockRejectedValue(stopBeforeAuth);
    mocks.fetchLatestRelease.mockResolvedValue({ release: { version: '0.24.0' } });
  });

  afterEach(() => {
    rmSync(repoDir, { recursive: true, force: true });
  });

  it('installs source dependencies before authentication even in an existing checkout', async () => {
    await expect(runSetup(repoDir, { fromSource: true })).rejects.toBe(stopBeforeAuth);
    expect(mocks.repoPnpm).toHaveBeenCalledWith(repoDir, ['install', '--frozen-lockfile'], { cwd: repoDir });
    expect(mocks.repoPnpm.mock.invocationCallOrder[0]).toBeLessThan(mocks.ensureAuth.mock.invocationCallOrder[0]);
    expect(mocks.pinRepoToTag).not.toHaveBeenCalled();
    expect(mocks.fetchLatestRelease).not.toHaveBeenCalled();
  });

  it('stops before authentication when source dependency installation fails', async () => {
    const installError = new Error('dependency installation failed');
    mocks.repoPnpm.mockRejectedValue(installError);
    await expect(runSetup(repoDir, { fromSource: true })).rejects.toBe(installError);
    expect(mocks.ensureAuth).not.toHaveBeenCalled();
  });

  it('keeps official releases on their existing tag-pinning path', async () => {
    await expect(runSetup(repoDir)).rejects.toBe(stopBeforeAuth);
    expect(mocks.pinRepoToTag).toHaveBeenCalledWith(repoDir, '0.24.0');
    expect(mocks.repoPnpm).not.toHaveBeenCalled();
    expect(mocks.pinRepoToTag.mock.invocationCallOrder[0]).toBeLessThan(mocks.ensureAuth.mock.invocationCallOrder[0]);
  });
});
