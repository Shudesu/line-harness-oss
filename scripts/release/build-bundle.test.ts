import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  mkdtempSync,
  rmSync,
  writeFileSync,
  mkdirSync,
  existsSync,
  statSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execSync } from 'node:child_process';
import { buildBundle } from './build-bundle.js';

function makeTmpDir(prefix = 'build-bundle-test-'): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

interface Fixture {
  root: string;
  workerJs: string;
  workerAssetsDir: string;
  adminDir: string;
  liffDir: string;
  migrationsDir: string;
  outPath: string;
}

function makeFixture(): Fixture {
  const root = makeTmpDir();

  // Worker bundled JS (single file).
  const workerJs = join(root, 'worker-dist', 'index.js');
  mkdirSync(join(root, 'worker-dist'), { recursive: true });
  writeFileSync(workerJs, '// fake worker bundle\nexport default {};\n');

  const workerAssetsDir = join(root, 'worker-client');
  mkdirSync(join(workerAssetsDir, 'assets'), { recursive: true });
  writeFileSync(join(workerAssetsDir, 'index.html'), '<html><body>worker client</body></html>');
  writeFileSync(join(workerAssetsDir, 'assets', 'client.js'), 'console.log("client");');

  // Admin static export.
  const adminDir = join(root, 'admin-out');
  mkdirSync(adminDir, { recursive: true });
  writeFileSync(join(adminDir, 'index.html'), '<html><body>admin</body></html>');
  mkdirSync(join(adminDir, 'assets'), { recursive: true });
  writeFileSync(join(adminDir, 'assets', 'app.js'), 'console.log("admin");');

  // LIFF static export.
  const liffDir = join(root, 'liff-dist');
  mkdirSync(liffDir, { recursive: true });
  writeFileSync(join(liffDir, 'index.html'), '<html><body>liff</body></html>');

  // Migrations.
  const migrationsDir = join(root, 'migrations');
  mkdirSync(migrationsDir, { recursive: true });
  writeFileSync(join(migrationsDir, '041_x.sql'), 'CREATE TABLE foo (id INTEGER);');
  writeFileSync(join(migrationsDir, '042_y.sql'), 'CREATE TABLE bar (id INTEGER);');

  // Note: outPath has a non-existent parent ('dist/'), so the test also
  // exercises the `mkdirSync(dirname(outPath), { recursive: true })` branch.
  const outPath = join(root, 'dist', 'bundle.tar.gz');

  return { root, workerJs, workerAssetsDir, adminDir, liffDir, migrationsDir, outPath };
}

describe('buildBundle', () => {
  let fx: Fixture;

  beforeEach(() => {
    fx = makeFixture();
  });

  afterEach(() => {
    rmSync(fx.root, { recursive: true, force: true });
  });

  it('creates a tarball at outPath (and mkdirs the parent dir)', () => {
    buildBundle({
      workerJs: fx.workerJs,
      workerAssetsDir: fx.workerAssetsDir,
      adminDir: fx.adminDir,
      liffDir: fx.liffDir,
      migrationsDir: fx.migrationsDir,
      outPath: fx.outPath,
    });

    expect(existsSync(fx.outPath)).toBe(true);
    expect(statSync(fx.outPath).size).toBeGreaterThan(0);
  });

  it('tarball contains worker/admin/liff/migrations entries with the expected relative paths', () => {
    buildBundle({
      workerJs: fx.workerJs,
      workerAssetsDir: fx.workerAssetsDir,
      adminDir: fx.adminDir,
      liffDir: fx.liffDir,
      migrationsDir: fx.migrationsDir,
      outPath: fx.outPath,
    });

    const listing = execSync(`tar tzf ${fx.outPath}`, { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Each of the 4 trees must appear at the top level of the archive.
    expect(listing).toContain('worker/index.js');
    expect(listing).toContain('worker-assets/index.html');
    expect(listing).toContain('worker-assets/assets/client.js');
    expect(listing).toContain('admin/index.html');
    expect(listing).toContain('admin/assets/app.js');
    expect(listing).toContain('liff/index.html');
    expect(listing).toContain('migrations/041_x.sql');
    expect(listing).toContain('migrations/042_y.sql');

    // Sanity: no absolute paths leaked into the archive.
    for (const entry of listing) {
      expect(entry.startsWith('/')).toBe(false);
      expect(entry).not.toMatch(/(^|\/)\.\.(\/|$)/);
    }
  });

  it('does not crash when migrations dir is empty', () => {
    // Wipe and recreate as empty.
    rmSync(fx.migrationsDir, { recursive: true, force: true });
    mkdirSync(fx.migrationsDir, { recursive: true });

    buildBundle({
      workerJs: fx.workerJs,
      workerAssetsDir: fx.workerAssetsDir,
      adminDir: fx.adminDir,
      liffDir: fx.liffDir,
      migrationsDir: fx.migrationsDir,
      outPath: fx.outPath,
    });

    expect(existsSync(fx.outPath)).toBe(true);

    const listing = execSync(`tar tzf ${fx.outPath}`, { encoding: 'utf8' })
      .split('\n')
      .map((s) => s.trim())
      .filter(Boolean);

    // Worker/admin/liff still present.
    expect(listing).toContain('worker/index.js');
    expect(listing).toContain('worker-assets/index.html');
    expect(listing).toContain('admin/index.html');
    expect(listing).toContain('liff/index.html');

    // migrations/ tree exists but contains no .sql files.
    expect(listing.some((p) => p === 'migrations/' || p === 'migrations')).toBe(true);
    expect(listing.some((p) => p.endsWith('.sql'))).toBe(false);
  });
});
