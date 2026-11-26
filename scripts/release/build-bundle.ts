#!/usr/bin/env tsx
/**
 * Release bundle builder.
 *
 * Produces a single tarball `bundle.tar.gz` whose top-level entries are the
 * 5 trees that the upgrade flow needs to ship:
 *
 *   worker/index.js          (single bundled Worker JS)
 *   worker-assets/*          (Workers Assets LIFF client)
 *   admin/*                  (Admin static export)
 *   liff/*                   (LIFF static export)
 *   migrations/*.sql         (D1 migrations)
 *
 * Library API:
 *   buildBundle({ workerJs, workerAssetsDir, adminDir, liffDir, migrationsDir, outPath })
 *
 * CLI:
 *   tsx scripts/release/build-bundle.ts \
 *     --worker-js apps/worker/dist/index.js \
 *     --worker-assets apps/worker/dist/client \
 *     --admin apps/web/out \
 *     --liff apps/liff/dist \
 *     --migrations packages/db/migrations \
 *     --out dist/bundle.tar.gz
 */

import { cpSync, mkdirSync, mkdtempSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { argv, exit, stderr, stdout } from 'node:process';

export interface BuildBundleArgs {
  workerJs: string;
  workerAssetsDir: string;
  adminDir: string;
  liffDir: string;
  migrationsDir: string;
  outPath: string;
}

export function buildBundle(args: BuildBundleArgs): void {
  const { workerJs, workerAssetsDir, adminDir, liffDir, migrationsDir, outPath } = args;

  // Staging dir lives in os.tmpdir() so it never pollutes the repo.
  const staging = mkdtempSync(join(tmpdir(), 'line-harness-bundle-'));

  try {
    // 1. worker/index.js (single file).
    const workerOutDir = join(staging, 'worker');
    mkdirSync(workerOutDir, { recursive: true });
    cpSync(workerJs, join(workerOutDir, 'index.js'));

    // 2. worker-assets/ (the Worker-served LIFF client).
    cpSync(workerAssetsDir, join(staging, 'worker-assets'), { recursive: true });

    // 3. admin/ (recursive copy of the static export).
    cpSync(adminDir, join(staging, 'admin'), { recursive: true });

    // 4. liff/ (recursive copy of the LIFF Pages dist).
    cpSync(liffDir, join(staging, 'liff'), { recursive: true });

    // 5. migrations/ (recursive copy of D1 migrations).
    cpSync(migrationsDir, join(staging, 'migrations'), { recursive: true });

    // Ensure outPath parent exists (e.g. `dist/` on first build).
    const absOut = resolve(outPath);
    mkdirSync(dirname(absOut), { recursive: true });

    // Build the tarball. -C makes paths inside the tar relative to staging.
    execSync(
      `tar czf ${shellQuote(absOut)} -C ${shellQuote(staging)} worker worker-assets admin liff migrations`,
      { stdio: 'inherit' },
    );

    // Log final size (stat -> MB, two decimal places).
    const size = statSync(absOut).size;
    const mb = (size / (1024 * 1024)).toFixed(2);
    stdout.write(`bundle: ${absOut} (${mb} MB)\n`);
  } finally {
    // Always clean up staging.
    rmSync(staging, { recursive: true, force: true });
  }
}

function shellQuote(p: string): string {
  // Minimal POSIX-shell single-quote escaping for paths passed to execSync.
  // execSync runs through /bin/sh, so quote to be safe with spaces/specials.
  return `'${p.replace(/'/g, `'\\''`)}'`;
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

interface CliArgs {
  workerJs?: string;
  workerAssets?: string;
  admin?: string;
  liff?: string;
  migrations?: string;
  out?: string;
}

function parseArgs(args: string[]): CliArgs {
  const out: CliArgs = {};
  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const value = args[i + 1];
    if (value === undefined || value.startsWith('--')) {
      stderr.write(`build-bundle: missing value for --${key}\n`);
      exit(2);
    }
    i += 1;
    switch (key) {
      case 'worker-js':
      case 'workerJs':
        out.workerJs = value;
        break;
      case 'worker-assets':
      case 'workerAssets':
        out.workerAssets = value;
        break;
      case 'admin':
        out.admin = value;
        break;
      case 'liff':
        out.liff = value;
        break;
      case 'migrations':
        out.migrations = value;
        break;
      case 'out':
        out.out = value;
        break;
      default:
        stderr.write(`build-bundle: unknown flag --${key}\n`);
        exit(2);
    }
  }
  return out;
}

function requireArg<T extends keyof CliArgs>(args: CliArgs, key: T): NonNullable<CliArgs[T]> {
  const v = args[key];
  if (v === undefined) {
    stderr.write(`build-bundle: --${String(key)} is required\n`);
    stderr.write(
      'Usage: tsx scripts/release/build-bundle.ts --worker-js <file> --worker-assets <dir> --admin <dir> --liff <dir> --migrations <dir> --out <file>\n',
    );
    exit(2);
  }
  return v as NonNullable<CliArgs[T]>;
}

function main(rawArgs: string[]): void {
  const args = parseArgs(rawArgs);
  const workerJs = requireArg(args, 'workerJs');
  const workerAssets = requireArg(args, 'workerAssets');
  const admin = requireArg(args, 'admin');
  const liff = requireArg(args, 'liff');
  const migrations = requireArg(args, 'migrations');
  const out = requireArg(args, 'out');

  buildBundle({
    workerJs,
    workerAssetsDir: workerAssets,
    adminDir: admin,
    liffDir: liff,
    migrationsDir: migrations,
    outPath: out,
  });
}

// Run when invoked as a script — match the inject-version.ts pattern so that
// tsx/ts-node URL rewriting doesn't confuse main detection.
const isCliEntry = (() => {
  if (!argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === argv[1];
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  try {
    main(argv.slice(2));
  } catch (err) {
    stderr.write(`build-bundle: ${(err as Error).message}\n`);
    exit(1);
  }
}
