import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  fetchManifest,
  findRelease,
  findLatestUpgrade,
  compareSemver,
} from '../src/manifest.js';
import type { Manifest, ReleaseEntry } from '../src/types.js';

const sampleRelease = (overrides: Partial<ReleaseEntry> = {}): ReleaseEntry => ({
  version: '0.6.0',
  released_at: '2026-05-01T00:00:00Z',
  worker_hash: 'sha256:worker0',
  admin_hash: 'sha256:admin0',
  liff_hash: 'sha256:liff0',
  bundle_url: 'https://example.com/bundles/0.6.0.tar.gz',
  bundle_size_bytes: 12345,
  required_secrets: ['LINE_CHANNEL_ACCESS_TOKEN'],
  new_required_secrets: [],
  migrations: [],
  changelog_url: 'https://example.com/changelog#0.6.0',
  min_from_version: '0.5.0',
  ...overrides,
});

const sampleManifest = (): Manifest => ({
  schema_version: 1,
  latest: '0.7.0',
  releases: [
    sampleRelease({ version: '0.5.0' }),
    sampleRelease({ version: '0.6.0' }),
    sampleRelease({ version: '0.7.0' }),
  ],
});

describe('fetchManifest', () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn() as unknown as typeof fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it('fetches and parses a manifest', async () => {
    const manifest = sampleManifest();
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => manifest,
    } as Response);

    const result = await fetchManifest('https://example.com/manifest.json');

    expect(result).toEqual(manifest);
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://example.com/manifest.json',
      expect.objectContaining({ cache: 'no-store' }),
    );
  });

  it('throws on non-200', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      json: async () => ({}),
    } as Response);

    await expect(fetchManifest('https://example.com/missing.json')).rejects.toThrow(
      /404/,
    );
  });

  it('accepts schema 2 while keeping schema 1 releases readable', async () => {
    const manifest: Manifest = { ...sampleManifest(), schema_version: 2 };
    manifest.releases[2].legacy_mileage_projection_version = 1;
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, json: async () => manifest } as Response);
    expect(await fetchManifest('https://example.com/manifest.json')).toEqual(manifest);
  });

  it('does not allow handoff releases to masquerade as old-engine-compatible schema 1', async () => {
    const manifest = sampleManifest();
    manifest.releases[2].legacy_mileage_projection_version = 1;
    vi.mocked(globalThis.fetch).mockResolvedValue({ ok: true, json: async () => manifest } as Response);
    await expect(fetchManifest('https://example.com/manifest.json')).rejects.toThrow('requires manifest schema_version 2');
  });

  it('throws on unsupported schema_version', async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ schema_version: 3, latest: '1.0.0', releases: [] }),
    } as Response);

    await expect(fetchManifest('https://example.com/manifest.json')).rejects.toThrow(
      /unsupported manifest schema_version 3/,
    );
  });
});

describe('findRelease', () => {
  it('returns entry when found', () => {
    const manifest = sampleManifest();
    const entry = findRelease(manifest, '0.6.0');
    expect(entry).toBeDefined();
    expect(entry?.version).toBe('0.6.0');
  });

  it('returns undefined when not found', () => {
    const manifest = sampleManifest();
    expect(findRelease(manifest, '9.9.9')).toBeUndefined();
  });
});

describe('findLatestUpgrade', () => {
  it('returns the latest entry when newer than current', () => {
    const manifest = sampleManifest();
    const entry = findLatestUpgrade(manifest, '0.6.0');
    expect(entry).not.toBeNull();
    expect(entry?.version).toBe('0.7.0');
  });

  it('returns null when current === latest', () => {
    const manifest = sampleManifest();
    expect(findLatestUpgrade(manifest, '0.7.0')).toBeNull();
  });
});

describe('compareSemver', () => {
  it('returns negative when a < b', () => {
    expect(compareSemver('0.5.0', '0.6.0')).toBeLessThan(0);
  });

  it('returns 0 when a === b', () => {
    expect(compareSemver('0.6.0', '0.6.0')).toBe(0);
  });

  it('returns positive when a > b', () => {
    expect(compareSemver('0.7.0', '0.6.0')).toBeGreaterThan(0);
  });
});
