#!/usr/bin/env tsx
/** Deterministically restamp the protected #5229 B1 Worker artifact for B1-R1. */

import { createHash } from 'node:crypto';
import {
  chmodSync, existsSync, lstatSync, mkdirSync, mkdtempSync,
  readFileSync, rmSync, writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stderr, stdout } from 'node:process';

const SOURCE_DIR = '/Users/kensmba/.line-harness-5229-B1-BUILD-20260902';
const SOURCE_FILE = `${SOURCE_DIR}/apps/worker/dist-release-final/index.js`;
const SOURCE_SHA256 = '1355c7bdffc73dd20bc082fd439a1750fd8b7d5831291c1635cd71396c946de4';
const SOURCE_BYTES = 1_350_194;
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B1-R1-BUILD-20260903';
const OUTPUT_FILE = `${OUTPUT_DIR}/apps/worker/dist-release-final/index.js`;
const TARGET_VERSION = '0.19.0-5229.b1.9f3c6c3';
const TARGET_WORKER_HASH = 'sha256:6420c520444baa670973197f6c336b23a511e9dcd8fdbdf24082b61ce24c2b1e';
const OLD_ADMIN_HASH = 'sha256:43e9888fa37af2db1ecdd2f135029ddb570279ebf07373b47d6cb5e62a25ac6c';
const OLD_LIFF_HASH = 'sha256:350e651bacbede38ea9f197d0ae6e29903c5b3b219daccf4c62566310cc7ce17';
export const LEGACY_UNKNOWN_HASH =
  'sha256:0000000000000000000000000000000000000000000000000000000000000000';

function sha256(value: Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}
function count(value: string, needle: string): number {
  return value.split(needle).length - 1;
}

export function restampArtifact(source: Buffer): Buffer {
  if (source.length !== SOURCE_BYTES || sha256(source) !== SOURCE_SHA256) {
    throw new Error('source artifact bytes/hash mismatch');
  }
  const text = source.toString('utf8');
  for (const marker of [TARGET_VERSION, TARGET_WORKER_HASH, OLD_ADMIN_HASH, OLD_LIFF_HASH]) {
    if (count(text, marker) !== 1) throw new Error('source marker occurrence mismatch');
  }
  if (count(text, LEGACY_UNKNOWN_HASH) !== 0) throw new Error('source already contains legacy sentinel');
  const result = Buffer.from(
    text.replace(OLD_ADMIN_HASH, LEGACY_UNKNOWN_HASH).replace(OLD_LIFF_HASH, LEGACY_UNKNOWN_HASH),
    'utf8',
  );
  const output = result.toString('utf8');
  if (result.length !== source.length || count(output, LEGACY_UNKNOWN_HASH) !== 2 ||
      count(output, OLD_ADMIN_HASH) !== 0 || count(output, OLD_LIFF_HASH) !== 0 ||
      count(output, TARGET_VERSION) !== 1 || count(output, TARGET_WORKER_HASH) !== 1) {
    throw new Error('restamped artifact invariant mismatch');
  }
  return result;
}

function protectedSource(): Buffer {
  const dir = lstatSync(SOURCE_DIR);
  const file = lstatSync(SOURCE_FILE);
  if (dir.isSymbolicLink() || !dir.isDirectory() || (dir.mode & 0o777) !== 0o700) {
    throw new Error('source directory protection mismatch');
  }
  if (file.isSymbolicLink() || !file.isFile() || (file.mode & 0o777) !== 0o600) {
    throw new Error('source artifact protection mismatch');
  }
  for (const path of [join(SOURCE_DIR, 'apps'), join(SOURCE_DIR, 'apps/worker'),
    join(SOURCE_DIR, 'apps/worker/dist-release-final')]) {
    const parent = lstatSync(path);
    if (parent.isSymbolicLink() || !parent.isDirectory() || (parent.mode & 0o777) !== 0o755) {
      throw new Error('source artifact parent mismatch');
    }
  }
  return readFileSync(SOURCE_FILE);
}

export function buildArtifact(outputDir = OUTPUT_DIR): {
  file: string;
  sha256: string;
  bytes: number;
  builds_equal: true;
} {
  if (existsSync(outputDir)) throw new Error('output directory already exists');
  const source = protectedSource();
  const scratch = mkdtempSync(join(tmpdir(), 'line-harness-5229-b1-r1-'));
  try {
    chmodSync(scratch, 0o700);
    const first = restampArtifact(source);
    const second = restampArtifact(source);
    const firstFile = join(scratch, 'first.js');
    const secondFile = join(scratch, 'second.js');
    writeFileSync(firstFile, first, { flag: 'wx', mode: 0o600 });
    writeFileSync(secondFile, second, { flag: 'wx', mode: 0o600 });
    const firstReadback = readFileSync(firstFile);
    const secondReadback = readFileSync(secondFile);
    if (!firstReadback.equals(secondReadback) || sha256(firstReadback) !== sha256(secondReadback)) {
      throw new Error('deterministic double build mismatch');
    }

    const outputFile = join(outputDir, 'apps/worker/dist-release-final/index.js');
    mkdirSync(dirname(outputFile), { recursive: true, mode: 0o700 });
    for (const path of [outputDir, join(outputDir, 'apps'), join(outputDir, 'apps/worker'),
      join(outputDir, 'apps/worker/dist-release-final')]) chmodSync(path, 0o700);
    writeFileSync(outputFile, firstReadback, { flag: 'wx', mode: 0o600 });
    chmodSync(outputFile, 0o600);
    const finalReadback = readFileSync(outputFile);
    if (!finalReadback.equals(firstReadback)) throw new Error('final artifact readback mismatch');
    return { file: outputFile, sha256: sha256(finalReadback), bytes: finalReadback.length, builds_equal: true };
  } catch (error) {
    if (existsSync(outputDir)) rmSync(outputDir, { recursive: true, force: true });
    throw error;
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();
if (isCliEntry) {
  try { stdout.write(`${JSON.stringify(buildArtifact())}\n`); }
  catch (error) {
    stderr.write(`worker-b1-r1-artifact-5229: ${(error as Error).message}\n`);
    exit(1);
  }
}
