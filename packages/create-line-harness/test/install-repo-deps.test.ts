import { describe, it, expect, beforeEach, vi } from 'vitest';

const repoPnpm = vi.fn();

vi.mock('../src/lib/pnpm.js', () => ({ repoPnpm }));
vi.mock('@clack/prompts', () => ({
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { warn: vi.fn(), info: vi.fn() },
}));

const { installRepoDeps } = await import('../src/steps/clone-repo.js');

const REPO = '/tmp/repo';

describe('installRepoDeps', () => {
  beforeEach(() => {
    repoPnpm.mockReset();
  });

  it('installs with the lockfile frozen', async () => {
    repoPnpm.mockResolvedValue(undefined);
    await installRepoDeps(REPO);
    expect(repoPnpm).toHaveBeenCalledTimes(1);
    expect(repoPnpm).toHaveBeenCalledWith(
      REPO,
      ['install', '--frozen-lockfile'],
      { cwd: REPO },
    );
  });

  it('retries unfrozen when the lockfile is out of date', async () => {
    repoPnpm
      .mockRejectedValueOnce(new Error('ERR_PNPM_OUTDATED_LOCKFILE'))
      .mockResolvedValueOnce(undefined);
    await installRepoDeps(REPO);
    expect(repoPnpm).toHaveBeenCalledTimes(2);
    expect(repoPnpm).toHaveBeenLastCalledWith(REPO, ['install'], { cwd: REPO });
  });

  it('propagates the failure when the unfrozen retry also fails', async () => {
    repoPnpm.mockRejectedValue(new Error('network unreachable'));
    await expect(installRepoDeps(REPO)).rejects.toThrow('network unreachable');
  });
});
