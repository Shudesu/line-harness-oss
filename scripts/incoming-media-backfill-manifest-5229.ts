#!/usr/bin/env tsx
/** Offline, hash-bound manifest builder for #5229. No provider clients. */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
  type Stats,
} from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const EXPECTED_N = 77;
const EXPECTED_E = 0;
const EXPECTED_B = 27_625_839;
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const SHA256_HEX = /^[a-f0-9]{64}$/;
const MANIFEST_NAME = 'incoming-media-backfill-manifest.json';

export const DEFAULT_OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-M0-20260901';

export interface SourceFileBinding {
  path: string;
  sha256: string;
}

export interface SourceBindings {
  candidates: SourceFileBinding;
  a0Summary: SourceFileBinding;
  contentDigests: SourceFileBinding;
  c0Summary: SourceFileBinding;
  p0Summary: SourceFileBinding;
  directoryEntries: Record<string, string[]>;
}

export const DEFAULT_SOURCE_BINDINGS: SourceBindings = {
  candidates: {
    path: '/Users/kensmba/.line-harness-5229-A0-R4-20260901/d1-candidates.json',
    sha256: '06998bb58bd04fe1d64b437c9770c6a7ee9d85684c5a3b6791dd4e6a372e2cf9',
  },
  a0Summary: {
    path: '/Users/kensmba/.line-harness-5229-A0-R4-20260901/sanitized-summary.json',
    sha256: 'd6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd',
  },
  contentDigests: {
    path: '/Users/kensmba/.line-harness-5229-C0-R1-20260901/r2-content-digests.json',
    sha256: 'db0146a9fc8dfe9bd576f57dafdf9e4d10c64acbfe92b6e84502e7cd5d5ba5f0',
  },
  c0Summary: {
    path: '/Users/kensmba/.line-harness-5229-C0-R1-20260901/sanitized-summary.json',
    sha256: 'c8134d393d9df4e48f7f0a60476995c681501e39c92b311e56187f93ed768769',
  },
  p0Summary: {
    path: '/Users/kensmba/.line-harness-5229-P0-20260901/sanitized-summary.json',
    sha256: '180bb410582445c3fc891c17a87be3ef6c6e58c734c59b9f85c1bb53abc854da',
  },
  directoryEntries: {
    '/Users/kensmba/.line-harness-5229-A0-R4-20260901': [
      'd1-candidates.json', 'r2-incoming-metadata.json', 'sanitized-summary.json',
    ],
    '/Users/kensmba/.line-harness-5229-C0-R1-20260901': [
      'r2-content-digests.json', 'sanitized-summary.json',
    ],
    '/Users/kensmba/.line-harness-5229-P0-20260901': ['sanitized-summary.json'],
  },
};

export interface ManifestSources {
  candidates: unknown;
  a0Summary: unknown;
  contentDigests: unknown;
  c0Summary: unknown;
  p0Summary: unknown;
}

export interface IncomingMediaBackfillEntry {
  incoming_media_id: string;
  messages_log_id: string;
  messages_log_created_at: string;
  line_account_id: string;
  line_message_id: string;
  source_type: 'user';
  source_id: string;
  sender_user_id: string;
  r2_key: string;
  mime_type: 'image/jpeg';
  byte_size: number;
  sha256: string;
  messages_log_content_preimage: string;
}

export interface IncomingMediaBackfillManifest {
  schema_version: 1;
  issue: 5229;
  verified: true;
  worker_url: string;
  backfill_at: string;
  provenance_basis: 'legacy_user_path_reconstruction';
  raw_event_snapshot: false;
  entries: IncomingMediaBackfillEntry[];
}

export interface FileSystemDependencies {
  lstat: (path: string) => Pick<Stats, 'mode' | 'dev' | 'ino' | 'isDirectory' | 'isFile' | 'isSymbolicLink'>;
  readdir: (path: string) => string[];
  readFile: (path: string) => Buffer;
}

export class ManifestStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function object(value: unknown, code: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new ManifestStop(code);
  return value as Record<string, unknown>;
}

function nonempty(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && !value.includes('\0');
}

function assertIsoTimestamp(value: unknown, code: string): asserts value is string {
  if (!nonempty(value) ||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value) ||
      !Number.isFinite(Date.parse(value))) {
    throw new ManifestStop(code);
  }
}

function assertSummaryAggregate(summary: Record<string, unknown>, approvalId: string, code: string): void {
  const aggregates = object(summary.aggregates, `${code}_aggregates`);
  if (summary.approval_id !== approvalId || summary.status !== 'completed' ||
      aggregates.N !== EXPECTED_N || aggregates.E !== EXPECTED_E || aggregates.B !== EXPECTED_B) {
    throw new ManifestStop(code);
  }
}

function assertP0(input: unknown): { completedAt: string; provenanceBasis: 'legacy_user_path_reconstruction' } {
  const summary = object(input, 'p0_shape');
  const aggregates = object(summary.aggregates, 'p0_aggregates');
  const fields = [
    'frozen_rows', 'message_rows', 'message_shape_rows', 'source_user_rows',
    'historical_account_null_rows', 'friend_rows', 'friend_identity_rows',
    'account_fk_rows', 'fully_matched_rows',
  ];
  if (summary.approval_id !== '5229-P0-20260901' || summary.status !== 'completed' ||
      summary.provenance_basis !== 'legacy_user_path_reconstruction' || summary.raw_event_snapshot !== false) {
    throw new ManifestStop('p0_state');
  }
  for (const field of fields) {
    if (typeof aggregates[field] !== 'number' || !Number.isInteger(aggregates[field]) ||
        aggregates[field] !== EXPECTED_N) throw new ManifestStop(`p0_aggregate_${field}`);
  }
  assertIsoTimestamp(summary.completed_at, 'p0_completed_at');
  return {
    completedAt: summary.completed_at,
    provenanceBasis: 'legacy_user_path_reconstruction',
  };
}

function parseLegacyContent(content: string, key: string): { origin: string } {
  let parsed: unknown;
  try { parsed = JSON.parse(content); } catch { throw new ManifestStop('content_json'); }
  const message = object(parsed, 'content_shape');
  if (JSON.stringify(Object.keys(message).sort()) !== JSON.stringify(['originalContentUrl', 'previewImageUrl'])) {
    throw new ManifestStop('content_fields');
  }
  if (!nonempty(message.originalContentUrl) || message.originalContentUrl !== message.previewImageUrl) {
    throw new ManifestStop('content_url_pair');
  }
  let url: URL;
  try { url = new URL(message.originalContentUrl); } catch { throw new ManifestStop('content_url'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
      url.pathname !== `/images/${key}` || url.toString() !== message.originalContentUrl) {
    throw new ManifestStop('content_url');
  }
  return { origin: url.origin };
}

/** Build the deterministic verified manifest from already loaded evidence. */
export function buildIncomingMediaBackfillManifest(sources: ManifestSources): IncomingMediaBackfillManifest {
  const candidatesFile = object(sources.candidates, 'candidate_source_shape');
  const a0 = object(sources.a0Summary, 'a0_shape');
  const digestFile = object(sources.contentDigests, 'content_digest_shape');
  const c0 = object(sources.c0Summary, 'c0_shape');
  assertSummaryAggregate(a0, '5229-A0-R4-20260901', 'a0_state');
  assertSummaryAggregate(c0, '5229-C0-R1-20260901', 'c0_state');
  const provenance = assertP0(sources.p0Summary);

  const candidates = candidatesFile.eligible_rows;
  if (!Array.isArray(candidates) || candidates.length !== EXPECTED_N ||
      !Array.isArray(candidatesFile.excluded_h_rows) || candidatesFile.excluded_h_rows.length !== EXPECTED_E) {
    throw new ManifestStop('candidate_count');
  }
  const digestEntries = digestFile.entries;
  if (!Array.isArray(digestEntries) || digestEntries.length !== EXPECTED_N ||
      digestFile.approval_id !== '5229-C0-R1-20260901' ||
      digestFile.sha256_source !== 'observed_r2_content') throw new ManifestStop('content_digest_state');
  const canonicalDigest = sha256(JSON.stringify(digestEntries));
  if (digestFile.canonical_entries_sha256 !== canonicalDigest ||
      c0.content_evidence_canonical_sha256 !== canonicalDigest ||
      c0.r2_content_digests_raw_sha256 !== DEFAULT_SOURCE_BINDINGS.contentDigests.sha256) {
    throw new ManifestStop('content_digest_link');
  }
  const c0Aggregates = object(c0.aggregates, 'c0_aggregates');
  const mimeCounts = object(c0Aggregates.mime_counts, 'c0_mime_counts');
  if (c0Aggregates.completed_count !== EXPECTED_N ||
      c0Aggregates.accepted_success_bytes !== EXPECTED_B ||
      c0Aggregates.application_read_bytes !== EXPECTED_B || mimeCounts['image/jpeg'] !== EXPECTED_N) {
    throw new ManifestStop('c0_completion');
  }

  const digestByKey = new Map<string, Record<string, unknown>>();
  for (const value of digestEntries) {
    const row = object(value, 'content_entry_shape');
    if (!nonempty(row.key) || digestByKey.has(row.key)) throw new ManifestStop('content_key_duplicate');
    if (row.content_type !== 'image/jpeg' || row.sha256_source !== 'observed_r2_content' ||
        row.custom_sha256_present !== false || row.custom_byte_size_present !== false ||
        row.http_status !== 200 || row.magic_valid !== true ||
        !Number.isSafeInteger(row.size) || (row.size as number) <= 0 ||
        !nonempty(row.a0_etag) || !nonempty(row.observed_sha256) || !SHA256_HEX.test(row.observed_sha256) ||
        (row.content_encoding !== null && row.content_encoding !== 'identity')) {
      throw new ManifestStop('content_entry_evidence');
    }
    if ((row.content_length_present !== true && row.content_length_present !== false) ||
        (row.content_length_present === true && row.content_length !== row.size) ||
        (row.content_length_present === false && row.content_length !== null)) {
      throw new ManifestStop('content_length');
    }
    digestByKey.set(row.key, row);
  }

  const seenLogs = new Set<string>();
  const seenIdentities = new Set<string>();
  const seenKeys = new Set<string>();
  const origins = new Set<string>();
  const accountIds = new Set<string>();
  let totalBytes = 0;
  const entries = candidates.map((value): IncomingMediaBackfillEntry => {
    const row = object(value, 'candidate_shape');
    if (row.record_type !== 'message' || row.messages_log_line_account_id !== null ||
        !nonempty(row.id) || !nonempty(row.line_user_id) || !nonempty(row.authoritative_line_account_id) ||
        !nonempty(row.line_message_id) || !nonempty(row.r2_key) || !nonempty(row.content)) {
      throw new ManifestStop('candidate_field');
    }
    if (!SAFE_IDENTIFIER.test(row.authoritative_line_account_id) || !SAFE_IDENTIFIER.test(row.line_message_id)) {
      throw new ManifestStop('unsafe_identifier');
    }
    assertIsoTimestamp(row.created_at, 'messages_log_created_at');
    if (row.mime_type !== 'image/jpeg' || !Number.isSafeInteger(row.byte_size) || (row.byte_size as number) <= 0) {
      throw new ManifestStop('candidate_media');
    }
    const expectedKey = `incoming-${row.authoritative_line_account_id}-${row.line_message_id}.jpg`;
    if (row.r2_key !== expectedKey) throw new ManifestStop('candidate_key');
    const identity = `${row.authoritative_line_account_id}\0${row.line_message_id}`;
    if (seenLogs.has(row.id) || seenIdentities.has(identity) || seenKeys.has(row.r2_key)) {
      throw new ManifestStop('candidate_duplicate');
    }
    seenLogs.add(row.id);
    seenIdentities.add(identity);
    seenKeys.add(row.r2_key);
    accountIds.add(row.authoritative_line_account_id);
    const evidence = digestByKey.get(row.r2_key);
    if (!evidence || evidence.size !== row.byte_size || evidence.content_type !== row.mime_type) {
      throw new ManifestStop('candidate_content_mismatch');
    }
    const { origin } = parseLegacyContent(row.content, row.r2_key);
    origins.add(origin);
    totalBytes += row.byte_size as number;
    return {
      incoming_media_id: `legacy-${row.id}`,
      messages_log_id: row.id,
      messages_log_created_at: row.created_at,
      line_account_id: row.authoritative_line_account_id,
      line_message_id: row.line_message_id,
      source_type: 'user',
      source_id: row.line_user_id,
      sender_user_id: row.line_user_id,
      r2_key: row.r2_key,
      mime_type: 'image/jpeg',
      byte_size: row.byte_size as number,
      sha256: evidence.observed_sha256 as string,
      messages_log_content_preimage: row.content,
    };
  }).sort((left, right) => left.r2_key < right.r2_key ? -1 : left.r2_key > right.r2_key ? 1 : 0);

  if (digestByKey.size !== seenKeys.size || totalBytes !== EXPECTED_B || origins.size !== 1 || accountIds.size !== 1) {
    throw new ManifestStop('manifest_aggregate');
  }
  return {
    schema_version: 1,
    issue: 5229,
    verified: true,
    worker_url: [...origins][0] as string,
    backfill_at: provenance.completedAt,
    provenance_basis: provenance.provenanceBasis,
    raw_event_snapshot: false,
    entries,
  };
}

function assertReal(stat: ReturnType<FileSystemDependencies['lstat']>, kind: 'directory' | 'file', mode: number): void {
  if (stat.isSymbolicLink() || (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) ||
      (stat.mode & 0o777) !== mode) throw new ManifestStop(`${kind}_mode_or_type`);
}

/** Read only the hash-bound owner-only source set. */
export function loadBoundManifestSources(
  bindings: SourceBindings = DEFAULT_SOURCE_BINDINGS,
  fs: FileSystemDependencies = { lstat: lstatSync, readdir: readdirSync, readFile: readFileSync },
): ManifestSources {
  const allowedPaths = new Set<string>();
  for (const [directory, expectedNames] of Object.entries(bindings.directoryEntries)) {
    assertReal(fs.lstat(directory), 'directory', 0o700);
    const actualNames = fs.readdir(directory).sort();
    if (JSON.stringify(actualNames) !== JSON.stringify([...expectedNames].sort())) {
      throw new ManifestStop('source_directory_entries');
    }
    for (const name of actualNames) {
      const path = join(directory, name);
      allowedPaths.add(path);
      assertReal(fs.lstat(path), 'file', 0o600);
    }
  }
  const read = (binding: SourceFileBinding): unknown => {
    if (dirname(binding.path) === binding.path || basename(binding.path).length === 0 ||
        !allowedPaths.has(binding.path)) throw new ManifestStop('source_path');
    const bytes = fs.readFile(binding.path);
    if (!SHA256_HEX.test(binding.sha256) || sha256(bytes) !== binding.sha256) throw new ManifestStop('source_hash');
    try { return JSON.parse(bytes.toString('utf8')) as unknown; } catch { throw new ManifestStop('source_json'); }
  };
  return {
    candidates: read(bindings.candidates),
    a0Summary: read(bindings.a0Summary),
    contentDigests: read(bindings.contentDigests),
    c0Summary: read(bindings.c0Summary),
    p0Summary: read(bindings.p0Summary),
  };
}

export interface ManifestWriteReceipt {
  fileCount: 1;
  bytes: number;
  sha256: string;
}

/** Exclusively create one owner-only local manifest directory and file. */
export function writeIncomingMediaBackfillManifest(
  manifest: IncomingMediaBackfillManifest,
  outputDir = DEFAULT_OUTPUT_DIR,
): ManifestWriteReceipt {
  if (existsSync(outputDir)) throw new ManifestStop('output_exists');
  mkdirSync(outputDir, { mode: 0o700 });
  chmodSync(outputDir, 0o700);
  assertReal(lstatSync(outputDir), 'directory', 0o700);
  const identity = lstatSync(outputDir);
  if (readdirSync(outputDir).length !== 0) throw new ManifestStop('output_drift');
  const bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  const path = join(outputDir, MANIFEST_NAME);
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  chmodSync(path, 0o600);
  const current = lstatSync(outputDir);
  assertReal(current, 'directory', 0o700);
  assertReal(lstatSync(path), 'file', 0o600);
  if (current.dev !== identity.dev || current.ino !== identity.ino ||
      JSON.stringify(readdirSync(outputDir)) !== JSON.stringify([MANIFEST_NAME]) ||
      !readFileSync(path).equals(bytes)) throw new ManifestStop('output_drift');
  return { fileCount: 1, bytes: bytes.length, sha256: sha256(bytes) };
}

export interface RunDependencies {
  load: () => IncomingMediaBackfillManifest;
  outputDir: string;
  outputExists: (path: string) => boolean;
  write: (manifest: IncomingMediaBackfillManifest, path: string) => ManifestWriteReceipt;
  writeLine: (line: string) => void;
}

export function runManifestBuilder(raw: string[], dependencies?: Partial<RunDependencies>): Record<string, unknown> {
  if (raw.length !== 1 || (raw[0] !== '--preflight-only' && raw[0] !== '--write-local-manifest')) {
    throw new ManifestStop('arguments');
  }
  const deps: RunDependencies = {
    load: () => buildIncomingMediaBackfillManifest(loadBoundManifestSources()),
    outputDir: DEFAULT_OUTPUT_DIR,
    outputExists: existsSync,
    write: writeIncomingMediaBackfillManifest,
    writeLine: (line) => stdout.write(`${line}\n`),
    ...dependencies,
  };
  const manifest = deps.load();
  const totalBytes = manifest.entries.reduce((sum, entry) => sum + entry.byte_size, 0);
  if (raw[0] === '--preflight-only') {
    if (deps.outputExists(deps.outputDir)) throw new ManifestStop('output_exists');
    const result = { status: 'preflight_passed', entry_count: manifest.entries.length, total_bytes: totalBytes, provider_requests: 0, local_writes: 0 };
    deps.writeLine(JSON.stringify(result));
    return result;
  }
  const receipt = deps.write(manifest, deps.outputDir);
  const result = { status: 'completed', entry_count: manifest.entries.length, total_bytes: totalBytes, manifest_sha256: receipt.sha256, local_file_count: receipt.fileCount, provider_requests: 0 };
  deps.writeLine(JSON.stringify(result));
  return result;
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  try { runManifestBuilder(argv.slice(2)); }
  catch (error) {
    const reason = error instanceof ManifestStop ? error.code : 'unexpected_local_error';
    stdout.write(`${JSON.stringify({ status: 'stopped', stop_reason: reason, provider_requests: 0, local_writes: 0 })}\n`);
    exit(1);
  }
}
