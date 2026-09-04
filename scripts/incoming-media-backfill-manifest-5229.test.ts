import { createHash } from 'node:crypto';
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test, vi } from 'vitest';
import { buildIncomingMediaMigrationArtifacts } from './incoming-media-migration-plan.js';
import {
  DEFAULT_OUTPUT_DIR,
  DEFAULT_SOURCE_BINDINGS,
  ManifestStop,
  buildIncomingMediaBackfillManifest,
  loadBoundManifestSources,
  runManifestBuilder,
  writeIncomingMediaBackfillManifest,
  type IncomingMediaBackfillManifest,
  type ManifestSources,
  type SourceBindings,
} from './incoming-media-backfill-manifest-5229.js';

const N = 77;
const B = 27_625_839;

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

function sources(): ManifestSources {
  const workerUrl = 'https://worker.example';
  const baseSize = Math.floor(B / N);
  const sizes = Array.from({ length: N }, (_, index) => baseSize + (index < B % N ? 1 : 0));
  const candidates = sizes.map((size, index) => {
    const lineAccountId = 'account-safe';
    const lineMessageId = `message-${String(index).padStart(3, '0')}`;
    const key = `incoming-${lineAccountId}-${lineMessageId}.jpg`;
    const legacyUrl = `${workerUrl}/images/${key}`;
    return {
      record_type: 'message',
      id: `log-${String(index).padStart(3, '0')}`,
      friend_id: `friend-${index % 4}`,
      messages_log_line_account_id: null,
      authoritative_line_account_id: lineAccountId,
      line_user_id: `user-${index % 4}`,
      content: JSON.stringify({ originalContentUrl: legacyUrl, previewImageUrl: legacyUrl }),
      created_at: `2026-08-31T12:${String(index % 60).padStart(2, '0')}:00.000Z`,
      line_message_id: lineMessageId,
      r2_key: key,
      mime_type: 'image/jpeg',
      byte_size: size,
    };
  });
  const entries = candidates.map((candidate, index) => ({
    key: candidate.r2_key,
    size: candidate.byte_size,
    a0_etag: `etag-${index}`,
    content_type: 'image/jpeg',
    observed_sha256: index.toString(16).padStart(64, '0'),
    sha256_source: 'observed_r2_content',
    custom_sha256_present: false,
    custom_byte_size_present: false,
    http_status: 200,
    content_length_present: true,
    content_length: candidate.byte_size,
    content_encoding: null,
    magic_valid: true,
    cf_ray: null,
  }));
  const canonical = hash(JSON.stringify(entries));
  const aggregates = { N, E: 0, B };
  const p0Aggregates = Object.fromEntries([
    'frozen_rows', 'message_rows', 'message_shape_rows', 'source_user_rows',
    'historical_account_null_rows', 'friend_rows', 'friend_identity_rows',
    'account_fk_rows', 'fully_matched_rows',
  ].map((field) => [field, N]));
  return {
    candidates: { eligible_rows: candidates, excluded_h_rows: [] },
    a0Summary: { approval_id: '5229-A0-R4-20260901', status: 'completed', aggregates },
    contentDigests: {
      approval_id: '5229-C0-R1-20260901', sha256_source: 'observed_r2_content',
      canonical_entries_sha256: canonical, entries,
    },
    c0Summary: {
      approval_id: '5229-C0-R1-20260901', status: 'completed',
      aggregates: {
        ...aggregates, completed_count: N, accepted_success_bytes: B,
        application_read_bytes: B, mime_counts: { 'image/jpeg': N },
      },
      content_evidence_canonical_sha256: canonical,
      r2_content_digests_raw_sha256: DEFAULT_SOURCE_BINDINGS.contentDigests.sha256,
    },
    p0Summary: {
      approval_id: '5229-P0-20260901', status: 'completed',
      completed_at: '2026-09-01T03:20:58.688Z',
      provenance_basis: 'legacy_user_path_reconstruction', raw_event_snapshot: false,
      aggregates: p0Aggregates,
    },
  };
}

function manifest(): IncomingMediaBackfillManifest {
  return buildIncomingMediaBackfillManifest(sources());
}

describe('incoming media backfill manifest #5229', () => {
  test('builds the deterministic valid-77 user reconstruction and stays migration-plan compatible', () => {
    const first = manifest();
    const second = manifest();
    expect(first).toEqual(second);
    expect(first).toMatchObject({
      schema_version: 1, issue: 5229, verified: true,
      worker_url: 'https://worker.example', backfill_at: '2026-09-01T03:20:58.688Z',
      provenance_basis: 'legacy_user_path_reconstruction', raw_event_snapshot: false,
    });
    expect(first.entries).toHaveLength(N);
    expect(first.entries.reduce((sum, row) => sum + row.byte_size, 0)).toBe(B);
    expect(first.entries.every((row) => row.incoming_media_id === `legacy-${row.messages_log_id}`)).toBe(true);
    expect(first.entries.every((row) => row.source_type === 'user' &&
      row.source_id === row.sender_user_id && row.messages_log_created_at.startsWith('2026-'))).toBe(true);
    expect(Object.keys(buildIncomingMediaMigrationArtifacts(first)).sort()).toEqual([
      'apply.json', 'preflight.json', 'purge.json', 'readback.json', 'rollback.json',
    ]);
  });

  test('matches candidates to observed content evidence by key, not array position', () => {
    const input = sources();
    (input.contentDigests as { entries: unknown[] }).entries.reverse();
    const entries = (input.contentDigests as { entries: unknown[] }).entries;
    const canonical = hash(JSON.stringify(entries));
    (input.contentDigests as { canonical_entries_sha256: string }).canonical_entries_sha256 = canonical;
    (input.c0Summary as { content_evidence_canonical_sha256: string }).content_evidence_canonical_sha256 = canonical;
    expect(buildIncomingMediaBackfillManifest(input).entries).toEqual(manifest().entries);
  });

  test('rejects aggregate and P0 integer drift', () => {
    const byteDrift = sources();
    ((byteDrift.a0Summary as { aggregates: { B: number } }).aggregates).B -= 1;
    expect(() => buildIncomingMediaBackfillManifest(byteDrift)).toThrow(/a0_state/);

    const p0Drift = sources();
    ((p0Drift.p0Summary as { aggregates: Record<string, number | string> }).aggregates).source_user_rows = '77';
    expect(() => buildIncomingMediaBackfillManifest(p0Drift)).toThrow(/p0_aggregate_source_user_rows/);
  });

  test('rejects key, MIME, size, SHA, and JPEG success drift', () => {
    for (const mutate of [
      (input: ManifestSources) => { ((input.contentDigests as { entries: Array<{ key: string }> }).entries[0]).key += '-drift'; },
      (input: ManifestSources) => { ((input.contentDigests as { entries: Array<{ content_type: string }> }).entries[0]).content_type = 'image/png'; },
      (input: ManifestSources) => { ((input.contentDigests as { entries: Array<{ size: number }> }).entries[0]).size += 1; },
      (input: ManifestSources) => { ((input.contentDigests as { entries: Array<{ observed_sha256: string }> }).entries[0]).observed_sha256 = 'x'.repeat(64); },
      (input: ManifestSources) => { ((input.contentDigests as { entries: Array<{ magic_valid: boolean }> }).entries[0]).magic_valid = false; },
    ]) {
      const input = sources();
      mutate(input);
      expect(() => buildIncomingMediaBackfillManifest(input)).toThrow();
    }
  });

  test('rejects URL ambiguity, unsafe identifiers, non-user proof, and duplicates', () => {
    const wrongOrigin = sources();
    const row = (wrongOrigin.candidates as { eligible_rows: Array<{ content: string }> }).eligible_rows[0];
    const content = JSON.parse(row.content);
    content.previewImageUrl = content.previewImageUrl.replace('worker.example', 'other.example');
    row.content = JSON.stringify(content);
    expect(() => buildIncomingMediaBackfillManifest(wrongOrigin)).toThrow(/content_url_pair/);

    const unsafe = sources();
    (unsafe.candidates as { eligible_rows: Array<{ line_message_id: string }> }).eligible_rows[0].line_message_id = 'unsafe/message';
    expect(() => buildIncomingMediaBackfillManifest(unsafe)).toThrow(/unsafe_identifier/);

    const nonUser = sources();
    (nonUser.p0Summary as { aggregates: Record<string, number> }).aggregates.source_user_rows = 76;
    expect(() => buildIncomingMediaBackfillManifest(nonUser)).toThrow(/source_user_rows/);

    const duplicate = sources();
    const rows = (duplicate.candidates as { eligible_rows: Array<Record<string, unknown>> }).eligible_rows;
    rows[1] = { ...rows[0] };
    expect(() => buildIncomingMediaBackfillManifest(duplicate)).toThrow(/candidate_duplicate/);
  });

  test('validates bound paths, exact hashes, directory entries, and owner-only modes', () => {
    const root = mkdtempSync(join(tmpdir(), 'manifest-sources-'));
    const a0 = join(root, 'a0');
    const c0 = join(root, 'c0');
    const p0 = join(root, 'p0');
    try {
      for (const directory of [a0, c0, p0]) mkdirSync(directory, { mode: 0o700 });
      const input = sources();
      const files = {
        candidates: join(a0, 'd1-candidates.json'), a0Summary: join(a0, 'sanitized-summary.json'),
        contentDigests: join(c0, 'r2-content-digests.json'), c0Summary: join(c0, 'sanitized-summary.json'),
        p0Summary: join(p0, 'sanitized-summary.json'),
      };
      writeFileSync(join(a0, 'r2-incoming-metadata.json'), '{}', { mode: 0o600 });
      const bindings = { directoryEntries: {
        [a0]: ['d1-candidates.json', 'r2-incoming-metadata.json', 'sanitized-summary.json'],
        [c0]: ['r2-content-digests.json', 'sanitized-summary.json'], [p0]: ['sanitized-summary.json'],
      } } as SourceBindings;
      for (const key of Object.keys(files) as Array<keyof typeof files>) {
        const bytes = Buffer.from(JSON.stringify(input[key]));
        writeFileSync(files[key], bytes, { mode: 0o600 });
        bindings[key] = { path: files[key], sha256: hash(bytes) };
      }
      expect(loadBoundManifestSources(bindings)).toEqual(input);
      const drift = structuredClone(bindings);
      drift.candidates.sha256 = '0'.repeat(64);
      expect(() => loadBoundManifestSources(drift)).toThrow(/source_hash/);
      const pathDrift = structuredClone(bindings);
      pathDrift.candidates.path = join(root, 'outside.json');
      expect(() => loadBoundManifestSources(pathDrift)).toThrow(/source_path/);
      chmodSync(files.candidates, 0o644);
      expect(() => loadBoundManifestSources(bindings)).toThrow(/file_mode_or_type/);
    } finally { rmSync(root, { recursive: true, force: true }); }
  });

  test('writes exactly one owner-only file and refuses an existing destination', () => {
    const root = mkdtempSync(join(tmpdir(), 'manifest-output-'));
    const output = join(root, 'manifest');
    const previousUmask = process.umask(0o000);
    try {
      const receipt = writeIncomingMediaBackfillManifest(manifest(), output);
      expect(receipt).toMatchObject({ fileCount: 1 });
      expect(lstatSync(output).mode & 0o777).toBe(0o700);
      expect(readdirSync(output)).toEqual(['incoming-media-backfill-manifest.json']);
      const file = join(output, readdirSync(output)[0]);
      expect(lstatSync(file).mode & 0o777).toBe(0o600);
      expect(JSON.parse(readFileSync(file, 'utf8'))).toEqual(manifest());
      expect(() => writeIncomingMediaBackfillManifest(manifest(), output)).toThrow(/output_exists/);
    } finally {
      process.umask(previousUmask);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('preflight writes nothing; explicit write emits no private identifiers to stdout', () => {
    const built = manifest();
    const lines: string[] = [];
    const write = vi.fn();
    const preflight = runManifestBuilder(['--preflight-only'], {
      load: () => built, outputDir: DEFAULT_OUTPUT_DIR, outputExists: () => false,
      write, writeLine: (line) => lines.push(line),
    });
    expect(preflight).toMatchObject({ status: 'preflight_passed', local_writes: 0, provider_requests: 0 });
    expect(write).not.toHaveBeenCalled();

    lines.length = 0;
    write.mockReturnValue({ fileCount: 1, bytes: 123, sha256: 'f'.repeat(64) });
    runManifestBuilder(['--write-local-manifest'], {
      load: () => built, outputDir: DEFAULT_OUTPUT_DIR, outputExists: () => false,
      write, writeLine: (line) => lines.push(line),
    });
    expect(write).toHaveBeenCalledTimes(1);
    const output = lines.join('\n');
    for (const privateValue of ['account-safe', 'message-000', 'user-0', 'log-000', 'worker.example']) {
      expect(output).not.toContain(privateValue);
    }
  });

  test('accepts only the two explicit output modes', () => {
    expect(() => runManifestBuilder([], { load: manifest })).toThrow(ManifestStop);
    expect(() => runManifestBuilder(['--write-local-manifest', '--extra'], { load: manifest })).toThrow(/arguments/);
  });
});
