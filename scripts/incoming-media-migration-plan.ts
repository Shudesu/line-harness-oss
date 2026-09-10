#!/usr/bin/env tsx
/**
 * Offline artifact builder for the #5229 historical incoming-media cutover.
 *
 * It deliberately has no Cloudflare, R2, D1, or LINE client. A separately
 * collected, redacted, and verified manifest is the sole input; this script
 * validates it and emits reviewable conditional SQL plus exact purge/readback
 * plans. It is not an executor.
 */

import { createHash } from 'node:crypto';
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const IMAGE_MIME_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);
const SOURCE_TYPES = new Set(['user', 'group', 'room']);
const SAFE_IDENTIFIER = /^[A-Za-z0-9_-]+$/;
const LEGACY_EXTENSION_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
};
const OWNER_DIRECTORY_MODE = 0o700;
const OWNER_FILE_MODE = 0o600;
const EXPECTED_ENTRY_COUNT = 77;
const EXPECTED_TOTAL_BYTES = 27_625_839;

export interface IncomingMediaMigrationEntry {
  incoming_media_id: string;
  messages_log_id: string;
  messages_log_created_at: string;
  line_account_id: string;
  line_message_id: string;
  source_type: 'user' | 'group' | 'room';
  source_id: string;
  sender_user_id: string | null;
  r2_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  messages_log_content_preimage: string;
}

export interface IncomingMediaMigrationManifest {
  schema_version: 1;
  issue: 5229;
  verified: true;
  provenance_basis: 'legacy_user_path_reconstruction';
  raw_event_snapshot: false;
  worker_url: string;
  backfill_at: string;
  entries: IncomingMediaMigrationEntry[];
}

interface SqlOperation {
  name: string;
  sql: string;
  expected_changes?: number;
  expected_rows?: number;
}

interface PlannedEntry {
  messages_log_id: string;
  messages_log_created_at: string;
  line_account_id: string;
  line_message_id: string;
  legacy_public_url: string;
  private_content_url: string;
  r2_key: string;
  mime_type: string;
  byte_size: number;
  sha256: string;
  messages_log_content_preimage_sha256: string;
  messages_log_content_replacement_sha256: string;
}

export interface IncomingMediaMigrationArtifacts {
  'preflight.json': string;
  'apply.json': string;
  'rollback.json': string;
  'purge.json': string;
  'readback.json': string;
}

function digest(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function json(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function sqlLiteral(value: string | number | null): string {
  if (value === null) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${value.replaceAll("'", "''")}'`;
}

function requireString(value: unknown, field: string): asserts value is string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new Error(`${field} must be a non-empty string`);
  }
}

function requireTimestamp(value: unknown, field: string): asserts value is string {
  requireString(value, field);
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${field} must be an ISO-8601 timestamp`);
  }
}

function changesAssertionSql(expected: number, operationName: string): string {
  // D1 batch() is transactional, but a zero-row UPDATE is not itself an SQL
  // error. Force an error on an unexpected changes() count so D1 rolls back
  // the entire 77-item batch instead of committing a partial cutover.
  return `SELECT CASE WHEN changes() = ${expected} THEN 1 ELSE json_extract('5229-${operationName}-changes-mismatch', '$') END AS exact_change_count;`;
}

function privateContentUrl(workerUrl: string, accountId: string, messageId: string): string {
  return new URL(
    `/api/incoming-media/${encodeURIComponent(accountId)}/${encodeURIComponent(messageId)}/content`,
    workerUrl,
  ).toString();
}

function legacyPublicUrl(workerUrl: string, r2Key: string): string {
  return new URL(`/images/${encodeURIComponent(r2Key)}`, workerUrl).toString();
}

function expectedLegacyR2Key(accountId: string, messageId: string, mimeType: string): string {
  return `incoming-${accountId}-${messageId}.${LEGACY_EXTENSION_BY_MIME[mimeType]}`;
}

function assertOwnerOnlyDirectory(outputDir: string): void {
  const stat = lstatSync(outputDir);
  if (!stat.isDirectory() || stat.isSymbolicLink()) {
    throw new Error(`output directory must be a real directory: ${outputDir}`);
  }
  if ((stat.mode & 0o777) !== OWNER_DIRECTORY_MODE) {
    throw new Error(`output directory must have mode 0700: ${outputDir}`);
  }
}

function assertOwnerOnlyFile(path: string): void {
  const stat = lstatSync(path);
  if (!stat.isFile() || stat.isSymbolicLink() || (stat.mode & 0o777) !== OWNER_FILE_MODE) {
    throw new Error(`artifact file must be a real mode-0600 file: ${path}`);
  }
}

function validateManifest(input: unknown): { manifest: IncomingMediaMigrationManifest; entries: PlannedEntry[] } {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('manifest must be a JSON object');
  }
  const manifest = input as Partial<IncomingMediaMigrationManifest>;
  if (manifest.schema_version !== 1 || manifest.issue !== 5229 || manifest.verified !== true) {
    throw new Error('manifest must set schema_version=1, issue=5229, and verified=true');
  }
  if (manifest.provenance_basis !== 'legacy_user_path_reconstruction' || manifest.raw_event_snapshot !== false) {
    throw new Error('manifest must set provenance_basis=legacy_user_path_reconstruction and raw_event_snapshot=false');
  }
  requireString(manifest.worker_url, 'worker_url');
  requireTimestamp(manifest.backfill_at, 'backfill_at');
  if (!Array.isArray(manifest.entries) || manifest.entries.length !== EXPECTED_ENTRY_COUNT) {
    throw new Error(`entries must contain exactly ${EXPECTED_ENTRY_COUNT} rows for #5229`);
  }
  const workerUrl = new URL(manifest.worker_url);
  if (workerUrl.protocol !== 'https:' || workerUrl.username || workerUrl.password || workerUrl.pathname !== '/') {
    throw new Error('worker_url must be an https origin without credentials or a path');
  }
  const seenIdentity = new Set<string>();
  const seenLog = new Set<string>();
  const entries = manifest.entries.map((entry, index): PlannedEntry => {
    const prefix = `entries[${index}]`;
    if (typeof entry !== 'object' || entry === null) throw new Error(`${prefix} must be an object`);
    const row = entry as Partial<IncomingMediaMigrationEntry>;
    for (const field of [
      'incoming_media_id', 'messages_log_id', 'line_account_id', 'line_message_id',
      'source_type', 'source_id', 'r2_key', 'mime_type', 'sha256', 'messages_log_content_preimage',
    ] as const) requireString(row[field], `${prefix}.${field}`);
    requireTimestamp(row.messages_log_created_at, `${prefix}.messages_log_created_at`);
    if (row.sender_user_id !== null && typeof row.sender_user_id !== 'string') {
      throw new Error(`${prefix}.sender_user_id must be a string or null`);
    }
    if (!SAFE_IDENTIFIER.test(row.line_account_id)) {
      throw new Error(`${prefix}.line_account_id must match the private-route SAFE_IDENTIFIER`);
    }
    if (!SAFE_IDENTIFIER.test(row.line_message_id)) {
      throw new Error(`${prefix}.line_message_id must match the private-route SAFE_IDENTIFIER`);
    }
    if (!SOURCE_TYPES.has(row.source_type)) throw new Error(`${prefix}.source_type is invalid`);
    if (row.source_type !== 'user' || row.sender_user_id !== row.source_id) {
      throw new Error(`${prefix} must preserve the verified legacy user-path source and sender identity`);
    }
    if (row.incoming_media_id !== `legacy-${row.messages_log_id}`) {
      throw new Error(`${prefix}.incoming_media_id must be the deterministic legacy-messages_log identity`);
    }
    if (!IMAGE_MIME_TYPES.has(row.mime_type)) throw new Error(`${prefix}.mime_type is not an allowed image MIME type`);
    if (row.r2_key !== expectedLegacyR2Key(row.line_account_id, row.line_message_id, row.mime_type)) {
      throw new Error(`${prefix}.r2_key must exactly match the historical account/message/image-extension key`);
    }
    if (!Number.isSafeInteger(row.byte_size) || row.byte_size <= 0) {
      throw new Error(`${prefix}.byte_size must be a positive safe integer`);
    }
    if (!/^[a-f0-9]{64}$/.test(row.sha256)) throw new Error(`${prefix}.sha256 must be lowercase SHA-256 hex`);
    const identity = `${row.line_account_id}\0${row.line_message_id}`;
    if (seenIdentity.has(identity)) throw new Error(`${prefix} duplicates a line account/message identity`);
    if (seenLog.has(row.messages_log_id)) throw new Error(`${prefix} duplicates messages_log_id`);
    seenIdentity.add(identity);
    seenLog.add(row.messages_log_id);

    let preimage: unknown;
    try {
      preimage = JSON.parse(row.messages_log_content_preimage);
    } catch {
      throw new Error(`${prefix}.messages_log_content_preimage must be JSON`);
    }
    if (typeof preimage !== 'object' || preimage === null || Array.isArray(preimage)) {
      throw new Error(`${prefix}.messages_log_content_preimage must be an object`);
    }
    const message = preimage as Record<string, unknown>;
    const keys = Object.keys(message).sort();
    if (keys.length !== 2 || keys[0] !== 'originalContentUrl' || keys[1] !== 'previewImageUrl') {
      throw new Error(`${prefix}.messages_log_content_preimage must contain only the two image URL fields`);
    }
    const legacyUrl = legacyPublicUrl(workerUrl.toString(), row.r2_key);
    if (message.originalContentUrl !== legacyUrl || message.previewImageUrl !== legacyUrl) {
      throw new Error(`${prefix}.messages_log_content_preimage URLs must exactly match the manifest legacy URL`);
    }
    const privateUrl = privateContentUrl(workerUrl.toString(), row.line_account_id, row.line_message_id);
    const replacement = JSON.stringify({ originalContentUrl: privateUrl, previewImageUrl: privateUrl });
    return {
      messages_log_id: row.messages_log_id,
      messages_log_created_at: row.messages_log_created_at,
      line_account_id: row.line_account_id,
      line_message_id: row.line_message_id,
      legacy_public_url: legacyUrl,
      private_content_url: privateUrl,
      r2_key: row.r2_key,
      mime_type: row.mime_type,
      byte_size: row.byte_size,
      sha256: row.sha256,
      messages_log_content_preimage_sha256: digest(row.messages_log_content_preimage),
      messages_log_content_replacement_sha256: digest(replacement),
    };
  });
  const totalBytes = manifest.entries.reduce((sum, entry) => sum + entry.byte_size, 0);
  if (totalBytes !== EXPECTED_TOTAL_BYTES || manifest.entries.some((entry) => entry.mime_type !== 'image/jpeg')) {
    throw new Error(`#5229 manifest must contain exactly ${EXPECTED_TOTAL_BYTES} bytes and 77 image/jpeg rows`);
  }
  return { manifest: manifest as IncomingMediaMigrationManifest, entries };
}

/** Build deterministic, non-executing artifacts from an already verified manifest. */
export function buildIncomingMediaMigrationArtifacts(input: unknown): IncomingMediaMigrationArtifacts {
  const { manifest, entries } = validateManifest(input);
  const manifestSha256 = digest(JSON.stringify(manifest));
  const preflight: SqlOperation[] = [];
  const apply: SqlOperation[] = [];
  const rollback: SqlOperation[] = [];

  for (let index = 0; index < manifest.entries.length; index += 1) {
    const row = manifest.entries[index];
    const planned = entries[index];
    preflight.push({
      name: `preflight-${index + 1}-messages-log-preimage`,
      sql: `SELECT id FROM messages_log WHERE id = ${sqlLiteral(row.messages_log_id)} AND content = ${sqlLiteral(row.messages_log_content_preimage)};`,
      expected_rows: 1,
    }, {
      name: `preflight-${index + 1}-incoming-media-absent`,
      sql: `SELECT id FROM incoming_media WHERE line_account_id = ${sqlLiteral(row.line_account_id)} AND line_message_id = ${sqlLiteral(row.line_message_id)};`,
      expected_rows: 0,
    });
    const insertName = `apply-${index + 1}-insert-ledger`;
    const rewriteName = `apply-${index + 1}-rewrite-exact-preimage`;
    apply.push({
      name: insertName,
      sql: `INSERT INTO incoming_media (id, line_account_id, line_message_id, source_type, source_id, sender_user_id, r2_key, mime_type, byte_size, sha256, status, stored_at, created_at, updated_at) VALUES (${sqlLiteral(row.incoming_media_id)}, ${sqlLiteral(row.line_account_id)}, ${sqlLiteral(row.line_message_id)}, ${sqlLiteral(row.source_type)}, ${sqlLiteral(row.source_id)}, ${sqlLiteral(row.sender_user_id)}, ${sqlLiteral(row.r2_key)}, ${sqlLiteral(row.mime_type)}, ${sqlLiteral(row.byte_size)}, ${sqlLiteral(row.sha256)}, 'stored', ${sqlLiteral(manifest.backfill_at)}, ${sqlLiteral(row.messages_log_created_at)}, ${sqlLiteral(manifest.backfill_at)});`,
      expected_changes: 1,
    }, {
      name: `assert-${index + 1}-insert-ledger-exactly-one`,
      sql: changesAssertionSql(1, insertName),
      expected_rows: 1,
    }, {
      name: rewriteName,
      sql: `UPDATE messages_log SET content = ${sqlLiteral(JSON.stringify({ originalContentUrl: planned.private_content_url, previewImageUrl: planned.private_content_url }))} WHERE id = ${sqlLiteral(row.messages_log_id)} AND content = ${sqlLiteral(row.messages_log_content_preimage)};`,
      expected_changes: 1,
    }, {
      name: `assert-${index + 1}-rewrite-exactly-one`,
      sql: changesAssertionSql(1, rewriteName),
      expected_rows: 1,
    });
    const rollbackName = `rollback-${index + 1}-restore-exact-replacement`;
    rollback.push({
      name: rollbackName,
      sql: `UPDATE messages_log SET content = ${sqlLiteral(row.messages_log_content_preimage)} WHERE id = ${sqlLiteral(row.messages_log_id)} AND content = ${sqlLiteral(JSON.stringify({ originalContentUrl: planned.private_content_url, previewImageUrl: planned.private_content_url }))};`,
      expected_changes: 1,
    }, {
      name: `assert-${index + 1}-rollback-exactly-one`,
      sql: changesAssertionSql(1, rollbackName),
      expected_rows: 1,
    });
  }

  const base = { schema_version: 1, issue: 5229, manifest_sha256: manifestSha256, entry_count: entries.length };
  return {
    'preflight.json': json({
      ...base,
      mode: 'read-only',
      stop_if_any_expectation_fails: true,
      execution_rule: 'Submit every SELECT in order as one read-only D1 batch and require all 154 row-count expectations before requesting approval for apply.json.',
      operations: preflight,
      r2_head_expectations: entries.map((entry) => ({ r2_key: entry.r2_key, mime_type: entry.mime_type, byte_size: entry.byte_size, sha256: entry.sha256 })),
    }),
    'apply.json': json({
      ...base,
      mode: 'external-write-requires-KEN-approval',
      stop_if_any_expectation_fails: true,
      execution_rule: 'Submit every operation in order as one D1 transactional batch. Each write is immediately followed by a changes() assertion that raises an SQL error on mismatch, causing D1 to roll back all 77 entries. Never split, retry, or resume a partial batch.',
      operations: apply,
    }),
    'rollback.json': json({
      ...base,
      mode: 'external-write-requires-new-KEN-approval',
      stop_if_any_expectation_fails: true,
      execution_rule: 'Submit every rollback operation in order as one D1 transactional batch. Each exact-preimage restore is followed by a changes() assertion so any mismatch rolls back all 77 restores. Do not delete R2 objects or incoming_media rows.',
      operations: rollback,
    }),
    'purge.json': json({
      ...base,
      mode: 'external-write-requires-KEN-approval',
      precondition: 'The exact INCOMING_MEDIA_PUBLIC_BLOCK_ENABLED=true Worker revision is deployed and its version/binding read back first.',
      rule: 'Purge these exact legacy URLs only; wildcard, prefix, and purge-everything requests are forbidden.',
      urls: entries.map((entry) => entry.legacy_public_url),
    }),
    'readback.json': json({
      ...base,
      mode: 'read-only-after-approved-write',
      precondition: 'Run after the exact gate=true revision is read back and purge.json has received successful exact-URL purge receipts.',
      checks: entries.map((entry) => ({
        legacy_public_url: { url: entry.legacy_public_url, unauthenticated_status_after_gate_enabled_and_exact_purge: 404 },
        private_metadata_head: {
          url: entry.private_content_url.replace(/\/content$/, ''),
          unauthenticated_status: 401,
          account_bound_service_credential_status: 200,
          cross_account_service_credential_status: 404,
        },
        private_content_get: {
          url: entry.private_content_url,
          unauthenticated_status: 401,
          account_bound_service_credential_status: 200,
          cross_account_service_credential_status: 404,
          mime_type: entry.mime_type,
          byte_size: entry.byte_size,
          sha256: entry.sha256,
        },
        r2_head: { r2_key: entry.r2_key, mime_type: entry.mime_type, byte_size: entry.byte_size, sha256: entry.sha256 },
      })),
    }),
  };
}

export function writeIncomingMediaMigrationArtifacts(input: unknown, outputDir: string): void {
  if (existsSync(outputDir)) {
    // Existing directories are never chmodded by this tool. Refuse a weaker
    // mode rather than silently changing an operator-selected destination.
    assertOwnerOnlyDirectory(outputDir);
    if (readdirSync(outputDir).length > 0) {
      throw new Error(`output directory must not already contain files: ${outputDir}`);
    }
  } else {
    mkdirSync(outputDir, { recursive: true, mode: OWNER_DIRECTORY_MODE });
    // mkdir's mode is filtered by umask; force and verify the intended mode.
    chmodSync(outputDir, OWNER_DIRECTORY_MODE);
    assertOwnerOnlyDirectory(outputDir);
  }
  const artifacts = buildIncomingMediaMigrationArtifacts(input);
  for (const [name, content] of Object.entries(artifacts)) {
    const path = `${outputDir}/${name}`;
    writeFileSync(path, content, { encoding: 'utf8', mode: OWNER_FILE_MODE, flag: 'wx' });
    // writeFile's mode is filtered by umask; force and verify the intended mode.
    chmodSync(path, OWNER_FILE_MODE);
    assertOwnerOnlyFile(path);
  }
}

function main(rawArgs: string[]): void {
  let manifestPath: string | undefined;
  let outputDir: string | undefined;
  for (let index = 0; index < rawArgs.length; index += 1) {
    const flag = rawArgs[index];
    const value = rawArgs[index + 1];
    if ((flag === '--manifest' || flag === '--output-dir') && value && !value.startsWith('--')) {
      if (flag === '--manifest') manifestPath = value;
      else outputDir = value;
      index += 1;
    } else {
      throw new Error('Usage: tsx scripts/incoming-media-migration-plan.ts --manifest <verified-redacted.json> --output-dir <empty-dir>');
    }
  }
  if (!manifestPath || !outputDir) throw new Error('both --manifest and --output-dir are required');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as unknown;
  const artifacts = buildIncomingMediaMigrationArtifacts(manifest);
  writeIncomingMediaMigrationArtifacts(manifest, outputDir);
  const apply = JSON.parse(artifacts['apply.json']) as { manifest_sha256: string; entry_count: number };
  stdout.write(`Prepared ${apply.entry_count} offline #5229 artifacts (manifest sha256 ${apply.manifest_sha256}). No provider was contacted.\n`);
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try { return fileURLToPath(import.meta.url) === argv[1]; } catch { return false; }
})();

if (isCliEntry) {
  try { main(argv.slice(2)); } catch (err) { stderr.write(`incoming-media-migration-plan: ${(err as Error).message}\n`); exit(1); }
}
