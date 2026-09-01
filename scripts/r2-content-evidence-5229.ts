#!/usr/bin/env tsx
/**
 * Bounded #5229 production R2 content-evidence collector.
 *
 * This tool is intentionally production-target-specific. It permits only the
 * 77 hash-bound A0-R4 object GETs described by Packet C0-R1. It never lists,
 * HEADs, mutates, retries, logs image bytes, or writes outside its exact
 * owner-only evidence directory.
 */

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import https from 'node:https';
import process, { argv, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const APPROVAL_ID = '5229-C0-R1-20260901';
const ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const BUCKET = 'line-harness-images';
const EXPECTED_N = 77;
const EXPECTED_E = 0;
const EXPECTED_B = 27_625_839;
const MAX_OBJECT_SIZE = 785_458;
const SOURCE_DIR = '/Users/kensmba/.line-harness-5229-A0-R4-20260901';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-C0-R1-20260901';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const SOURCE_HASHES = {
  'd1-candidates.json': '06998bb58bd04fe1d64b437c9770c6a7ee9d85684c5a3b6791dd4e6a372e2cf9',
  'r2-incoming-metadata.json': 'd330d16e8b6d7aab19a08fc4c91d09789b1282e4b74e9f49831d9a7399a4dab8',
  'sanitized-summary.json': 'd6c6394e606ce60282d5a0c3442c534704208d2af5b3eed4f23b0119e3bc24fd',
} as const;

const LEGACY_KEY = /^incoming-[A-Za-z0-9_-]+-[A-Za-z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/;

type SourceName = keyof typeof SOURCE_HASHES;
type PathKind = 'directory' | 'file';

interface Args {
  approvalReceived: string;
  approvalExpires: string;
  preflightOnly: boolean;
}

interface D1Candidate {
  r2_key: string;
  byte_size: number;
  mime_type: string;
}

interface D1Evidence {
  eligible_rows: D1Candidate[];
  excluded_h_rows: unknown[];
}

export interface R2ObjectEvidence {
  key: string;
  size: number;
  etag: string;
  content_type: string;
  custom_sha256: string | null;
  custom_byte_size: number | null;
}

interface R2Evidence {
  objects: R2ObjectEvidence[];
}

interface A0Summary {
  approval_id: string;
  status: string;
  aggregates?: { N?: number; E?: number; B?: number };
}

export interface ContentEvidenceEntry {
  key: string;
  size: number;
  a0_etag: string;
  content_type: string;
  observed_sha256: string;
  sha256_source: 'observed_r2_content';
  custom_sha256_present: false;
  custom_byte_size_present: false;
  http_status: 200;
  content_length_present: boolean;
  content_length: number | null;
  content_encoding: 'identity' | null;
  magic_valid: true;
  cf_ray: string | null;
}

interface EvidenceFileMeta {
  size: number;
  sha256: string;
}

interface CollectorCounters {
  providerRequests: number;
  successfulRequests: number;
  acceptedSuccessBytes: number;
  applicationReadBytes: number;
}

export interface CollectorDependencies {
  loadObjects: () => R2ObjectEvidence[];
  loadToken: () => string;
  outputDir: string;
  collectObject: (
    object: R2ObjectEvidence,
    token: string,
    approvalReceived: string,
    approvalExpires: string,
    counters: CollectorCounters,
  ) => Promise<ContentEvidenceEntry>;
  writeLine: (line: string) => void;
}

export interface DirectoryIdentity {
  dev: number;
  ino: number;
}

export class EvidenceStop extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}

export function sha256(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function assertRealPath(path: string, kind: PathKind, expectedMode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new EvidenceStop(`${kind}_symlink`);
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) {
    throw new EvidenceStop(`${kind}_type`);
  }
  if ((stat.mode & 0o777) !== expectedMode) throw new EvidenceStop(`${kind}_mode`);
}

export function captureDirectoryIdentity(path: string, expectedNames: string[]): DirectoryIdentity {
  assertRealPath(path, 'directory', 0o700);
  const stat = lstatSync(path);
  const names = readdirSync(path).sort();
  if (JSON.stringify(names) !== JSON.stringify([...expectedNames].sort())) {
    throw new EvidenceStop('output_entries');
  }
  return { dev: stat.dev, ino: stat.ino };
}

export function assertPinnedDirectory(path: string, identity: DirectoryIdentity, expectedNames: string[]): void {
  const current = captureDirectoryIdentity(path, expectedNames);
  if (current.dev !== identity.dev || current.ino !== identity.ino) {
    throw new EvidenceStop('output_directory_identity');
  }
}

export function parseTokenFile(path: string): string {
  assertRealPath(path, 'file', 0o600);
  const matches: string[] = [];
  for (const line of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^CLOUDFLARE_API_TOKEN=(.*)$/);
    if (match) matches.push(match[1]);
  }
  if (matches.length !== 1) throw new EvidenceStop('token_assignment_count');
  let value = matches[0];
  if ((value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
  if (!value || /[\0\r\n]/.test(value)) throw new EvidenceStop('token_format');
  return value;
}

export function normalizeStrongEtag(value: string | undefined, expected: string): string {
  if (!value || value.startsWith('W/') || !/^"[^"\r\n]+"$/.test(value)) {
    throw new EvidenceStop('etag_format');
  }
  const normalized = value.slice(1, -1);
  if (normalized !== expected) throw new EvidenceStop('etag_drift');
  return normalized;
}

export function canonicalEntriesDigest(entries: ContentEvidenceEntry[]): string {
  return sha256(JSON.stringify(entries));
}

export function assertApprovalActive(received: string, expires: string, now = Date.now()): void {
  if (now < Date.parse(received)) throw new EvidenceStop('approval_not_started');
  if (now >= Date.parse(expires)) throw new EvidenceStop('approval_expired');
}

function checkedJson(name: SourceName): unknown {
  const path = `${SOURCE_DIR}/${name}`;
  assertRealPath(path, 'file', 0o600);
  const bytes = readFileSync(path);
  if (sha256(bytes) !== SOURCE_HASHES[name]) throw new EvidenceStop('source_hash');
  return JSON.parse(bytes.toString('utf8')) as unknown;
}

function objectRecord(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new EvidenceStop('source_shape');
  }
  return value as Record<string, unknown>;
}

function validateSources(): R2ObjectEvidence[] {
  assertRealPath(SOURCE_DIR, 'directory', 0o700);
  const d1 = objectRecord(checkedJson('d1-candidates.json')) as unknown as D1Evidence;
  const r2 = objectRecord(checkedJson('r2-incoming-metadata.json')) as unknown as R2Evidence;
  const a0 = objectRecord(checkedJson('sanitized-summary.json')) as unknown as A0Summary;
  if (a0.approval_id !== '5229-A0-R4-20260901' || a0.status !== 'completed') {
    throw new EvidenceStop('a0_summary_state');
  }
  if (a0.aggregates?.N !== EXPECTED_N || a0.aggregates.E !== EXPECTED_E ||
      a0.aggregates.B !== EXPECTED_B) throw new EvidenceStop('a0_aggregate');
  if (!Array.isArray(d1.eligible_rows) || d1.eligible_rows.length !== EXPECTED_N ||
      !Array.isArray(d1.excluded_h_rows) || d1.excluded_h_rows.length !== 0) {
    throw new EvidenceStop('d1_count');
  }
  if (!Array.isArray(r2.objects) || r2.objects.length !== EXPECTED_N) {
    throw new EvidenceStop('r2_count');
  }

  const d1ByKey = new Map<string, D1Candidate>();
  for (const row of d1.eligible_rows) {
    if (!row || typeof row.r2_key !== 'string' || d1ByKey.has(row.r2_key)) {
      throw new EvidenceStop('d1_key_duplicate');
    }
    d1ByKey.set(row.r2_key, row);
  }

  const r2ByKey = new Map<string, R2ObjectEvidence>();
  let totalBytes = 0;
  for (const object of r2.objects) {
    if (!object || typeof object.key !== 'string' || !LEGACY_KEY.test(object.key) ||
        object.key.includes('/')) throw new EvidenceStop('legacy_key_grammar');
    if (r2ByKey.has(object.key)) throw new EvidenceStop('r2_key_duplicate');
    if (!Number.isSafeInteger(object.size) || object.size <= 0 || object.size > MAX_OBJECT_SIZE) {
      throw new EvidenceStop('r2_size');
    }
    if (object.content_type !== 'image/jpeg' || typeof object.etag !== 'string' || !object.etag) {
      throw new EvidenceStop('r2_metadata');
    }
    if (object.custom_sha256 !== null || object.custom_byte_size !== null) {
      throw new EvidenceStop('custom_metadata_drift');
    }
    r2ByKey.set(object.key, object);
    totalBytes += object.size;
  }
  if (totalBytes !== EXPECTED_B || d1ByKey.size !== r2ByKey.size) {
    throw new EvidenceStop('source_aggregate');
  }
  for (const [key, object] of r2ByKey) {
    const row = d1ByKey.get(key);
    if (!row || row.byte_size !== object.size || row.mime_type !== object.content_type) {
      throw new EvidenceStop('approved_key_set_mismatch');
    }
  }
  return [...r2ByKey.values()].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
}

function parseArgs(raw: string[]): Args {
  let approvalReceived: string | undefined;
  let approvalExpires: string | undefined;
  let preflightOnly = false;
  for (let index = 0; index < raw.length; index += 1) {
    const flag = raw[index];
    if (flag === '--preflight-only') {
      preflightOnly = true;
      continue;
    }
    if (flag !== '--approval-received' && flag !== '--approval-expires') {
      throw new EvidenceStop('usage');
    }
    const value = raw[index + 1];
    if (!value || value.startsWith('--')) throw new EvidenceStop('usage');
    if (flag === '--approval-received') approvalReceived = value;
    else approvalExpires = value;
    index += 1;
  }
  if (preflightOnly) {
    return { approvalReceived: '', approvalExpires: '', preflightOnly };
  }
  if (!approvalReceived || !approvalExpires || !Number.isFinite(Date.parse(approvalReceived)) ||
      !Number.isFinite(Date.parse(approvalExpires)) || Date.parse(approvalExpires) <= Date.parse(approvalReceived) ||
      Date.parse(approvalExpires) - Date.parse(approvalReceived) !== 2 * 60 * 60 * 1000) {
    throw new EvidenceStop('approval_window');
  }
  return { approvalReceived, approvalExpires, preflightOnly };
}

function writeExclusive(path: string, value: unknown): EvidenceFileMeta {
  const bytes = Buffer.from(`${JSON.stringify(value, null, 2)}\n`, 'utf8');
  writeFileSync(path, bytes, { flag: 'wx', mode: 0o600 });
  assertRealPath(path, 'file', 0o600);
  const reread = readFileSync(path);
  if (reread.length !== bytes.length || sha256(reread) !== sha256(bytes)) {
    throw new EvidenceStop('evidence_verify');
  }
  return { size: reread.length, sha256: sha256(reread) };
}

export function getObject(
  object: R2ObjectEvidence,
  token: string,
  approvalReceived: string,
  approvalExpires: string,
  counters: CollectorCounters,
  requestFactory: typeof https.request = https.request,
): Promise<ContentEvidenceEntry> {
  return new Promise((resolve, reject) => {
    try { assertApprovalActive(approvalReceived, approvalExpires); }
    catch (error) { return reject(error); }
    const encodedKey = encodeURIComponent(object.key);
    if (decodeURIComponent(encodedKey) !== object.key || encodedKey.includes('%2F')) {
      return reject(new EvidenceStop('key_encoding'));
    }
    const path = `/client/v4/accounts/${ACCOUNT_ID}/r2/buckets/${BUCKET}/objects/${encodedKey}`;
    counters.providerRequests += 1;
    let settled = false;
    let request: ReturnType<typeof https.request> | undefined;
    let expiryTimer: ReturnType<typeof setTimeout> | undefined;
    const fail = (code: string, activeRequest?: ReturnType<typeof https.request>, response?: NodeJS.ReadableStream) => {
      if (settled) return;
      settled = true;
      if (expiryTimer) clearTimeout(expiryTimer);
      try { (response as { destroy?: () => void } | undefined)?.destroy?.(); } catch { /* no-op */ }
      try { activeRequest?.destroy(); } catch { /* no-op */ }
      reject(new EvidenceStop(code));
    };
    request = requestFactory({
      protocol: 'https:',
      hostname: 'api.cloudflare.com',
      port: 443,
      method: 'GET',
      path,
      headers: { Authorization: `Bearer ${token}`, 'Accept-Encoding': 'identity' },
      agent: false,
    }, (response) => {
      const status = response.statusCode ?? 0;
      const contentType = typeof response.headers['content-type'] === 'string' ? response.headers['content-type'] : null;
      const lengthRaw = typeof response.headers['content-length'] === 'string' ? response.headers['content-length'] : null;
      const contentEncoding = typeof response.headers['content-encoding'] === 'string' ? response.headers['content-encoding'] : null;
      const cfRay = typeof response.headers['cf-ray'] === 'string' ? response.headers['cf-ray'] : null;
      if (status !== 200) return fail('http_status', request, response);
      if (contentEncoding !== null && contentEncoding !== 'identity') return fail('content_encoding', request, response);
      const acceptedContentEncoding: 'identity' | null = contentEncoding === 'identity' ? 'identity' : null;
      if (contentType !== object.content_type) return fail('content_type', request, response);
      let contentLength: number | null = null;
      if (lengthRaw !== null) {
        if (!/^(0|[1-9][0-9]*)$/.test(lengthRaw)) return fail('content_length_format', request, response);
        contentLength = Number(lengthRaw);
        if (!Number.isSafeInteger(contentLength) || contentLength !== object.size) {
          return fail('content_length', request, response);
        }
      }
      let normalizedEtag: string;
      try { normalizedEtag = normalizeStrongEtag(response.headers.etag, object.etag); }
      catch { return fail('etag_drift', request, response); }

      const hash = createHash('sha256');
      let hashedBytes = 0;
      let readForObject = 0;
      let first = Buffer.alloc(0);
      let last = Buffer.alloc(0);
      response.on('readable', () => {
        while (!settled) {
          const ceilingRemaining = object.size + 1 - readForObject;
          if (ceilingRemaining <= 0) return fail('object_byte_ceiling', request, response);
          const value = response.read(Math.min(ceilingRemaining, 64 * 1024)) as Buffer | string | null;
          if (value === null) break;
          const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
          if (chunk.length > ceilingRemaining) return fail('object_byte_ceiling', request, response);
          readForObject += chunk.length;
          counters.applicationReadBytes += chunk.length;
          if (counters.applicationReadBytes > EXPECTED_B + 1) {
            return fail('aggregate_byte_ceiling', request, response);
          }
          const remaining = object.size - hashedBytes;
          const hashPart = chunk.subarray(0, Math.max(0, Math.min(chunk.length, remaining)));
          if (hashPart.length) {
            hash.update(hashPart);
            if (first.length < 3) first = Buffer.concat([first, hashPart]).subarray(0, 3);
            last = Buffer.concat([last, hashPart]).subarray(-2);
            hashedBytes += hashPart.length;
          }
          if (chunk.length > hashPart.length) return fail('object_oversize', request, response);
        }
      });
      response.on('error', () => fail('response_stream_error', request, response));
      response.on('end', () => {
        if (settled) return;
        if (readForObject !== object.size || hashedBytes !== object.size) {
          return fail('object_byte_count', request, response);
        }
        if (first.length !== 3 || first[0] !== 0xff || first[1] !== 0xd8 || first[2] !== 0xff ||
            last.length !== 2 || last[0] !== 0xff || last[1] !== 0xd9) {
          return fail('jpeg_magic', request, response);
        }
        try { assertApprovalActive(approvalReceived, approvalExpires); }
        catch { return fail('approval_expired', request, response); }
        settled = true;
        clearTimeout(expiryTimer);
        counters.successfulRequests += 1;
        counters.acceptedSuccessBytes += object.size;
        resolve({
          key: object.key,
          size: object.size,
          a0_etag: normalizedEtag,
          content_type: object.content_type,
          observed_sha256: hash.digest('hex'),
          sha256_source: 'observed_r2_content',
          custom_sha256_present: false,
          custom_byte_size_present: false,
          http_status: 200,
          content_length_present: lengthRaw !== null,
          content_length: contentLength,
          content_encoding: acceptedContentEncoding,
          magic_valid: true,
          cf_ray: cfRay,
        });
      });
    });
    const expiryDelay = Math.max(1, Date.parse(approvalExpires) - Date.now());
    expiryTimer = setTimeout(() => fail('approval_expired', request), expiryDelay);
    request.setTimeout(30_000, () => fail('request_timeout', request));
    request.on('error', () => fail('transport_error', request));
    request.end();
  });
}

export async function collectSequentially(
  objects: R2ObjectEvidence[],
  collector: (object: R2ObjectEvidence) => Promise<ContentEvidenceEntry>,
): Promise<ContentEvidenceEntry[]> {
  const entries: ContentEvidenceEntry[] = [];
  for (const object of objects) entries.push(await collector(object));
  return entries;
}

function evidenceFiles(outputDir: string): Array<{ name: string; mode: string; size: number; sha256: string | null }> {
  if (!existsSync(outputDir)) return [];
  try {
    return readdirSync(outputDir).sort().map((name) => {
      const path = `${outputDir}/${name}`;
      const stat = lstatSync(path);
      let digest: string | null = null;
      if (stat.isFile() && !stat.isSymbolicLink()) {
        try { digest = sha256(readFileSync(path)); } catch { digest = null; }
      }
      return { name, mode: (stat.mode & 0o777).toString(8).padStart(4, '0'), size: stat.size, sha256: digest };
    });
  } catch {
    return [];
  }
}

export async function runCollector(raw: string[], dependencies?: Partial<CollectorDependencies>): Promise<void> {
  const deps: CollectorDependencies = {
    loadObjects: validateSources,
    loadToken: () => parseTokenFile(TOKEN_FILE),
    outputDir: OUTPUT_DIR,
    collectObject: (object, token, received, expires, counters) =>
      getObject(object, token, received, expires, counters),
    writeLine: (line) => stdout.write(`${line}\n`),
    ...dependencies,
  };
  const args = parseArgs(raw);
  const objects = deps.loadObjects();
  const token = deps.loadToken();
  if (args.preflightOnly) {
    deps.writeLine(JSON.stringify({ approval_id: APPROVAL_ID, status: 'preflight_passed', source_count: objects.length, total_bytes: objects.reduce((sum, item) => sum + item.size, 0), token_present: token.length > 0, provider_requests: 0, local_writes: 0 }));
    return;
  }
  assertApprovalActive(args.approvalReceived, args.approvalExpires);
  if (existsSync(deps.outputDir)) throw new EvidenceStop('output_path_exists');
  const startedAt = new Date().toISOString();
  const counters = { providerRequests: 0, successfulRequests: 0, acceptedSuccessBytes: 0, applicationReadBytes: 0 };
  const cfRays: string[] = [];
  let completionWriteStarted = false;
  let outputCreated = false;
  let outputIdentity: DirectoryIdentity | null = null;
  try {
    mkdirSync(deps.outputDir, { mode: 0o700 });
    outputCreated = true;
    outputIdentity = captureDirectoryIdentity(deps.outputDir, []);
    const entries = await collectSequentially(objects, async (object) => {
      assertPinnedDirectory(deps.outputDir, outputIdentity as DirectoryIdentity, []);
      const entry = await deps.collectObject(object, token, args.approvalReceived, args.approvalExpires, counters);
      assertPinnedDirectory(deps.outputDir, outputIdentity as DirectoryIdentity, []);
      if (entry.cf_ray) cfRays.push(entry.cf_ray);
      return entry;
    });
    if (counters.providerRequests !== EXPECTED_N || counters.successfulRequests !== EXPECTED_N ||
        counters.acceptedSuccessBytes !== EXPECTED_B) throw new EvidenceStop('completion_counts');
    const canonicalDigest = canonicalEntriesDigest(entries);
    const completedAt = new Date().toISOString();
    completionWriteStarted = true;
    assertPinnedDirectory(deps.outputDir, outputIdentity, []);
    const detailedMeta = writeExclusive(`${deps.outputDir}/r2-content-digests.json`, {
      schema_version: 1,
      approval_id: APPROVAL_ID,
      approval_received: args.approvalReceived,
      approval_expires: args.approvalExpires,
      started_at: startedAt,
      completed_at: completedAt,
      sha256_source: 'observed_r2_content',
      custom_sha256_present: 0,
      custom_byte_size_present: 0,
      canonical_entries_sha256: canonicalDigest,
      entries,
    });
    assertPinnedDirectory(deps.outputDir, outputIdentity, ['r2-content-digests.json']);
    const summaryMeta = writeExclusive(`${deps.outputDir}/sanitized-summary.json`, {
      schema_version: 1,
      approval_id: APPROVAL_ID,
      approval_received: args.approvalReceived,
      approval_expires: args.approvalExpires,
      started_at: startedAt,
      completed_at: completedAt,
      status: 'completed',
      aggregates: {
        N: EXPECTED_N, E: EXPECTED_E, B: EXPECTED_B,
        completed_count: counters.successfulRequests,
        accepted_success_bytes: counters.acceptedSuccessBytes,
        application_read_bytes: counters.applicationReadBytes,
        mime_counts: { 'image/jpeg': EXPECTED_N },
      },
      content_evidence_canonical_sha256: canonicalDigest,
      r2_content_digests_raw_sha256: detailedMeta.sha256,
      custom_sha256_present: 0,
      custom_byte_size_present: 0,
      sha256_source: 'observed_r2_content',
      request_counts: {
        provider_get: counters.providerRequests, successful_get: counters.successfulRequests,
        retry: 0, max_in_flight: 1, provider_writes: 0,
        r2_head: 0, r2_list: 0, d1: 0, worker: 0,
      },
      cf_rays: cfRays,
    });
    assertPinnedDirectory(deps.outputDir, outputIdentity, ['r2-content-digests.json', 'sanitized-summary.json']);
    deps.writeLine(JSON.stringify({ approval_id: APPROVAL_ID, status: 'completed', provider_get_requests: counters.providerRequests, successful_get_requests: counters.successfulRequests, retry_count: 0, accepted_success_bytes: counters.acceptedSuccessBytes, application_read_bytes: counters.applicationReadBytes, provider_writes: 0, content_evidence_canonical_sha256: canonicalDigest, r2_content_digests_raw_sha256: detailedMeta.sha256, sanitized_summary_raw_sha256: summaryMeta.sha256, local_evidence_file_count: 2 }));
  } catch (error) {
    const reason = error instanceof EvidenceStop ? error.code : 'unexpected_local_error';
    if (outputCreated && outputIdentity && !completionWriteStarted && !existsSync(`${deps.outputDir}/sanitized-summary.json`)) {
      try {
        assertPinnedDirectory(deps.outputDir, outputIdentity, []);
        writeExclusive(`${deps.outputDir}/sanitized-summary.json`, {
          schema_version: 1,
          approval_id: APPROVAL_ID,
          approval_received: args.approvalReceived,
          approval_expires: args.approvalExpires,
          started_at: startedAt,
          completed_at: new Date().toISOString(),
          status: 'stopped',
          stop_reason: reason,
          aggregates: { N: EXPECTED_N, E: EXPECTED_E, B: EXPECTED_B, completed_count: counters.successfulRequests, accepted_success_bytes: counters.acceptedSuccessBytes },
          content_evidence_canonical_sha256: null,
          r2_content_digests_raw_sha256: null,
          custom_sha256_present: 0,
          custom_byte_size_present: 0,
          sha256_source: 'observed_r2_content',
          request_counts: { provider_get: counters.providerRequests, successful_get: counters.successfulRequests, retry: 0, max_in_flight: 1, provider_writes: 0, r2_head: 0, r2_list: 0, d1: 0, worker: 0 },
          cf_rays: cfRays,
        });
        assertPinnedDirectory(deps.outputDir, outputIdentity, ['sanitized-summary.json']);
      } catch { /* residual files are reported below and never repaired */ }
    }
    deps.writeLine(JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: reason, provider_get_requests: counters.providerRequests, successful_get_requests: counters.successfulRequests, retry_count: 0, accepted_success_bytes: counters.acceptedSuccessBytes, application_read_bytes: counters.applicationReadBytes, provider_writes: 0, local_evidence_directory_created: outputCreated, files: evidenceFiles(deps.outputDir) }));
    throw new EvidenceStop('already_reported');
  }
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  runCollector(argv.slice(2)).catch((error: unknown) => {
    const reason = error instanceof EvidenceStop ? error.code : 'unexpected_local_error';
    if (reason !== 'already_reported') {
      stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: reason, provider_get_requests: 0, successful_get_requests: 0, retry_count: 0, accepted_success_bytes: 0, application_read_bytes: 0, provider_writes: 0, local_evidence_directory_created: false, local_evidence_file_count: 0 })}\n`);
    }
    process.exitCode = 2;
  });
}
