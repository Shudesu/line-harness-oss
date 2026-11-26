import { execFileSync } from 'node:child_process';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ensureRepo, pinRepoToTag, refreshInstalledRepo } from '../src/steps/clone-repo.js';
import { renderInstalledWranglerToml, resolveInstalledWranglerConfig } from '../src/lib/installed-wrangler.js';
import { runSetup } from '../src/commands/setup.js';

const repoPnpm = vi.hoisted(() => vi.fn());
const checkDeps = vi.hoisted(() => vi.fn());
const gitHooks = vi.hoisted(() => ({ after: vi.fn() }));
vi.mock('execa', async (original) => {
  const actual = await original<typeof import('execa')>();
  return {
    ...actual,
    execa: vi.fn(async (file: string, args: string[], options?: import('execa').Options) => {
      try {
        return await actual.execa(file, args, options);
      } finally {
        await gitHooks.after(file, args);
      }
    }),
  };
});
vi.mock('../src/lib/pnpm.js', () => ({ repoPnpm }));
vi.mock('../src/steps/check-deps.js', () => ({ checkDeps }));
vi.mock('@clack/prompts', () => ({
  intro: vi.fn(),
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { warn: vi.fn(), info: vi.fn() },
}));

const CONFIG = {
  workerName: 'fixture-worker', cfAccountId: 'fixture-account',
  d1DatabaseId: 'fixture-db', d1DatabaseName: 'fixture-db', r2BucketName: 'fixture-images',
  workerPublicUrl: 'https://fixture.example', adminProject: 'fixture-admin',
  adminPublicUrl: 'https://admin.example', workerDeployMode: 'bundle' as const,
};
const GENERATED = renderInstalledWranglerToml(resolveInstalledWranglerConfig(CONFIG)!);
const CUSTOM = '\n[[durable_objects.bindings]]\nname = "CUSTOM_COUNTER"\nclass_name = "CustomCounter"\n';
const TOML = 'apps/worker/wrangler.toml';

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
}

describe('Git operations preserve local Worker configuration', () => {
  let root: string;
  let repo: string;
  let seed: string;
  let tomlPath: string;

  beforeEach(() => {
    vi.clearAllMocks();
    checkDeps.mockReset();
    gitHooks.after.mockReset();
    repoPnpm.mockResolvedValue(undefined);
    root = mkdtempSync(join(tmpdir(), 'clh-preserve-git-'));
    seed = join(root, 'seed');
    repo = join(root, 'checkout');
    mkdirSync(join(seed, 'apps/worker'), { recursive: true });
    const origin = join(root, 'origin.git');
    git(root, 'init', '--bare', origin);
    git(seed, 'init', '-b', 'main');
    git(seed, 'config', 'core.hooksPath', '/dev/null');
    git(seed, 'config', 'user.name', 'Preservation fixture');
    git(seed, 'config', 'user.email', 'fixture@example.invalid');
    git(seed, 'config', 'commit.gpgsign', 'false');
    writeFileSync(join(seed, 'pnpm-workspace.yaml'), 'packages: []\n');
    writeFileSync(join(seed, '.gitignore'), '.line-harness*.json\n');
    writeFileSync(join(seed, TOML), 'name = "version-a"\n');
    writeFileSync(join(seed, 'source.txt'), 'version-a\n');
    git(seed, 'add', '.');
    git(seed, 'commit', '-m', 'version a');
    git(seed, 'tag', 'v0.24.0');
    writeFileSync(join(seed, TOML), 'name = "version-b"\n');
    writeFileSync(join(seed, 'source.txt'), 'version-b\n');
    git(seed, 'commit', '-am', 'version b');
    git(seed, 'tag', 'v0.24.1');
    git(seed, 'remote', 'add', 'origin', origin);
    git(seed, 'push', 'origin', 'main', '--tags');
    git(root, 'clone', '--branch', 'main', origin, repo);
    git(repo, 'config', 'core.hooksPath', '/dev/null');
    tomlPath = join(repo, TOML);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    rmSync(root, { recursive: true, force: true });
  });

  function generatedConfig(): void {
    writeFileSync(join(repo, '.line-harness-config.json'), JSON.stringify(CONFIG));
    writeFileSync(tomlPath, GENERATED);
  }

  function expectUnchanged(before: string, head: string): void {
    expect(readFileSync(tomlPath, 'utf8')).toBe(before);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(head);
    expect(repoPnpm).not.toHaveBeenCalled();
  }

  it('rejects hand edits in an arbitrary checkout before fetching even a missing tag', async () => {
    const before = readFileSync(tomlPath, 'utf8') + CUSTOM;
    writeFileSync(tomlPath, before);
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(pinRepoToTag(repo, '99.99.99')).rejects.toThrow('上書きせず停止');
    expectUnchanged(before, head);
    expect(existsSync(join(repo, '.git/FETCH_HEAD'))).toBe(false);
  });

  it('does not mistake an edited generated file for CLI-owned output', async () => {
    generatedConfig();
    writeFileSync(tomlPath, GENERATED + CUSTOM);
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('上書きせず停止');
    expectUnchanged(GENERATED + CUSTOM, head);
  });

  it.each(['missing', 'malformed'])('requires a verifiable saved configuration (%s)', async (kind) => {
    writeFileSync(tomlPath, GENERATED);
    if (kind === 'malformed') writeFileSync(join(repo, '.line-harness-config.json'), '{invalid');
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('上書きせず停止');
    expectUnchanged(GENERATED, head);
  });

  it('preserves staged configuration and its index even when the content matches the generator', async () => {
    generatedConfig();
    git(repo, 'add', TOML);
    const indexBefore = git(repo, 'show', `:${TOML}`);
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('上書きせず停止');
    expectUnchanged(GENERATED, head);
    expect(git(repo, 'show', `:${TOML}`)).toBe(indexBefore);
  });

  it('pins a clean checkout without restoring the previous tracked template', async () => {
    await pinRepoToTag(repo, '0.24.0');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'v0.24.0'));
    expect(readFileSync(tomlPath, 'utf8')).toBe('name = "version-a"\n');
    expect(repoPnpm).toHaveBeenCalledOnce();
  });

  it('restores exact generated bytes and permissions after a successful pin', async () => {
    generatedConfig();
    chmodSync(tomlPath, 0o600);
    await pinRepoToTag(repo, '0.24.0');
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'v0.24.0'));
    expect(readFileSync(tomlPath, 'utf8')).toBe(GENERATED);
    if (process.platform !== 'win32') expect(statSync(tomlPath).mode & 0o777).toBe(0o600);
    expect(repoPnpm).toHaveBeenCalledOnce();
  });

  it('accepts an annotated release tag by comparing its fetched commit with HEAD', async () => {
    generatedConfig();
    git(seed, '-c', 'tag.gpgSign=false', 'tag', '-a', 'v0.23.9', 'v0.24.0', '-m', 'annotated release');
    git(seed, 'push', 'origin', 'refs/tags/v0.23.9');
    try {
      await pinRepoToTag(repo, '0.23.9');
      expect(git(repo, 'rev-parse', 'FETCH_HEAD')).not.toBe(git(repo, 'rev-parse', 'HEAD'));
      expect(git(repo, 'rev-parse', 'FETCH_HEAD^{commit}')).toBe(git(repo, 'rev-parse', 'HEAD'));
      expect(readFileSync(tomlPath, 'utf8')).toBe(GENERATED);
      expect(repoPnpm).toHaveBeenCalledOnce();
    } catch (error) {
      const backup = (error as Error).message.match(/退避先: ([^\n]+)/)?.[1];
      if (backup) rmSync(join(backup, '..'), { recursive: true, force: true });
      throw error;
    }
  });

  it('preserves generated content when tag download fails', async () => {
    generatedConfig();
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(pinRepoToTag(repo, '99.99.99')).rejects.toThrow('リリースタグ');
    expectUnchanged(GENERATED, head);
  });

  it('preserves content changed while a tag fetch was in flight', async () => {
    generatedConfig();
    const head = git(repo, 'rev-parse', 'HEAD');
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'fetch') writeFileSync(tomlPath, GENERATED + CUSTOM);
    });
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('変更');
    expectUnchanged(GENERATED + CUSTOM, head);
  });

  it.skipIf(process.platform === 'win32')('preserves permissions changed while a tag fetch was in flight', async () => {
    generatedConfig();
    chmodSync(tomlPath, 0o644);
    const head = git(repo, 'rev-parse', 'HEAD');
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'fetch') chmodSync(tomlPath, 0o600);
    });
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('変更');
    expectUnchanged(GENERATED, head);
    expect(statSync(tomlPath).mode & 0o777).toBe(0o600);
  });

  it('preserves index-only changes made during a tag fetch', async () => {
    generatedConfig();
    const head = git(repo, 'rev-parse', 'HEAD');
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'fetch') git(repo, 'add', TOML);
    });
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('変更');
    expectUnchanged(GENERATED, head);
    expect(git(repo, 'show', `:${TOML}`)).toBe(GENERATED.trim());
  });

  it('restores generated content when other local edits prevent switching tags', async () => {
    generatedConfig();
    writeFileSync(join(repo, 'source.txt'), 'local source work\n');
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('リリースタグ');
    expectUnchanged(GENERATED, head);
    expect(readFileSync(join(repo, 'source.txt'), 'utf8')).toBe('local source work\n');
  });

  it('keeps generated config when dependency installation fails after checkout', async () => {
    generatedConfig();
    repoPnpm.mockRejectedValueOnce(new Error('install failed')).mockRejectedValueOnce(new Error('install failed'));
    await expect(pinRepoToTag(repo, '0.24.0')).rejects.toThrow('install failed');
    expect(readFileSync(tomlPath, 'utf8')).toBe(GENERATED);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(repo, 'rev-parse', 'v0.24.0'));
  });

  it('does not overwrite manual config during canonical install refresh despite a valid saved config', async () => {
    generatedConfig();
    const before = 'name = "manual-worker"\n' + CUSTOM;
    writeFileSync(tomlPath, before);
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(refreshInstalledRepo(repo)).resolves.toBe(repo);
    expectUnchanged(before, head);
    expect(existsSync(join(repo, '.git/FETCH_HEAD'))).toBe(false);
  });

  it('preserves generated config across a real fast-forward pull', async () => {
    generatedConfig();
    writeFileSync(join(seed, TOML), 'name = "version-c"\n');
    git(seed, 'commit', '-am', 'version c');
    git(seed, 'push', 'origin', 'main');
    await expect(refreshInstalledRepo(repo)).resolves.toBe(repo);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(git(seed, 'rev-parse', 'HEAD'));
    expect(readFileSync(tomlPath, 'utf8')).toBe(GENERATED);
  });

  it('preserves generated config when pull cannot run', async () => {
    generatedConfig();
    git(repo, 'remote', 'remove', 'origin');
    const head = git(repo, 'rev-parse', 'HEAD');
    await expect(refreshInstalledRepo(repo)).resolves.toBe(repo);
    expectUnchanged(GENERATED, head);
  });

  it.each([false, true])('keeps edits made during pull and saves the prior generated config (pull fails=%s)', async (fails) => {
    generatedConfig();
    if (fails) git(repo, 'remote', 'remove', 'origin');
    const edited = git(repo, 'show', `HEAD:${TOML}`) + '\n' + CUSTOM;
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'pull') writeFileSync(tomlPath, edited);
    });
    let failure: (Error & { backupPath?: string }) | undefined;
    try { await refreshInstalledRepo(repo); } catch (error) { failure = error as typeof failure; }
    expect(failure?.message).toContain('変更');
    expect(readFileSync(tomlPath, 'utf8')).toBe(edited);
    expect(failure?.backupPath).toBeTruthy();
    try {
      expect(readFileSync(failure!.backupPath!, 'utf8')).toBe(GENERATED);
      if (process.platform !== 'win32') {
        expect(statSync(failure!.backupPath!).mode & 0o777).toBe(0o600);
        expect(statSync(join(failure!.backupPath!, '..')).mode & 0o777).toBe(0o700);
      }
    } finally {
      if (failure?.backupPath) rmSync(join(failure.backupPath, '..'), { recursive: true, force: true });
    }
  });

  it.skipIf(process.platform === 'win32')('keeps permission changes made during pull instead of restoring over them', async () => {
    generatedConfig();
    const head = git(repo, 'show', `HEAD:${TOML}`) + '\n';
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'pull') chmodSync(tomlPath, 0o400);
    });
    let failure: (Error & { backupPath?: string }) | undefined;
    try { await refreshInstalledRepo(repo); } catch (error) { failure = error as typeof failure; }
    expect(failure?.message).toContain('変更');
    expect(readFileSync(tomlPath, 'utf8')).toBe(head);
    expect(statSync(tomlPath).mode & 0o777).toBe(0o400);
    if (failure?.backupPath) rmSync(join(failure.backupPath, '..'), { recursive: true, force: true });
  });

  it('keeps staged edits made during pull even when working bytes match HEAD', async () => {
    generatedConfig();
    const head = git(repo, 'show', `HEAD:${TOML}`) + '\n';
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'pull') {
        writeFileSync(tomlPath, head + CUSTOM);
        git(repo, 'add', TOML);
        writeFileSync(tomlPath, head);
      }
    });
    let failure: (Error & { backupPath?: string }) | undefined;
    try { await refreshInstalledRepo(repo); } catch (error) { failure = error as typeof failure; }
    expect(failure?.message).toContain('変更');
    expect(readFileSync(tomlPath, 'utf8')).toBe(head);
    expect(git(repo, 'show', `:${TOML}`)).toBe((head + CUSTOM).trim());
    if (failure?.backupPath) rmSync(join(failure.backupPath, '..'), { recursive: true, force: true });
  });

  it('does not treat a user commit made during pull as an approved Git result', async () => {
    generatedConfig();
    const edited = git(repo, 'show', `HEAD:${TOML}`) + '\n' + CUSTOM;
    let userCommit = '';
    gitHooks.after.mockImplementation((file, args) => {
      if (file === 'git' && args[0] === 'pull') {
        writeFileSync(tomlPath, edited);
        git(repo, 'add', TOML);
        git(repo, '-c', 'user.name=Preservation fixture', '-c', 'user.email=fixture@example.invalid',
          '-c', 'commit.gpgsign=false', 'commit', '-m', 'user configuration edit');
        userCommit = git(repo, 'rev-parse', 'HEAD');
      }
    });
    let failure: (Error & { backupPath?: string }) | undefined;
    try { await refreshInstalledRepo(repo); } catch (error) { failure = error as typeof failure; }
    expect(failure?.message).toContain('変更');
    expect(readFileSync(tomlPath, 'utf8')).toBe(edited);
    expect(git(repo, 'rev-parse', 'HEAD')).toBe(userCommit);
    if (failure?.backupPath) rmSync(join(failure.backupPath, '..'), { recursive: true, force: true });
  });

  it.each(['explicit', 'cwd'])('allows read-only checkout reuse without changing config or state (%s)', async (mode) => {
    const before = readFileSync(tomlPath, 'utf8') + CUSTOM;
    writeFileSync(tomlPath, before);
    const statePath = join(repo, '.line-harness-setup.json');
    const state = JSON.stringify({ completedSteps: [], originalWranglerToml: 'old snapshot' });
    writeFileSync(statePath, state);
    if (mode === 'cwd') vi.spyOn(process, 'cwd').mockReturnValue(repo);
    await expect(ensureRepo(mode === 'explicit' ? repo : null)).resolves.toBe(repo);
    expect(readFileSync(tomlPath, 'utf8')).toBe(before);
    expect(readFileSync(statePath, 'utf8')).toBe(state);
    expect(repoPnpm).not.toHaveBeenCalled();
  });

  it('keeps ordinary source setup available with custom config and no pending snapshot', async () => {
    const before = readFileSync(tomlPath, 'utf8') + CUSTOM;
    writeFileSync(tomlPath, before);
    checkDeps.mockRejectedValueOnce(new Error('stop at source preflight'));
    await expect(runSetup(repo, { fromSource: true })).rejects.toThrow('stop at source preflight');
    expect(checkDeps).toHaveBeenCalledOnce();
    expect(readFileSync(tomlPath, 'utf8')).toBe(before);
    expect(existsSync(join(repo, '.git/FETCH_HEAD'))).toBe(false);
  });

  it.each([false, true])('rejects stale snapshot restoration before any setup work (source=%s)', async (fromSource) => {
    const before = readFileSync(tomlPath, 'utf8') + CUSTOM;
    writeFileSync(tomlPath, before);
    const statePath = join(repo, '.line-harness-setup.json');
    const state = JSON.stringify({ completedSteps: [], originalWranglerToml: 'old snapshot' });
    writeFileSync(statePath, state);
    await expect(runSetup(repo, { fromSource })).rejects.toThrow('古いsnapshotで上書きせず停止');
    expect(checkDeps).not.toHaveBeenCalled();
    expect(readFileSync(tomlPath, 'utf8')).toBe(before);
    expect(readFileSync(statePath, 'utf8')).toBe(state);
    expect(repoPnpm).not.toHaveBeenCalled();
  });

  it('allows a proven interrupted CLI patch to restore its saved config', async () => {
    const original = 'name = "original"\naccount_id = "PLACEHOLDER"\ndatabase_id = "DB_PLACEHOLDER"\n';
    const patched = original.replace('PLACEHOLDER', 'account-selected').replace('DB_PLACEHOLDER', 'db-selected');
    writeFileSync(tomlPath, patched);
    writeFileSync(join(repo, '.line-harness-setup.json'), JSON.stringify({
      completedSteps: [], originalWranglerToml: original,
      accountId: 'account-selected', d1DatabaseId: 'db-selected',
    }));
    checkDeps.mockRejectedValueOnce(new Error('stop after safe restoration'));
    await expect(runSetup(repo, { fromSource: true })).rejects.toThrow('stop after safe restoration');
    expect(readFileSync(tomlPath, 'utf8')).toBe(original);
    expect(checkDeps).toHaveBeenCalledOnce();
  });
});
