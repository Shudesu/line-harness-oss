import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { updateManifest, type Manifest, type ReleaseEntry } from './update-manifest.js';

function makeTmpDir(prefix = 'update-manifest-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function makeEntry(version: string, overrides: Partial<ReleaseEntry> = {}): ReleaseEntry {
  return {
    version,
    released_at: '2026-05-12T00:00:00.000Z',
    worker_hash: `sha256:worker-${version}`,
    admin_hash: `sha256:admin-${version}`,
    liff_hash: `sha256:liff-${version}`,
    bundle_url: `https://example.com/bundles/${version}.tar.gz`,
    bundle_size_bytes: 12345,
    required_secrets: ['LINE_CHANNEL_SECRET', 'LINE_CHANNEL_ACCESS_TOKEN'],
    new_required_secrets: [],
    migrations: [],
    changelog_url: `https://example.com/changelog#${version}`,
    min_from_version: '0.0.0',
    ...overrides,
  };
}

describe('updateManifest', () => {
  let root: string;
  let manifestPath: string;

  beforeEach(() => {
    root = makeTmpDir();
    manifestPath = join(root, 'release-manifest.json');
  });

  afterEach(() => {
    rmSync(root, { recursive: true, force: true });
  });

  it('creates a fresh manifest when the file does not exist', () => {
    const release = makeEntry('0.8.0');

    updateManifest({ manifestPath, release });

    expect(existsSync(manifestPath)).toBe(true);
    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    expect(parsed.schema_version).toBe(1);
    expect(parsed.latest).toBe('0.8.0');
    expect(parsed.releases).toHaveLength(1);
    expect(parsed.releases[0].version).toBe('0.8.0');
    expect(parsed.releases[0].worker_hash).toBe('sha256:worker-0.8.0');
  });

  it('prepends a new release to an existing manifest and updates latest', () => {
    const existing: Manifest = {
      schema_version: 1,
      latest: '0.7.0',
      releases: [makeEntry('0.7.0')],
    };
    writeFileSync(manifestPath, JSON.stringify(existing, null, 2));

    const release = makeEntry('0.8.0');
    updateManifest({ manifestPath, release });

    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    expect(parsed.latest).toBe('0.8.0');
    expect(parsed.releases).toHaveLength(2);
    expect(parsed.releases[0].version).toBe('0.8.0');
    expect(parsed.releases[1].version).toBe('0.7.0');
  });

  it('throws when adding a duplicate version', () => {
    const existing: Manifest = {
      schema_version: 1,
      latest: '0.8.0',
      releases: [makeEntry('0.8.0'), makeEntry('0.7.0')],
    };
    writeFileSync(manifestPath, JSON.stringify(existing, null, 2));

    expect(() =>
      updateManifest({ manifestPath, release: makeEntry('0.8.0') }),
    ).toThrow(/release 0\.8\.0 already exists in manifest/);
  });

  it('gates handoff releases from old engines without discarding existing release history', () => {
    const oldRelease = makeEntry('0.24.0');
    updateManifest({ manifestPath, release: oldRelease });
    const compatible = makeEntry('0.24.1', { legacy_mileage_projection_version: 1 });
    updateManifest({ manifestPath, release: compatible });
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    expect(manifest.schema_version).toBe(2);
    expect(manifest.releases).toEqual([compatible, oldRelease]);
    // The released schema-1 reader checks this before any migration work.
    expect(manifest.schema_version === 1).toBe(false);
    updateManifest({ manifestPath, release: makeEntry('0.24.2') });
    expect(JSON.parse(readFileSync(manifestPath, 'utf8')).schema_version).toBe(2);
  });

  it('writes pretty-printed, parseable JSON output', () => {
    const release = makeEntry('0.8.0');
    updateManifest({ manifestPath, release });

    const raw = readFileSync(manifestPath, 'utf8');
    // Pretty-printed → multi-line.
    expect(raw.split('\n').length).toBeGreaterThan(5);
    // Round-trip parseable.
    expect(() => JSON.parse(raw)).not.toThrow();
    // 2-space indent on the first nested key.
    expect(raw).toMatch(/\n {2}"schema_version"/);
  });

  it('preserves order of existing releases when prepending', () => {
    const existing: Manifest = {
      schema_version: 1,
      latest: '0.7.0',
      releases: [makeEntry('0.7.0'), makeEntry('0.6.1'), makeEntry('0.6.0')],
    };
    writeFileSync(manifestPath, JSON.stringify(existing, null, 2));

    updateManifest({ manifestPath, release: makeEntry('0.8.0') });

    const parsed = JSON.parse(readFileSync(manifestPath, 'utf8')) as Manifest;
    expect(parsed.releases.map((r) => r.version)).toEqual(['0.8.0', '0.7.0', '0.6.1', '0.6.0']);
    expect(parsed.latest).toBe('0.8.0');
  });

  it('writes file with trailing newline', () => {
    updateManifest({ manifestPath, release: makeEntry('0.8.0') });
    const raw = readFileSync(manifestPath, 'utf8');
    expect(raw.endsWith('\n')).toBe(true);
  });

  it('throws on unsupported schema_version', () => {
    writeFileSync(
      manifestPath,
      JSON.stringify({ schema_version: 3, latest: '0.7.0', releases: [] }, null, 2),
    );

    expect(() => updateManifest({ manifestPath, release: makeEntry('0.8.0') })).toThrow(
      /unsupported manifest schema_version: 3/,
    );
  });
});
