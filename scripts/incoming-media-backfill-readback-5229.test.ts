import { createHash } from 'node:crypto';
import { lstatSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import {
  ReadbackStop, buildQueryPlan, parseArgs, run, validateAggregate, validateApproval, validateCompletedReceipts,
  type Aggregate, type Dependencies, type Entry,
} from './incoming-media-backfill-readback-5229.js';
import type { ExactRequest, HttpResponse } from './worker-b1-deploy-5229.js';

const RECEIVED = '2026-09-03T05:51:46.737Z';
const EXPIRES = '2026-09-03T07:51:46.737Z';
const NOW = Date.parse('2026-09-03T06:45:00.000Z');
const HEAD = 'fb2d6bb8e32b32bca9e3b9bff29d62acc53d39ee';
const BODY = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0xff, 0xd9]);
const BODY_SHA = createHash('sha256').update(BODY).digest('hex');
const B0_SHA = '1'.repeat(64);
const B3_SHA = '2'.repeat(64);
const tempDirs: string[] = [];
afterEach(() => { for (const path of tempDirs.splice(0)) rmSync(path, { recursive: true, force: true }); });

function entries(): Entry[] {
  return Array.from({ length: 77 }, (_, index) => ({
    incoming_media_id: `private-media-${index}`,
    messages_log_id: `private-log-${index}`,
    messages_log_created_at: '2026-08-01T00:00:00.000Z',
    line_account_id: 'private-account',
    line_message_id: `private-message-${index}`,
    source_type: 'user', source_id: `private-user-${index}`, sender_user_id: `private-user-${index}`,
    r2_key: `private-key-${index}`, mime_type: 'image/jpeg', byte_size: BODY.length,
    sha256: BODY_SHA,
    replacement_content: JSON.stringify({ originalContentUrl: `private-url-${index}`, previewImageUrl: `private-url-${index}` }),
  }));
}
const aggregate: Aggregate = { frozen_rows: 77, ledger_rows: 77, ledger_exact_rows: 77, rewritten_message_rows: 77, fully_matched_rows: 77 };
function response(status: number, body = Buffer.alloc(0), headers: Record<string, string> = {}): HttpResponse {
  return { status, body, headers };
}
function fixture(): { deps: Dependencies; calls: ExactRequest[]; root: string; d1Calls: number } {
  const root = mkdtempSync(join(tmpdir(), 'lh-5229-b3-readback-')); tempDirs.push(root);
  const calls: ExactRequest[] = []; let d1Calls = 0; const frozen = entries();
  const deps: Dependencies = {
    now: () => NOW, validateLocalState: (head) => head,
    loadInputs: () => ({ entries: frozen, cloudflareToken: 'private-cf-token', serviceToken: `lhim_v1.${'a'.repeat(32)}.${'b'.repeat(64)}` }),
    outputDir: join(root, 'receipt'),
    queryD1: async () => { d1Calls += 1; return aggregate; },
    workerRequest: async (spec) => {
      calls.push(spec); const n = calls.length;
      if (n === 1 || n === 2) return response(401);
      if (n === 3) return response(404);
      if (n === 4) return response(401, Buffer.from('{"error":"Unauthorized"}'));
      const path = spec.path.replace(/\/content$/, '');
      const entry = frozen.find((row) => path.endsWith(`/${row.line_message_id}`));
      if (!entry) throw new Error('unexpected private path');
      const headers = { 'content-type': entry.mime_type, 'content-length': String(entry.byte_size),
        'x-content-sha256': entry.sha256, 'cache-control': 'private, no-store' };
      return spec.method === 'HEAD' ? response(200, Buffer.alloc(0), headers) : response(200, BODY, headers);
    },
  };
  return { deps, calls, root, get d1Calls() { return d1Calls; } };
}
function args(): string[] { return ['--approval-received', RECEIVED, '--approval-expires', EXPIRES, '--approved-harness-head', HEAD,
  '--approved-b0-receipt-sha256', B0_SHA, '--approved-b3-receipt-sha256', B3_SHA]; }

describe('#5229 B3 post-backfill functional readback', () => {
  test('pins the exact blanket interval and exact CLI forms', () => {
    expect(parseArgs(['--preflight-only', '--approved-harness-head', HEAD, '--approved-b0-receipt-sha256', B0_SHA,
      '--approved-b3-receipt-sha256', B3_SHA])).toMatchObject({ preflight: true, b0ReceiptSha256: B0_SHA, b3ReceiptSha256: B3_SHA });
    expect(() => parseArgs([...args().slice(0, -1), 'not-a-sha'])).toThrow(/arguments/);
    expect(() => validateApproval(RECEIVED, EXPIRES, Date.parse(RECEIVED))).not.toThrow();
    expect(() => validateApproval(RECEIVED, EXPIRES, Date.parse(EXPIRES))).toThrow(/approval_inactive/);
    expect(() => validateApproval(RECEIVED, '2026-09-03T07:51:47.000Z', NOW)).toThrow(/approval_identity/);
  });

  test('requires semantically completed and accepted B0/B3 prerequisite receipts', () => {
    const credential = { credential_id: 'credential-1', not_before: '2026-09-03T06:30:00.000Z',
      expires_at: '2026-12-02T06:30:00.000Z', created_at: '2026-09-03T06:30:00.000Z' };
    const b0 = { approval_id: '5229-B0-20260903', approval_received: RECEIVED, approval_expires: EXPIRES,
      approved_harness_head: HEAD, status: 'completed', credential: { ...credential, scope: 'incoming_media_read',
        revoked: false, account_match: true }, request_counts: { d1_query_post: 2, provider_total: 2,
        provider_write_batches: 1, inserted_rows: 1, retry: 0, redirect: 0 }, mutation_stage: 'readback_verified',
      mutation_outcome: 'accepted', reconciliation_required: false };
    const b3 = { approval_id: '5229-B3-20260903', approval_received: RECEIVED, approval_expires: EXPIRES,
      approved_harness_head: HEAD, status: 'completed', anchors: {
        manifest_raw_sha256: 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e' },
      counts: { entries: 77, bytes: 27_625_839, preflight_expectations: 154, apply_operations: 308,
        readback_expectations: 154 }, result: { preflight_passed: 154, ledger_inserted: 77,
        messages_rewritten: 77, readback_passed: 154 }, request_counts: { d1_query_post: 3,
        provider_total: 3, provider_write_batches: 1, retry: 0 }, rollback_required: false };
    expect(() => validateCompletedReceipts(b0, b3, HEAD, credential)).not.toThrow();
    expect(() => validateCompletedReceipts({ ...b0, mutation_outcome: 'unknown' }, b3, HEAD, credential)).toThrow(/b0_receipt_state/);
    expect(() => validateCompletedReceipts(b0, { ...b3, rollback_required: true }, HEAD, credential)).toThrow(/b3_receipt_state/);
    expect(() => validateCompletedReceipts(b0, { ...b3, approved_harness_head: '0'.repeat(40) }, HEAD, credential)).toThrow(/b3_receipt_state/);
  });

  test('builds one parameterized SELECT/CTE plan and validates exact aggregate 77', () => {
    const frozen = entries(); const plan = buildQueryPlan(frozen);
    expect(plan.params).toHaveLength(1);
    expect(plan.sql.trimStart()).toMatch(/^WITH\b/);
    expect(plan.sql).not.toMatch(/\b(?:INSERT|UPDATE|DELETE|REPLACE|DROP|ALTER|CREATE|PRAGMA|ATTACH)\b/i);
    expect(plan.sql).not.toContain(frozen[0].incoming_media_id);
    expect(plan.params[0]).toContain(frozen[0].incoming_media_id);
    expect(validateAggregate(aggregate)).toEqual(aggregate);
    expect(() => validateAggregate({ ...aggregate, rewritten_message_rows: 76 })).toThrow(/d1_aggregate/);
  });

  test('preflight performs no provider or local write', async () => {
    const f = fixture();
    const result = await run(['--preflight-only', '--approved-harness-head', HEAD, '--approved-b0-receipt-sha256', B0_SHA,
      '--approved-b3-receipt-sha256', B3_SHA], f.deps);
    expect(result).toMatchObject({ status: 'preflight_passed', candidate_count: 77,
      provider_requests: 0, provider_writes: 0, local_writes: 0 });
    expect(f.d1Calls).toBe(0); expect(f.calls).toHaveLength(0); expect(readdirSync(f.root)).toEqual([]);
  });

  test('verifies D1 plus all 77 HEAD/GET bodies and the negative auth matrix serially', async () => {
    const f = fixture(); const result = await run(args(), f.deps);
    expect(f.d1Calls).toBe(1); expect(f.calls).toHaveLength(158);
    expect(f.calls.filter((call) => call.method === 'HEAD')).toHaveLength(80);
    expect(f.calls.filter((call) => call.method === 'GET')).toHaveLength(78);
    expect(result).toMatchObject({ status: 'completed', aggregates: {
      d1_ledger_exact_count: 77, rewritten_message_count: 77, authenticated_head_count: 77,
      authenticated_get_count: 77, content_sha256_match_count: 77, jpeg_magic_match_count: 77,
      anonymous_401_count: 1, invalid_credential_401_count: 1, cross_account_404_count: 1,
      unrelated_route_401_count: 1 }, request_counts: { d1_select_post: 1, provider_total: 159,
      retry: 0, redirect: 0, provider_write: 0, r2_direct: 0, local_file_write: 1 } });
    expect((lstatSync(f.deps.outputDir).mode & 0o777)).toBe(0o700);
    const files = readdirSync(f.deps.outputDir); expect(files).toEqual(['sanitized-summary.json']);
    expect((lstatSync(join(f.deps.outputDir, files[0])).mode & 0o777)).toBe(0o600);
    const receipt = readFileSync(join(f.deps.outputDir, files[0]), 'utf8');
    for (const forbidden of ['private-cf-token', 'lhim_v1.', 'private-account', 'private-message-', 'private-key-', 'private-url-']) {
      expect(receipt).not.toContain(forbidden);
    }
  });

  test('stops on first functional failure without retry and writes one sanitized STOP receipt', async () => {
    const f = fixture(); let attempts = 0;
    f.deps.workerRequest = async () => { attempts += 1; throw new Error('private response body'); };
    await expect(run(args(), f.deps)).rejects.toThrow(/provider_or_local_error/);
    expect(attempts).toBe(1); expect(f.d1Calls).toBe(1);
    expect(readdirSync(f.deps.outputDir)).toEqual(['sanitized-summary.json']);
    const receipt = readFileSync(join(f.deps.outputDir, 'sanitized-summary.json'), 'utf8');
    expect(receipt).toContain('provider_or_local_error'); expect(receipt).not.toContain('private response body');
  });
});
