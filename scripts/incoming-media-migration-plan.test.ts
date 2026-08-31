import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildIncomingMediaMigrationArtifacts,
  writeIncomingMediaMigrationArtifacts,
} from './incoming-media-migration-plan.js';

function manifest() {
  const workerUrl = 'https://worker.example';
  const key = 'incoming-acc-1-msg-1.png';
  const legacyUrl = `${workerUrl}/images/${key}`;
  return {
    schema_version: 1 as const,
    issue: 5229 as const,
    verified: true as const,
    worker_url: workerUrl,
    backfill_at: '2026-08-31T12:00:00.000Z',
    entries: [{
      incoming_media_id: 'media-1',
      messages_log_id: 'log-1',
      line_account_id: 'acc-1',
      line_message_id: 'msg-1',
      source_type: 'user' as const,
      source_id: 'redacted-source',
      sender_user_id: 'redacted-sender',
      r2_key: key,
      mime_type: 'image/png',
      byte_size: 4,
      sha256: 'a'.repeat(64),
      messages_log_content_preimage: JSON.stringify({ originalContentUrl: legacyUrl, previewImageUrl: legacyUrl }),
    }],
  };
}

describe('incoming-media migration plan', () => {
  test('builds deterministic guarded offline artifacts from a verified manifest', () => {
    const input = manifest();
    const first = buildIncomingMediaMigrationArtifacts(input);
    const second = buildIncomingMediaMigrationArtifacts(input);
    expect(first).toEqual(second);

    const preflight = JSON.parse(first['preflight.json']);
    const apply = JSON.parse(first['apply.json']);
    const rollback = JSON.parse(first['rollback.json']);
    const purge = JSON.parse(first['purge.json']);
    const readback = JSON.parse(first['readback.json']);
    expect(preflight.mode).toBe('read-only');
    expect(preflight.operations[0]).toMatchObject({ expected_rows: 1 });
    expect(preflight.operations[1]).toMatchObject({ expected_rows: 0 });
    expect(apply.operations).toHaveLength(2);
    expect(apply.operations[0]).toMatchObject({ expected_changes: 1 });
    expect(apply.operations[1].sql).toContain("WHERE id = 'log-1' AND content =");
    expect(rollback.operations[0].sql).toContain("WHERE id = 'log-1' AND content =");
    expect(purge.urls).toEqual(['https://worker.example/images/incoming-acc-1-msg-1.png']);
    expect(purge.precondition).toMatch(/binding.*read back/i);
    expect(purge.rule).toMatch(/wildcard.*forbidden/i);
    expect(readback.precondition).toMatch(/purge\.json.*receipts/i);
    expect(readback.checks[0]).toMatchObject({
      legacy_public_url: { unauthenticated_status_after_gate_enabled_and_exact_purge: 404 },
      private_metadata_head: {
        unauthenticated_status: 401,
        account_bound_service_credential_status: 200,
        cross_account_service_credential_status: 404,
      },
      private_content_get: { sha256: 'a'.repeat(64), byte_size: 4 },
    });
  });

  test('fails closed for an unverified manifest or a non-exact legacy JSON preimage', () => {
    const unverified = manifest();
    (unverified as { verified: boolean }).verified = false;
    expect(() => buildIncomingMediaMigrationArtifacts(unverified)).toThrow(/verified=true/);

    const unexpected = manifest();
    unexpected.entries[0].messages_log_content_preimage = JSON.stringify({
      originalContentUrl: 'https://worker.example/images/incoming-acc-1-msg-1.png',
      previewImageUrl: 'https://other.example/images/incoming-acc-1-msg-1.png',
    });
    expect(() => buildIncomingMediaMigrationArtifacts(unexpected)).toThrow(/exactly match/);
  });

  test('rejects ambiguous payloads, duplicate identities, unsafe identifiers, and non-historical keys', () => {
    const payload = manifest();
    payload.entries[0].messages_log_content_preimage = JSON.stringify({
      originalContentUrl: 'https://worker.example/images/incoming-acc-1-msg-1.png',
      previewImageUrl: 'https://worker.example/images/incoming-acc-1-msg-1.png',
      caption: 'not allowed',
    });
    expect(() => buildIncomingMediaMigrationArtifacts(payload)).toThrow(/only the two image URL fields/);

    const duplicate = manifest();
    duplicate.entries.push({ ...duplicate.entries[0], incoming_media_id: 'media-2', messages_log_id: 'log-2' });
    expect(() => buildIncomingMediaMigrationArtifacts(duplicate)).toThrow(/duplicates a line account/);

    const unsafeAccount = manifest();
    unsafeAccount.entries[0].line_account_id = 'acc/1';
    expect(() => buildIncomingMediaMigrationArtifacts(unsafeAccount)).toThrow(/SAFE_IDENTIFIER/);

    const unsafeMessage = manifest();
    unsafeMessage.entries[0].line_message_id = 'msg space';
    expect(() => buildIncomingMediaMigrationArtifacts(unsafeMessage)).toThrow(/SAFE_IDENTIFIER/);

    const digestKey = manifest();
    digestKey.entries[0].r2_key = `incoming-${'a'.repeat(64)}`;
    expect(() => buildIncomingMediaMigrationArtifacts(digestKey)).toThrow(/historical account\/message\/image-extension key/);

    const arbitraryKey = manifest();
    arbitraryKey.entries[0].r2_key = 'incoming-arbitrary-name.jpeg';
    expect(() => buildIncomingMediaMigrationArtifacts(arbitraryKey)).toThrow(/historical account\/message\/image-extension key/);
  });

  test('writes deterministic offline review artifacts with owner-only modes', () => {
    const root = mkdtempSync(join(tmpdir(), 'incoming-media-plan-'));
    const outputDir = join(root, 'artifacts');
    const previousUmask = process.umask(0o022);
    try {
      writeIncomingMediaMigrationArtifacts(manifest(), outputDir);
      const apply = readFileSync(join(outputDir, 'apply.json'), 'utf8');
      expect(apply).toContain('external-write-requires-KEN-approval');
      expect(lstatSync(outputDir).mode & 0o777).toBe(0o700);
      for (const name of readdirSync(outputDir)) {
        expect(lstatSync(join(outputDir, name)).mode & 0o777).toBe(0o600);
      }
      expect(() => writeIncomingMediaMigrationArtifacts(manifest(), outputDir)).toThrow(/must not already contain files/);
    } finally {
      process.umask(previousUmask);
      rmSync(root, { recursive: true, force: true });
    }
  });

  test('fails closed for an existing output directory with a non-owner-only mode', () => {
    const root = mkdtempSync(join(tmpdir(), 'incoming-media-plan-'));
    const outputDir = join(root, 'too-open');
    try {
      mkdirSync(outputDir, { mode: 0o700 });
      chmodSync(outputDir, 0o755);
      expect(() => writeIncomingMediaMigrationArtifacts(manifest(), outputDir)).toThrow(/mode 0700/);
      expect(readdirSync(outputDir)).toEqual([]);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
