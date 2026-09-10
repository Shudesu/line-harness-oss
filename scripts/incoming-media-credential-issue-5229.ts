#!/usr/bin/env tsx
/** Approval-bound, one-row production D1 credential issuer for #5229. */

import { createHash } from 'node:crypto';
import type { ClientRequest, IncomingMessage } from 'node:http';
import { request, type RequestOptions } from 'node:https';
import { execFileSync } from 'node:child_process';
import {
  existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync,
} from 'node:fs';
import { argv, exit, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const APPROVAL_ID = '5229-B0-20260903';
const APPROVAL_START = '2026-09-03T05:51:46.737Z';
const APPROVAL_END = '2026-09-03T07:51:46.737Z';
const SOURCE_HARNESS_HEAD = 'fb2d6bb8e32b32bca9e3b9bff29d62acc53d39ee';
const HARNESS_WORKTREE = '/Users/kensmba/.line-harness-wt/5229-private-incoming-media';
const ACCOUNTING_WORKTREE = '/Users/kensmba/scripts-wt/5230-line-recovery-deploy';
const ACCOUNTING_HEAD = 'ba9d7785ca0de8135d454c0df1a4c4c20fc6c46f';
const CF_ACCOUNT_ID = '67907592fdf596376bc2097e14a6563a';
const DATABASE_ID = 'c19584d7-e9f1-4d46-83c5-6c0ba96561d1';
const TOKEN_FILE = '/Users/kensmba/.line-harness/.env.local';
const CREDENTIAL_DIR = '/Users/kensmba/.line-harness-5229-B0-CREDENTIAL-20260903';
const MANIFEST_FILE = '/Users/kensmba/.line-harness-5229-M0-20260901/incoming-media-backfill-manifest.json';
const OUTPUT_DIR = '/Users/kensmba/.line-harness-5229-B0-20260903';
const EXPECTED_CREDENTIAL_ID = 'a6f8d1124f07d9ab81d0aa3b8ee080fb';
const EXPECTED_NOT_BEFORE = '2026-09-03T06:30:00.000Z';
const EXPECTED_EXPIRES_AT = '2026-12-02T06:30:00.000Z';
const MAX_RESPONSE_BYTES = 65_536;

const FILE_ANCHORS = {
  manifest: { path: MANIFEST_FILE, sha256: 'cf35a1045040a265019a5afad8c2cefb8994edba684eeaa5dd2fad0b17b1663e' },
  b2: { path: '/Users/kensmba/.line-harness-5229-B2-20260901/sanitized-summary.json', sha256: '5f393930c545582d656c0068ee1d854a01ef8d60e66e1d04e4dca49a0beda95f' },
  b1: { path: '/Users/kensmba/.line-harness-5229-B1-R1-20260903/sanitized-summary.json', sha256: 'a3f5e2c411f5b8656427f363549d5ed0952da3937a1c47e47185ea78faa3f785' },
  v1: { path: '/Users/kensmba/.line-harness-5229-B1-V1-20260903/sanitized-summary.json', sha256: '5e3dcbf0a5ae7b5e883788cfa7ce87f9bb411fa1935d885ae2bb10a2f769d3a6' },
  apply: { path: `${CREDENTIAL_DIR}/apply.sql`, sha256: '45cd7b35a13b095119288986a5d4ec3afcd0fc3a35f50b7445086cf665874d6d' },
  credential: { path: `${CREDENTIAL_DIR}/credential.env`, sha256: '1cd16cce53562f4e33747fc82f93b5052eae9f75216bdb04a5eac2034dd84d89' },
  credentialManifest: { path: `${CREDENTIAL_DIR}/manifest.json`, sha256: 'ce9ccea487842fb7c9f0d38e3cb969faebeee7f0df6e1bac75420fdcf551b4ea' },
} as const;

const MIGRATION_072_NAME = '072_incoming_media_service_credentials.sql';
const MIGRATION_072_CHECKSUM = 'sha256:be4b1730fadd497d0a0d9677bda8626d174aaa08946d1c27e9e68e1549049937';

export interface BoundCredential {
  credentialId: string;
  accountId: string;
  scope: 'incoming_media_read';
  tokenSha256: string;
  label: string;
  notBefore: string;
  expiresAt: string;
  createdAt: string;
}
export interface D1Statement { sql: string; params?: string[] }
export interface D1BatchBody { batch: D1Statement[] }
export interface HttpResponse {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Buffer;
}
export type RequestFunction = (options: RequestOptions, callback: (response: IncomingMessage) => void) => ClientRequest;
export interface Dependencies {
  now: () => number;
  validateLocalState: (approvedHarnessHead: string) => BoundCredential;
  loadToken: () => string;
  outputDir: string;
  post: (body: D1BatchBody, token: string, expiresAt: number) => Promise<HttpResponse>;
}

export class CredentialIssueStop extends Error {
  constructor(readonly code: string) { super(code); }
}

function sha256(value: Buffer | string): string {
  return createHash('sha256').update(value).digest('hex');
}

function assertReal(path: string, kind: 'directory' | 'file', mode: number): void {
  const stat = lstatSync(path);
  if (stat.isSymbolicLink()) throw new CredentialIssueStop(`${kind}_symlink`);
  if (kind === 'directory' ? !stat.isDirectory() : !stat.isFile()) throw new CredentialIssueStop(`${kind}_type`);
  if ((stat.mode & 0o777) !== mode) throw new CredentialIssueStop(`${kind}_mode`);
}

function anchoredBytes(anchor: { path: string; sha256: string }): Buffer {
  assertReal(anchor.path, 'file', 0o600);
  const bytes = readFileSync(anchor.path);
  if (sha256(bytes) !== anchor.sha256) throw new CredentialIssueStop('anchor_hash');
  return bytes;
}

function parseJson(bytes: Buffer, code: string): Record<string, unknown> {
  try {
    const value = JSON.parse(bytes.toString('utf8')) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('shape');
    return value as Record<string, unknown>;
  } catch { throw new CredentialIssueStop(code); }
}

function normalizeIso(value: unknown, code: string): string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(value)) {
    throw new CredentialIssueStop(code);
  }
  const millis = Date.parse(value);
  if (!Number.isFinite(millis)) throw new CredentialIssueStop(code);
  return new Date(millis).toISOString();
}

export function parseOfflineCredential(
  manifestBytes: Buffer, credentialBytes: Buffer, protectedManifestBytes: Buffer,
): BoundCredential {
  const manifest = parseJson(manifestBytes, 'credential_manifest_json');
  const protectedManifest = parseJson(protectedManifestBytes, 'protected_manifest_json');
  const entries = protectedManifest.entries;
  if (!Array.isArray(entries) || entries.length !== 77) throw new CredentialIssueStop('protected_manifest_rows');
  const accounts = new Set(entries.map((entry) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry) ||
        typeof (entry as Record<string, unknown>).line_account_id !== 'string') {
      throw new CredentialIssueStop('protected_manifest_account');
    }
    return (entry as Record<string, unknown>).line_account_id as string;
  }));
  if (accounts.size !== 1) throw new CredentialIssueStop('protected_manifest_account');
  const accountId = manifest.line_account_id;
  const credentialId = manifest.credential_id;
  const tokenSha256 = manifest.token_sha256;
  if (manifest.schema_version !== 1 || manifest.issue !== 5229 || manifest.mode !== 'offline-credential-plan' ||
      manifest.scope !== 'incoming_media_read' || manifest.d1_insert_count !== 1 || manifest.provider_calls !== 0 ||
      manifest.plaintext_location !== 'credential.env only' || accountId !== [...accounts][0] ||
      typeof accountId !== 'string' || !/^[A-Za-z0-9_-]+$/.test(accountId) ||
      credentialId !== EXPECTED_CREDENTIAL_ID || typeof tokenSha256 !== 'string' || !/^[0-9a-f]{64}$/.test(tokenSha256) ||
      typeof manifest.label !== 'string' || manifest.label.length < 1 || manifest.label.length > 80 ||
      /[\u0000-\u001f\u007f]/.test(manifest.label)) {
    throw new CredentialIssueStop('credential_manifest_state');
  }
  const notBefore = normalizeIso(manifest.not_before, 'credential_time');
  const expiresAt = normalizeIso(manifest.expires_at, 'credential_time');
  const createdAt = normalizeIso(manifest.created_at, 'credential_time');
  if (notBefore !== EXPECTED_NOT_BEFORE || expiresAt !== EXPECTED_EXPIRES_AT ||
      createdAt >= expiresAt || notBefore >= expiresAt) throw new CredentialIssueStop('credential_time');
  const lines = credentialBytes.toString('utf8').split(/\r?\n/)
    .filter((line) => line.trim() && !line.trim().startsWith('#'));
  if (lines.length !== 1) throw new CredentialIssueStop('credential_env_shape');
  const match = /^LINE_ACCOUNTING_HARNESS_MEDIA_READ_CREDENTIAL=(lhim_v1\.([0-9a-f]{32})\.([0-9a-f]{64}))$/.exec(lines[0]);
  if (!match || match[2] !== credentialId || sha256(match[1]) !== tokenSha256) {
    throw new CredentialIssueStop('credential_env_state');
  }
  return {
    credentialId, accountId, scope: 'incoming_media_read', tokenSha256,
    label: manifest.label, notBefore, expiresAt, createdAt,
  };
}

function validateReceiptAnchors(): void {
  const b2 = parseJson(anchoredBytes(FILE_ANCHORS.b2), 'b2_json');
  const b2Counts = b2.request_counts as Record<string, unknown> | undefined;
  if (b2.approval_id !== '5229-B2-20260901' || b2.status !== 'completed' ||
      b2Counts?.d1_query_post !== 2 || b2Counts.provider_write_batches !== 1 || b2Counts.retry !== 0) {
    throw new CredentialIssueStop('b2_state');
  }
  const b1 = parseJson(anchoredBytes(FILE_ANCHORS.b1), 'b1_json');
  const b1Mutation = b1.mutation as Record<string, unknown> | undefined;
  if (b1.approval_id !== '5229-B1-R1-20260903' || b1.status !== 'stopped' ||
      b1Mutation?.outcome !== 'accepted' || b1Mutation.put_attempts !== 1) throw new CredentialIssueStop('b1_state');
  const v1 = parseJson(anchoredBytes(FILE_ANCHORS.v1), 'v1_json');
  if (v1.approval_id !== '5229-B1-V1-20260903' || v1.approved_harness_head !== SOURCE_HARNESS_HEAD ||
      v1.status !== 'completed' || v1.disposition !== 'accept_candidate_no_rollback') throw new CredentialIssueStop('v1_state');
}

export function validateLocalState(approvedHarnessHead: string): BoundCredential {
  if (!/^[0-9a-f]{40}$/.test(approvedHarnessHead)) throw new CredentialIssueStop('approved_head');
  const git = (worktree: string, args: string[]): string =>
    execFileSync('git', ['-C', worktree, ...args], { encoding: 'utf8' }).trim();
  if (git(HARNESS_WORKTREE, ['rev-parse', 'HEAD']) !== approvedHarnessHead) throw new CredentialIssueStop('harness_head');
  try {
    execFileSync('git', ['-C', HARNESS_WORKTREE, 'merge-base', '--is-ancestor', SOURCE_HARNESS_HEAD, approvedHarnessHead]);
  } catch { throw new CredentialIssueStop('harness_head'); }
  if (git(HARNESS_WORKTREE, ['status', '--porcelain', '--untracked-files=all']) !== '') throw new CredentialIssueStop('harness_dirty');
  if (git(ACCOUNTING_WORKTREE, ['rev-parse', 'HEAD']) !== ACCOUNTING_HEAD ||
      git(ACCOUNTING_WORKTREE, ['status', '--porcelain', '--untracked-files=all']) !== '') {
    throw new CredentialIssueStop('accounting_state');
  }
  assertReal(CREDENTIAL_DIR, 'directory', 0o700);
  if (JSON.stringify(readdirSync(CREDENTIAL_DIR).sort()) !== JSON.stringify(['apply.sql', 'credential.env', 'manifest.json'])) {
    throw new CredentialIssueStop('credential_entries');
  }
  validateReceiptAnchors();
  anchoredBytes(FILE_ANCHORS.apply);
  return parseOfflineCredential(
    anchoredBytes(FILE_ANCHORS.credentialManifest),
    anchoredBytes(FILE_ANCHORS.credential),
    anchoredBytes(FILE_ANCHORS.manifest),
  );
}

export function parseTokenFile(text: string): string {
  const values: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const match = /^CLOUDFLARE_API_TOKEN=(.*)$/.exec(line);
    if (!match) { if (line.startsWith('CLOUDFLARE_API_TOKEN')) throw new CredentialIssueStop('token_format'); continue; }
    let value = match[1];
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    else if (value.startsWith("'") || value.endsWith("'") || value.startsWith('"') || value.endsWith('"')) throw new CredentialIssueStop('token_format');
    if (!value || /[\r\n\0]/.test(value)) throw new CredentialIssueStop('token_format');
    values.push(value);
  }
  if (values.length !== 1) throw new CredentialIssueStop('token_count');
  return values[0];
}

export function loadToken(): string {
  assertReal(TOKEN_FILE, 'file', 0o600);
  return parseTokenFile(readFileSync(TOKEN_FILE, 'utf8'));
}

function assertion(expression: string): string {
  return `SELECT CASE WHEN (${expression}) THEN 1 ELSE json_extract('{}', '$[') END AS assertion`;
}

export function buildInsertBatch(value: BoundCredential): D1BatchBody {
  return { batch: [
    {
      sql: assertion(`
        (SELECT COUNT(*) FROM _line_harness_migrations WHERE name = ? AND checksum = ?) = 1
        AND (SELECT COUNT(*) FROM sqlite_master WHERE type = 'table' AND name = 'incoming_media_service_credentials') = 1
        AND (SELECT COUNT(*) FROM line_accounts WHERE id = ?) = 1
        AND (SELECT COUNT(*) FROM incoming_media_service_credentials WHERE id = ?) = 0`),
      params: [MIGRATION_072_NAME, MIGRATION_072_CHECKSUM, value.accountId, value.credentialId],
    },
    {
      sql: `INSERT INTO incoming_media_service_credentials
        (id, line_account_id, scope, token_sha256, label, not_before, expires_at, revoked_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
      params: [value.credentialId, value.accountId, value.scope, value.tokenSha256, value.label,
        value.notBefore, value.expiresAt, value.createdAt],
    },
    { sql: assertion('changes() = 1') },
  ] };
}

export function buildReadbackBatch(value: BoundCredential): D1BatchBody {
  return { batch: [{
    sql: `SELECT id, scope, not_before, expires_at, created_at, revoked_at
      FROM incoming_media_service_credentials
      WHERE id = ? AND line_account_id = ? AND scope = ? AND token_sha256 = ?
        AND not_before = ? AND expires_at = ? AND created_at = ? AND revoked_at IS NULL`,
    params: [value.credentialId, value.accountId, value.scope, value.tokenSha256,
      value.notBefore, value.expiresAt, value.createdAt],
  }] };
}

export function validateApprovalWindow(now: number): void {
  const start = Date.parse(APPROVAL_START);
  const end = Date.parse(APPROVAL_END);
  if (end - start !== 7_200_000 || now < start || now >= end) throw new CredentialIssueStop('approval_inactive');
}

export async function postD1(
  bodyValue: D1BatchBody, token: string, expiresAt: number, requestImpl: RequestFunction = request,
): Promise<HttpResponse> {
  const body = Buffer.from(JSON.stringify(bodyValue), 'utf8');
  return await new Promise<HttpResponse>((resolve, reject) => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    const done = (fn: () => void): void => { if (!settled) { settled = true; if (timer) clearTimeout(timer); fn(); } };
    if (Date.now() >= expiresAt) { reject(new CredentialIssueStop('approval_expired')); return; }
    const req = requestImpl({
      protocol: 'https:', hostname: 'api.cloudflare.com', port: 443, method: 'POST',
      path: `/client/v4/accounts/${CF_ACCOUNT_ID}/d1/database/${DATABASE_ID}/query`,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json',
        'Accept-Encoding': 'identity', 'Content-Length': body.length }, agent: false,
    }, (res) => {
      const chunks: Buffer[] = [];
      let bytes = 0;
      let stopped = false;
      res.once('error', (error) => { stopped = true; done(() => reject(error)); });
      res.once('aborted', () => { stopped = true; done(() => reject(new CredentialIssueStop('response_aborted'))); });
      res.on('readable', () => {
        if (stopped) return;
        let chunk: Buffer | null;
        while ((chunk = res.read(Math.min(16_384, MAX_RESPONSE_BYTES - bytes + 1)) as Buffer | null) !== null) {
          bytes += chunk.length;
          if (bytes > MAX_RESPONSE_BYTES) { stopped = true; req.destroy(new CredentialIssueStop('response_oversize')); return; }
          chunks.push(chunk);
        }
      });
      res.on('end', () => { if (!stopped) done(() => resolve({ status: res.statusCode ?? 0, headers: res.headers, body: Buffer.concat(chunks) })); });
    });
    req.once('error', (error) => done(() => reject(error)));
    const remaining = expiresAt - Date.now();
    if (remaining <= 0) { req.destroy(new CredentialIssueStop('approval_expired')); return; }
    timer = setTimeout(() => req.destroy(new CredentialIssueStop('approval_expired')), remaining);
    req.end(body);
  });
}

function parseEnvelope(response: HttpResponse, count: number): Array<{ results: unknown[] }> {
  if (response.status !== 200) throw new CredentialIssueStop('http_status');
  const type = response.headers['content-type'];
  if (typeof type !== 'string' || type.split(';', 1)[0].trim().toLowerCase() !== 'application/json') throw new CredentialIssueStop('content_type');
  const encoding = response.headers['content-encoding'];
  if (encoding !== undefined && encoding !== 'identity') throw new CredentialIssueStop('content_encoding');
  let value: { success?: unknown; result?: unknown };
  try { value = JSON.parse(response.body.toString('utf8')) as typeof value; } catch { throw new CredentialIssueStop('response_json'); }
  if (value.success !== true || !Array.isArray(value.result) || value.result.length !== count || value.result.some((row) =>
    !row || typeof row !== 'object' || (row as Record<string, unknown>).success !== true ||
    !Array.isArray((row as Record<string, unknown>).results))) throw new CredentialIssueStop('response_shape');
  return value.result as Array<{ results: unknown[] }>;
}

function cfRay(response: HttpResponse): string | null {
  const value = response.headers['cf-ray'];
  return typeof value === 'string' ? value : null;
}

export function parseInsertResponse(response: HttpResponse): string | null {
  const rows = parseEnvelope(response, 3);
  for (const index of [0, 2]) {
    if (rows[index].results.length !== 1 || !rows[index].results[0] || typeof rows[index].results[0] !== 'object' ||
        (rows[index].results[0] as Record<string, unknown>).assertion !== 1) throw new CredentialIssueStop('insert_assertion');
  }
  return cfRay(response);
}

export function parseReadbackResponse(response: HttpResponse, expected: BoundCredential): { receipt: Record<string, unknown>; cfRay: string | null } {
  const result = parseEnvelope(response, 1)[0].results;
  if (result.length !== 1 || !result[0] || typeof result[0] !== 'object' || Array.isArray(result[0])) throw new CredentialIssueStop('readback_rows');
  const row = result[0] as Record<string, unknown>;
  if (row.id !== expected.credentialId || row.scope !== expected.scope || row.not_before !== expected.notBefore ||
      row.expires_at !== expected.expiresAt || row.created_at !== expected.createdAt || row.revoked_at !== null ||
      JSON.stringify(Object.keys(row).sort()) !== JSON.stringify(['created_at', 'expires_at', 'id', 'not_before', 'revoked_at', 'scope'])) {
    throw new CredentialIssueStop('readback_state');
  }
  return { receipt: { credential_id: row.id, scope: row.scope, not_before: row.not_before,
    expires_at: row.expires_at, created_at: row.created_at, revoked: false, account_match: true }, cfRay: cfRay(response) };
}

function createOutput(path: string): { dev: number; ino: number } {
  if (existsSync(path)) throw new CredentialIssueStop('output_exists');
  mkdirSync(path, { mode: 0o700 });
  assertReal(path, 'directory', 0o700);
  const stat = lstatSync(path);
  return { dev: stat.dev, ino: stat.ino };
}

function writeSummary(path: string, identity: { dev: number; ino: number }, summary: unknown): void {
  const before = lstatSync(path);
  if (before.dev !== identity.dev || before.ino !== identity.ino || readdirSync(path).length !== 0) throw new CredentialIssueStop('output_drift');
  const file = `${path}/sanitized-summary.json`;
  writeFileSync(file, `${JSON.stringify(summary, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  assertReal(file, 'file', 0o600);
  const after = lstatSync(path);
  if (after.dev !== identity.dev || after.ino !== identity.ino || JSON.stringify(readdirSync(path)) !== JSON.stringify(['sanitized-summary.json'])) {
    throw new CredentialIssueStop('output_drift');
  }
}

export function parseArgs(raw: string[]): { preflightOnly: boolean; approvedHarnessHead: string } {
  if (raw.length === 3 && raw[0] === '--preflight-only' && raw[1] === '--approved-harness-head') {
    return { preflightOnly: true, approvedHarnessHead: raw[2] };
  }
  if (raw.length === 3 && raw[0] === '--execute' && raw[1] === '--approved-harness-head') {
    return { preflightOnly: false, approvedHarnessHead: raw[2] };
  }
  throw new CredentialIssueStop('arguments');
}

function safeReason(error: unknown): string {
  return error instanceof CredentialIssueStop ? error.code : 'provider_or_local_error';
}

export async function run(raw: string[], deps: Dependencies): Promise<Record<string, unknown>> {
  const args = parseArgs(raw);
  const credential = deps.validateLocalState(args.approvedHarnessHead);
  if (existsSync(deps.outputDir)) throw new CredentialIssueStop('output_exists');
  const token = deps.loadToken();
  if (args.preflightOnly) return { approval_id: APPROVAL_ID, status: 'preflight_passed', approved_harness_head: args.approvedHarnessHead,
    credential_artifacts_valid: true, account_bound: true, token_present: token.length > 0,
    provider_requests: 0, provider_writes: 0, local_writes: 0 };
  validateApprovalWindow(deps.now());
  const identity = createOutput(deps.outputDir);
  const startedAt = new Date(deps.now()).toISOString();
  let requests = 0;
  let writeBatches = 0;
  let mutationStage: 'before_write' | 'write_request_started' | 'write_response_accepted' |
    'readback_started' | 'readback_verified' = 'before_write';
  let mutationOutcome: 'not_attempted' | 'unknown' | 'accepted' = 'not_attempted';
  let reconciliationRequired = false;
  try {
    validateApprovalWindow(deps.now());
    mutationStage = 'write_request_started';
    mutationOutcome = 'unknown';
    reconciliationRequired = true;
    requests += 1; writeBatches += 1;
    const writeRay = parseInsertResponse(await deps.post(buildInsertBatch(credential), token, Date.parse(APPROVAL_END)));
    mutationStage = 'write_response_accepted';
    mutationOutcome = 'accepted';
    validateApprovalWindow(deps.now());
    mutationStage = 'readback_started';
    requests += 1;
    const readback = parseReadbackResponse(await deps.post(buildReadbackBatch(credential), token, Date.parse(APPROVAL_END)), credential);
    mutationStage = 'readback_verified';
    reconciliationRequired = false;
    validateApprovalWindow(deps.now());
    const summary = { schema_version: 1, approval_id: APPROVAL_ID, approval_received: APPROVAL_START,
      approval_expires: APPROVAL_END, approved_harness_head: args.approvedHarnessHead, started_at: startedAt,
      completed_at: new Date(deps.now()).toISOString(), status: 'completed', credential: readback.receipt,
      anchor_receipts: { migration_b2_sha256: FILE_ANCHORS.b2.sha256, worker_b1_sha256: FILE_ANCHORS.b1.sha256,
        worker_v1_sha256: FILE_ANCHORS.v1.sha256, protected_manifest_sha256: FILE_ANCHORS.manifest.sha256 },
      request_counts: { d1_query_post: requests, provider_total: requests, provider_write_batches: writeBatches,
        inserted_rows: 1, retry: 0, redirect: 0 }, cf_rays: [writeRay, readback.cfRay],
      mutation_stage: mutationStage, mutation_outcome: mutationOutcome, reconciliation_required: reconciliationRequired,
      forbidden_actions: { deploy: 0, secret_change: 0, credential_revoke: 0, r2: 0, line_send: 0 } };
    writeSummary(deps.outputDir, identity, summary);
    return summary;
  } catch (error) {
    const reason = safeReason(error);
    if (readdirSync(deps.outputDir).length === 0) writeSummary(deps.outputDir, identity, {
      schema_version: 1, approval_id: APPROVAL_ID, approval_received: APPROVAL_START, approval_expires: APPROVAL_END,
      approved_harness_head: args.approvedHarnessHead, started_at: startedAt, completed_at: new Date(deps.now()).toISOString(),
      status: 'stopped', stop_reason: reason, request_counts: { d1_query_post: requests, provider_total: requests,
        provider_write_batches: writeBatches, retry: 0, redirect: 0 },
      mutation_stage: mutationStage, mutation_outcome: mutationOutcome, reconciliation_required: reconciliationRequired,
      forbidden_actions: { deploy: 0, secret_change: 0, credential_revoke: 0, r2: 0, line_send: 0 },
    });
    throw new CredentialIssueStop(reason);
  }
}

const defaultDeps: Dependencies = { now: () => Date.now(), validateLocalState, loadToken,
  outputDir: OUTPUT_DIR, post: (body, token, expiresAt) => postD1(body, token, expiresAt) };

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();
if (isCliEntry) run(argv.slice(2), defaultDeps).then((value) => stdout.write(`${JSON.stringify(value)}\n`)).catch((error: unknown) => {
  stdout.write(`${JSON.stringify({ approval_id: APPROVAL_ID, status: 'stopped', stop_reason: safeReason(error), retry: 0 })}\n`);
  exit(1);
});
