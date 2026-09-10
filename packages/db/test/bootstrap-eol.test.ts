import { execFileSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { expect, it } from 'vitest';

const PKG_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

it('ignores checkout line endings while still rejecting genuine bootstrap drift', () => {
  // Keep the fixture under this package so the copied generator resolves its
  // installed SQLite dependency, without changing the real schema or output.
  const fixture = mkdtempSync(join(PKG_ROOT, '.bootstrap-eol-test-'));
  try {
    cpSync(join(PKG_ROOT, 'scripts'), join(fixture, 'scripts'), { recursive: true });
    cpSync(join(PKG_ROOT, 'migrations'), join(fixture, 'migrations'), { recursive: true });
    for (const file of ['schema.sql', 'bootstrap.sql', 'bootstrap-meta.json']) {
      cpSync(join(PKG_ROOT, file), join(fixture, file));
    }
    const paths = [
      ...['schema.sql', 'bootstrap.sql', 'bootstrap-meta.json'].map((file) => join(fixture, file)),
      ...readdirSync(join(fixture, 'migrations'))
        .filter((file) => file.endsWith('.sql'))
        .map((file) => join(fixture, 'migrations', file)),
    ];
    for (const path of paths) {
      writeFileSync(path, readFileSync(path, 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, '\r\n'));
    }
    const check = () => execFileSync(process.execPath, [join(fixture, 'scripts', 'generate-bootstrap.mjs'), '--check'], {
      cwd: fixture,
      stdio: 'pipe',
    });
    expect(check).not.toThrow();

    const schemaPath = join(fixture, 'schema.sql');
    writeFileSync(schemaPath, readFileSync(schemaPath, 'utf8') + '\r\nCREATE TABLE eol_drift_probe (id TEXT PRIMARY KEY);\r\n');
    expect(check).toThrow();
  } finally {
    rmSync(fixture, { recursive: true, force: true });
  }
});
