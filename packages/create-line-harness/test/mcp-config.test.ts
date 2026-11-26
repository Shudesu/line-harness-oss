import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { generateMcpConfig } from '../src/steps/mcp-config.js';

const WORKER = 'https://worker.example.com';
const API_KEY = 'test-api-key-12345678';

function mockAccounts(data: unknown, ok = true) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({
      ok,
      json: async () => ({ success: true, data }),
    })),
  );
}

describe('generateMcpConfig', () => {
  let dir: string;
  let prevCwd: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clh-mcp-test-'));
    prevCwd = process.cwd();
    process.chdir(dir);
  });

  afterEach(() => {
    process.chdir(prevCwd);
    rmSync(dir, { recursive: true, force: true });
    vi.unstubAllGlobals();
  });

  const readConfig = () =>
    JSON.parse(readFileSync(join(dir, '.mcp.json'), 'utf-8'));

  it.each(['{broken', 'null', '[]', '{"mcpServers":[]}'])('preserves invalid config %s', async (original) => {
    writeFileSync(join(dir, '.mcp.json'), original);
    await expect(generateMcpConfig({ workerUrl: WORKER, apiKey: API_KEY, accountId: 'a' })).rejects.toThrow('保持');
    expect(readFileSync(join(dir, '.mcp.json'), 'utf8')).toBe(original);
  });

  it('keeps all collisions and creates owner-only config in an explicit project', async () => {
    for (let i = 0; i < 3; i++) await generateMcpConfig({ configDir: dir, workerUrl: WORKER, apiKey: API_KEY, accountId: 'a' });
    expect(Object.keys(readConfig().mcpServers)).toEqual(['line-harness', 'line-harness-2', 'line-harness-3']);
    if (process.platform !== 'win32') expect(statSync(join(dir, '.mcp.json')).mode & 0o777).toBe(0o600);
  });

  it('sets LINE_HARNESS_ACCOUNT_ID for single-account installs', async () => {
    mockAccounts([{ id: 'acc-1', name: 'Main' }]);
    await generateMcpConfig({ workerUrl: WORKER, apiKey: API_KEY });
    const env = readConfig().mcpServers['line-harness'].env;
    expect(env.LINE_HARNESS_ACCOUNT_ID).toBe('acc-1');
    expect(env.LINE_HARNESS_API_URL).toBe(WORKER);
    expect(env.LINE_HARNESS_API_KEY).toBe(API_KEY);
  });

  it('uses the caller-provided accountId without calling the worker API', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    await generateMcpConfig({ workerUrl: WORKER, apiKey: API_KEY, accountId: 'acc-known' });
    const env = readConfig().mcpServers['line-harness'].env;
    expect(env.LINE_HARNESS_ACCOUNT_ID).toBe('acc-known');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('strips a trailing slash from workerUrl before calling the accounts API', async () => {
    mockAccounts([{ id: 'acc-1' }]);
    await generateMcpConfig({ workerUrl: `${WORKER}/`, apiKey: API_KEY });
    expect(vi.mocked(fetch).mock.calls[0][0]).toBe(`${WORKER}/api/line-accounts`);
    const env = readConfig().mcpServers['line-harness'].env;
    expect(env.LINE_HARNESS_ACCOUNT_ID).toBe('acc-1');
  });

  it('leaves ACCOUNT_ID unset for multi-account installs', async () => {
    mockAccounts([{ id: 'acc-1' }, { id: 'acc-2' }]);
    await generateMcpConfig({ workerUrl: WORKER, apiKey: API_KEY });
    const env = readConfig().mcpServers['line-harness'].env;
    expect(env.LINE_HARNESS_ACCOUNT_ID).toBeUndefined();
  });

  it('still writes config when the accounts API fails', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    await generateMcpConfig({ workerUrl: WORKER, apiKey: API_KEY });
    const env = readConfig().mcpServers['line-harness'].env;
    expect(env.LINE_HARNESS_ACCOUNT_ID).toBeUndefined();
    expect(env.LINE_HARNESS_API_KEY).toBe(API_KEY);
  });

  it('does not overwrite an existing line-harness entry', async () => {
    mockAccounts([{ id: 'acc-1' }]);
    await generateMcpConfig({ workerUrl: WORKER, apiKey: API_KEY });
    await generateMcpConfig({ workerUrl: WORKER, apiKey: 'second-key-87654321' });
    const servers = readConfig().mcpServers;
    expect(servers['line-harness'].env.LINE_HARNESS_API_KEY).toBe(API_KEY);
    expect(servers['line-harness-2'].env.LINE_HARNESS_API_KEY).toBe(
      'second-key-87654321',
    );
  });
});
