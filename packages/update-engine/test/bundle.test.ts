import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  mkdirSync,
  rmSync,
  writeFileSync,
  createReadStream,
  existsSync,
} from 'node:fs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  parseBundleStream,
  verifyBundleHashes,
  assertHashesMatch,
} from '../src/bundle.js';

// ─── Fixture helpers ──────────────────────────────────────────────────────────

interface Fixture {
  tmpDir: string;
  tarball: string;
  workerBytes: Buffer;
  workerAssetIndex: Buffer;
  adminIndex: Buffer;
  adminSubApp: Buffer;
  liffIndex: Buffer;
  migration: Buffer;
}

function buildFixture(): Fixture {
  const tmpDir = mkdtempSync(join(tmpdir(), 'update-engine-bundle-'));
  const stageDir = join(tmpDir, 'stage');
  mkdirSync(stageDir);

  // Build directory tree.
  const workerDir = join(stageDir, 'worker');
  const workerAssetsDir = join(stageDir, 'worker-assets');
  const adminDir = join(stageDir, 'admin');
  const adminSubDir = join(adminDir, 'sub');
  const liffDir = join(stageDir, 'liff');
  const migrationsDir = join(stageDir, 'migrations');
  mkdirSync(workerDir);
  mkdirSync(workerAssetsDir);
  mkdirSync(adminDir);
  mkdirSync(adminSubDir);
  mkdirSync(liffDir);
  mkdirSync(migrationsDir);

  const workerBytes = Buffer.from('// worker bundle\nconsole.log("hi");\n', 'utf8');
  const workerAssetIndex = Buffer.from('<html>worker assets</html>\n', 'utf8');
  const adminIndex = Buffer.from('<html>admin</html>\n', 'utf8');
  const adminSubApp = Buffer.from('// nested admin app\n', 'utf8');
  const liffIndex = Buffer.from('<html>liff</html>\n', 'utf8');
  const migration = Buffer.from('-- migration 041\nSELECT 1;\n', 'utf8');

  writeFileSync(join(workerDir, 'index.js'), workerBytes);
  writeFileSync(join(workerAssetsDir, 'index.html'), workerAssetIndex);
  writeFileSync(join(adminDir, 'index.html'), adminIndex);
  writeFileSync(join(adminSubDir, 'app.js'), adminSubApp);
  writeFileSync(join(liffDir, 'index.html'), liffIndex);
  writeFileSync(join(migrationsDir, '041_x.sql'), migration);

  // Build tar.gz using system tar (deterministic enough for testing).
  // COPYFILE_DISABLE=1 suppresses macOS AppleDouble (._*) sidecar files which
  // would otherwise leak into the archive and break hash-determinism tests.
  const tarball = join(tmpDir, 'bundle.tar.gz');
  execSync(`tar czf ${tarball} -C ${stageDir} worker worker-assets admin liff migrations`, {
    stdio: 'pipe',
    env: { ...process.env, COPYFILE_DISABLE: '1' },
  });

  return {
    tmpDir,
    tarball,
    workerBytes,
    workerAssetIndex,
    adminIndex,
    adminSubApp,
    liffIndex,
    migration,
  };
}

// Reference implementation of inject-version's hashDirectory algorithm.
// We re-implement it here so the test asserts byte-for-byte compatibility
// without importing the worker script (which would couple package builds).
function refHashContentMap(map: Map<string, Buffer>): string {
  const keys = Array.from(map.keys()).sort();
  const hash = createHash('sha256');
  const NUL = Buffer.from([0]);
  for (const k of keys) {
    hash.update(Buffer.from(k, 'utf8'));
    hash.update(NUL);
    hash.update(map.get(k)!);
    hash.update(NUL);
  }
  return `sha256:${hash.digest('hex')}`;
}

function refHashBuffer(buf: Buffer): string {
  return `sha256:${createHash('sha256').update(buf).digest('hex')}`;
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('parseBundleStream', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture();
  });

  afterAll(() => {
    if (fixture && existsSync(fixture.tmpDir)) {
      rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it('extracts worker/admin/liff/migrations correctly', async () => {
    const stream = createReadStream(fixture.tarball);
    const parsed = await parseBundleStream(stream);

    expect(parsed.workerJs.equals(fixture.workerBytes)).toBe(true);
    expect(parsed.workerAssetFiles.get('index.html')?.equals(fixture.workerAssetIndex)).toBe(true);
    expect(parsed.adminFiles.get('index.html')?.equals(fixture.adminIndex)).toBe(true);
    expect(parsed.liffFiles.get('index.html')?.equals(fixture.liffIndex)).toBe(true);
    expect(parsed.migrations.get('041_x.sql')?.equals(fixture.migration)).toBe(true);
  });

  it('handles nested admin paths (admin/sub/app.js)', async () => {
    const stream = createReadStream(fixture.tarball);
    const parsed = await parseBundleStream(stream);

    expect(parsed.adminFiles.get('sub/app.js')?.equals(fixture.adminSubApp)).toBe(true);
  });

  it('rejects on stream error', async () => {
    const bogus = createReadStream(join(fixture.tmpDir, 'does-not-exist.tar.gz'));
    await expect(parseBundleStream(bogus)).rejects.toThrow();
  });
});

describe('verifyBundleHashes', () => {
  let fixture: Fixture;

  beforeAll(() => {
    fixture = buildFixture();
  });

  afterAll(() => {
    if (fixture && existsSync(fixture.tmpDir)) {
      rmSync(fixture.tmpDir, { recursive: true, force: true });
    }
  });

  it('produces sha256:<64-hex> format for each hash', async () => {
    const parsed = await parseBundleStream(createReadStream(fixture.tarball));
    const hashes = verifyBundleHashes(parsed);

    const re = /^sha256:[0-9a-f]{64}$/;
    expect(hashes.worker).toMatch(re);
    expect(hashes.workerAssets).toMatch(re);
    expect(hashes.admin).toMatch(re);
    expect(hashes.liff).toMatch(re);
  });

  it('is deterministic (same bundle → same hashes)', async () => {
    const a = await parseBundleStream(createReadStream(fixture.tarball));
    const b = await parseBundleStream(createReadStream(fixture.tarball));
    expect(verifyBundleHashes(a)).toEqual(verifyBundleHashes(b));
  });

  it('matches the inject-version.ts hashDirectory algorithm byte-for-byte', async () => {
    const parsed = await parseBundleStream(createReadStream(fixture.tarball));
    const hashes = verifyBundleHashes(parsed);

    // Worker hash: plain SHA256 of bytes, prefixed sha256:
    expect(hashes.worker).toBe(refHashBuffer(fixture.workerBytes));
    expect(hashes.workerAssets).toBe(refHashContentMap(parsed.workerAssetFiles));

    // Admin/LIFF: directory-style hash (sorted keys, NUL-delimited)
    expect(hashes.admin).toBe(refHashContentMap(parsed.adminFiles));
    expect(hashes.liff).toBe(refHashContentMap(parsed.liffFiles));

    // Spot-check admin against the exact content we know
    const expectedAdmin = (() => {
      const m = new Map<string, Buffer>();
      m.set('index.html', fixture.adminIndex);
      m.set('sub/app.js', fixture.adminSubApp);
      return refHashContentMap(m);
    })();
    expect(hashes.admin).toBe(expectedAdmin);
  });
});

describe('assertHashesMatch', () => {
  const computed = {
    worker: 'sha256:aaa',
    workerAssets: 'sha256:assets',
    admin: 'sha256:bbb',
    liff: 'sha256:ccc',
  };

  it('returns undefined when all hashes match', () => {
    expect(
      assertHashesMatch(computed, {
        worker_hash: 'sha256:aaa',
        worker_assets_hash: 'sha256:assets',
        admin_hash: 'sha256:bbb',
        liff_hash: 'sha256:ccc',
      }),
    ).toBeUndefined();
  });

  it('throws on worker hash mismatch (with both hashes in the message)', () => {
    expect(() =>
      assertHashesMatch(computed, {
        worker_hash: 'sha256:WRONG',
        admin_hash: 'sha256:bbb',
        liff_hash: 'sha256:ccc',
      }),
    ).toThrow(/bundle worker hash mismatch.*sha256:aaa.*sha256:WRONG/);
  });

  it('throws on admin hash mismatch', () => {
    expect(() =>
      assertHashesMatch(computed, {
        worker_hash: 'sha256:aaa',
        admin_hash: 'sha256:WRONG',
        liff_hash: 'sha256:ccc',
      }),
    ).toThrow(/bundle admin hash mismatch/);
  });

  it('throws on worker assets hash mismatch', () => {
    expect(() =>
      assertHashesMatch(computed, {
        worker_hash: 'sha256:aaa',
        worker_assets_hash: 'sha256:WRONG',
        admin_hash: 'sha256:bbb',
        liff_hash: 'sha256:ccc',
      }),
    ).toThrow(/worker assets hash mismatch/);
  });

  it('throws on liff hash mismatch', () => {
    expect(() =>
      assertHashesMatch(computed, {
        worker_hash: 'sha256:aaa',
        admin_hash: 'sha256:bbb',
        liff_hash: 'sha256:WRONG',
      }),
    ).toThrow(/bundle liff hash mismatch/);
  });
});
