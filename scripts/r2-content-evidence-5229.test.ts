import { EventEmitter } from 'node:events';
import { chmodSync, existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import https from 'node:https';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { describe, expect, test } from 'vitest';
import {
  assertApprovalActive,
  assertPinnedDirectory,
  assertRealPath,
  canonicalEntriesDigest,
  captureDirectoryIdentity,
  collectSequentially,
  EvidenceStop,
  getObject,
  normalizeStrongEtag,
  parseTokenFile,
  runCollector,
  type ContentEvidenceEntry,
  type R2ObjectEvidence,
} from './r2-content-evidence-5229.js';

const APPROVAL_RECEIVED = new Date(Date.now() - 60_000).toISOString();
const APPROVAL_EXPIRES = new Date(Date.parse(APPROVAL_RECEIVED) + 2 * 60 * 60 * 1000).toISOString();

function objectEvidence(key = 'incoming-account-message.jpg', size = 6): R2ObjectEvidence {
  return { key, size, etag: 'abc123', content_type: 'image/jpeg', custom_sha256: null, custom_byte_size: null };
}

function entryFor(object: R2ObjectEvidence): ContentEvidenceEntry {
  return {
    key: object.key,
    size: object.size,
    a0_etag: object.etag,
    content_type: object.content_type,
    observed_sha256: 'a'.repeat(64),
    sha256_source: 'observed_r2_content',
    custom_sha256_present: false,
    custom_byte_size_present: false,
    http_status: 200,
    content_length_present: true,
    content_length: object.size,
    content_encoding: null,
    magic_valid: true,
    cf_ray: null,
  };
}

function fakeRequestFactory(
  body: Buffer,
  captured: { options?: https.RequestOptions },
  includeLength = true,
): typeof https.request {
  return ((options: https.RequestOptions, callback: (response: Readable & { statusCode: number; headers: Record<string, string> }) => void) => {
    captured.options = options;
    const request = new EventEmitter() as EventEmitter & {
      setTimeout: (ms: number, handler: () => void) => void;
      destroy: () => void;
      end: () => void;
    };
    request.setTimeout = () => undefined;
    request.destroy = () => undefined;
    request.end = () => queueMicrotask(() => {
      const response = new Readable({ read() { /* pushed below */ } }) as Readable & {
        statusCode: number;
        headers: Record<string, string>;
      };
      response.statusCode = 200;
      response.headers = {
        'content-type': 'image/jpeg',
        etag: '"abc123"',
        ...(includeLength ? { 'content-length': String(body.length) } : {}),
      };
      callback(response);
      response.push(body);
      response.push(null);
    });
    return request;
  }) as unknown as typeof https.request;
}

describe('#5229 R2 content evidence safety helpers', () => {
  test('accepts a real mode-0700 directory and rejects file/symlink confusion', () => {
    const root = mkdtempSync(join(tmpdir(), 'r2-evidence-path-'));
    const directory = join(root, 'source');
    const file = join(root, 'file');
    const link = join(root, 'link');
    try {
      mkdirSync(directory, { mode: 0o700 });
      chmodSync(directory, 0o700);
      writeFileSync(file, 'x', { mode: 0o600 });
      chmodSync(file, 0o600);
      symlinkSync(directory, link);
      expect(() => assertRealPath(directory, 'directory', 0o700)).not.toThrow();
      expect(() => assertRealPath(directory, 'file', 0o700)).toThrow(EvidenceStop);
      expect(() => assertRealPath(file, 'directory', 0o600)).toThrow(EvidenceStop);
      expect(() => assertRealPath(link, 'directory', 0o700)).toThrow(EvidenceStop);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('reads one owner-only token assignment without exposing it', () => {
    const root = mkdtempSync(join(tmpdir(), 'r2-evidence-token-'));
    const file = join(root, 'env');
    try {
      writeFileSync(file, "CLOUDFLARE_API_TOKEN='secret-value'\nOTHER=value\n", { mode: 0o600 });
      chmodSync(file, 0o600);
      expect(parseTokenFile(file)).toBe('secret-value');
      writeFileSync(file, 'CLOUDFLARE_API_TOKEN=a\nCLOUDFLARE_API_TOKEN=b\n', { mode: 0o600 });
      expect(() => parseTokenFile(file)).toThrow(/token_assignment_count/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('requires a strong quoted ETag equal to the A0 raw ETag', () => {
    expect(normalizeStrongEtag('"abc123"', 'abc123')).toBe('abc123');
    expect(() => normalizeStrongEtag('W/"abc123"', 'abc123')).toThrow(/etag_format/);
    expect(() => normalizeStrongEtag('"other"', 'abc123')).toThrow(/etag_drift/);
  });

  test('accepts only the active half-open two-hour approval interval', () => {
    const received = '2026-09-01T10:00:00+09:00';
    const expires = '2026-09-01T12:00:00+09:00';
    expect(() => assertApprovalActive(received, expires, Date.parse(received) - 1)).toThrow(/approval_not_started/);
    expect(() => assertApprovalActive(received, expires, Date.parse(received))).not.toThrow();
    expect(() => assertApprovalActive(received, expires, Date.parse(expires) - 1)).not.toThrow();
    expect(() => assertApprovalActive(received, expires, Date.parse(expires))).toThrow(/approval_expired/);
  });

  test('pins output directory identity and exact allowed entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'r2-evidence-output-'));
    const directory = join(root, 'evidence');
    try {
      mkdirSync(directory, { mode: 0o700 });
      chmodSync(directory, 0o700);
      const identity = captureDirectoryIdentity(directory, []);
      expect(() => assertPinnedDirectory(directory, identity, [])).not.toThrow();
      writeFileSync(join(directory, 'unexpected'), 'x', { mode: 0o600 });
      expect(() => assertPinnedDirectory(directory, identity, [])).toThrow(/output_entries/);
      rmSync(directory, { recursive: true, force: true });
      mkdirSync(directory, { mode: 0o700 });
      chmodSync(directory, 0o700);
      expect(() => assertPinnedDirectory(directory, identity, [])).toThrow(/output_directory_identity/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('canonical digest fixes nullable optional fields instead of omitting them', () => {
    const entry: ContentEvidenceEntry = {
      key: 'incoming-account-message.jpg',
      size: 4,
      a0_etag: 'abc',
      content_type: 'image/jpeg',
      observed_sha256: 'a'.repeat(64),
      sha256_source: 'observed_r2_content',
      custom_sha256_present: false,
      custom_byte_size_present: false,
      http_status: 200,
      content_length_present: false,
      content_length: null,
      content_encoding: null,
      magic_valid: true,
      cf_ray: null,
    };
    expect(canonicalEntriesDigest([entry])).toMatch(/^[a-f0-9]{64}$/);
    expect(JSON.stringify(entry)).toContain('"content_length":null');
    expect(JSON.stringify(entry)).toContain('"content_encoding":null');
    expect(JSON.stringify(entry)).toContain('"cf_ray":null');
  });

  test('GET uses only approved headers and paused bounded reads for valid JPEG bytes', async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
    const captured: { options?: https.RequestOptions } = {};
    const counters = { providerRequests: 0, successfulRequests: 0, acceptedSuccessBytes: 0, applicationReadBytes: 0 };
    const result = await getObject(
      objectEvidence(), 'test-token', APPROVAL_RECEIVED, APPROVAL_EXPIRES,
      counters, fakeRequestFactory(body, captured),
    );
    expect(result).toMatchObject({ http_status: 200, size: 6, magic_valid: true });
    expect(counters).toEqual({ providerRequests: 1, successfulRequests: 1, acceptedSuccessBytes: 6, applicationReadBytes: 6 });
    expect(captured.options?.method).toBe('GET');
    expect(captured.options?.headers).toEqual({ Authorization: 'Bearer test-token', 'Accept-Encoding': 'identity' });
  });

  test('GET accepts at most one oversize sentinel byte and stops without retry', async () => {
    const body = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9, 0x01]);
    const counters = { providerRequests: 0, successfulRequests: 0, acceptedSuccessBytes: 0, applicationReadBytes: 0 };
    await expect(getObject(
      objectEvidence(), 'test-token', APPROVAL_RECEIVED, APPROVAL_EXPIRES,
      counters, fakeRequestFactory(body, {}, false),
    )).rejects.toThrow(/object_oversize/);
    expect(counters).toEqual({ providerRequests: 1, successfulRequests: 0, acceptedSuccessBytes: 0, applicationReadBytes: 7 });
  });

  test('sequential collector never overlaps requests and stops on the first failure', async () => {
    const objects = [objectEvidence('incoming-a-1.jpg'), objectEvidence('incoming-a-2.jpg')];
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    await expect(collectSequentially(objects, async (object) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      active -= 1;
      if (calls === 1) throw new EvidenceStop('first_failure');
      return entryFor(object);
    })).rejects.toThrow(/first_failure/);
    expect(calls).toBe(1);
    expect(maxActive).toBe(1);
  });

  test('preflight main performs zero provider calls and zero local writes', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r2-evidence-preflight-'));
    const output = join(root, 'output');
    let providerCalls = 0;
    const lines: string[] = [];
    try {
      await runCollector(['--preflight-only'], {
        loadObjects: () => [objectEvidence()],
        loadToken: () => 'test-token',
        outputDir: output,
        collectObject: async (object) => { providerCalls += 1; return entryFor(object); },
        writeLine: (line) => lines.push(line),
      });
      expect(providerCalls).toBe(0);
      expect(existsSync(output)).toBe(false);
      expect(JSON.parse(lines[0])).toMatchObject({ status: 'preflight_passed', provider_requests: 0, local_writes: 0 });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('main completes exactly 77 sequential items and writes only two owner-only files', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r2-evidence-main-'));
    const output = join(root, 'output');
    const objects = Array.from({ length: 77 }, (_, index) =>
      objectEvidence(`incoming-account-message-${index}.jpg`, index === 76 ? 27_625_839 - 76 : 1));
    let active = 0;
    let maxActive = 0;
    let calls = 0;
    try {
      await runCollector(['--approval-received', APPROVAL_RECEIVED, '--approval-expires', APPROVAL_EXPIRES], {
        loadObjects: () => objects,
        loadToken: () => 'test-token',
        outputDir: output,
        collectObject: async (object, _token, _received, _expires, counters) => {
          calls += 1;
          active += 1;
          maxActive = Math.max(maxActive, active);
          counters.providerRequests += 1;
          counters.successfulRequests += 1;
          counters.acceptedSuccessBytes += object.size;
          counters.applicationReadBytes += object.size;
          await Promise.resolve();
          active -= 1;
          return entryFor(object);
        },
        writeLine: () => undefined,
      });
      expect(calls).toBe(77);
      expect(maxActive).toBe(1);
      expect(readdirSync(output).sort()).toEqual(['r2-content-digests.json', 'sanitized-summary.json']);
      assertRealPath(output, 'directory', 0o700);
      assertRealPath(join(output, 'r2-content-digests.json'), 'file', 0o600);
      assertRealPath(join(output, 'sanitized-summary.json'), 'file', 0o600);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('main STOP leaves only a sanitized summary and never retries', async () => {
    const root = mkdtempSync(join(tmpdir(), 'r2-evidence-stop-'));
    const output = join(root, 'output');
    let calls = 0;
    try {
      await expect(runCollector(['--approval-received', APPROVAL_RECEIVED, '--approval-expires', APPROVAL_EXPIRES], {
        loadObjects: () => [objectEvidence()],
        loadToken: () => 'test-token',
        outputDir: output,
        collectObject: async () => { calls += 1; throw new EvidenceStop('provider_failure'); },
        writeLine: () => undefined,
      })).rejects.toThrow(/already_reported/);
      expect(calls).toBe(1);
      expect(readdirSync(output)).toEqual(['sanitized-summary.json']);
      const summary = JSON.parse(readFileSync(join(output, 'sanitized-summary.json'), 'utf8'));
      expect(summary).toMatchObject({ status: 'stopped', stop_reason: 'provider_failure', content_evidence_canonical_sha256: null });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
