import { chmodSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  buildIncomingMediaMigrationArtifacts,
  writeIncomingMediaMigrationArtifacts,
} from './incoming-media-migration-plan.js';

interface TestDatabase {
  exec(sql: string): void;
  prepare(sql: string): {
    run(...params: unknown[]): unknown;
    get(...params: unknown[]): unknown;
  };
  close(): void;
}

const require = createRequire(import.meta.url);
const TestDatabase = require('../packages/db/node_modules/better-sqlite3') as new (path: string) => TestDatabase;
const N = 77;
const B = 27_625_839;

function manifest() {
  const workerUrl = 'https://worker.example';
  const baseSize = Math.floor(B / N);
  return {
    schema_version: 1 as const,
    issue: 5229 as const,
    verified: true as const,
    provenance_basis: 'legacy_user_path_reconstruction' as const,
    raw_event_snapshot: false as const,
    worker_url: workerUrl,
    backfill_at: '2026-08-31T12:00:00.000Z',
    entries: Array.from({ length: N }, (_, index) => {
      const suffix = String(index).padStart(3, '0');
      const key = `incoming-acc-1-msg-${suffix}.jpg`;
      const legacyUrl = `${workerUrl}/images/${key}`;
      return {
      incoming_media_id: `legacy-log-${suffix}`,
      messages_log_id: `log-${suffix}`,
      messages_log_created_at: '2026-08-30T09:10:11.123+09:00',
      line_account_id: 'acc-1',
      line_message_id: `msg-${suffix}`,
      source_type: 'user' as const,
      source_id: 'redacted-user',
      sender_user_id: 'redacted-user',
      r2_key: key,
      mime_type: 'image/jpeg',
      byte_size: baseSize + (index < B % N ? 1 : 0),
      sha256: 'a'.repeat(64),
      messages_log_content_preimage: JSON.stringify({ originalContentUrl: legacyUrl, previewImageUrl: legacyUrl }),
    }; }),
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
    expect(preflight.execution_rule).toMatch(/one read-only D1 batch/i);
    expect(preflight.operations[0]).toMatchObject({ expected_rows: 1 });
    expect(preflight.operations[1]).toMatchObject({ expected_rows: 0 });
    expect(preflight.operations).toHaveLength(N * 2);
    expect(apply.operations).toHaveLength(N * 4);
    expect(apply.operations[0]).toMatchObject({ expected_changes: 1 });
    expect(apply.operations[0].sql).toContain("'2026-08-30T09:10:11.123+09:00', '2026-08-31T12:00:00.000Z'");
    expect(apply.operations[1].sql).toContain("changes() = 1");
    expect(apply.operations[2].sql).toContain("WHERE id = 'log-000' AND content =");
    expect(apply.operations[3].sql).toContain("changes() = 1");
    expect(apply.execution_rule).toMatch(/one D1 transactional batch/i);
    expect(apply.execution_rule).toMatch(/roll back all 77 entries/i);
    expect(rollback.operations).toHaveLength(N * 2);
    expect(rollback.operations[0].sql).toContain("WHERE id = 'log-000' AND content =");
    expect(rollback.operations[1].sql).toContain('changes() = 1');
    expect(rollback.execution_rule).toMatch(/rolls back all 77 restores/i);
    expect(purge.urls).toHaveLength(N);
    expect(purge.urls[0]).toBe('https://worker.example/images/incoming-acc-1-msg-000.jpg');
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
      private_content_get: { sha256: 'a'.repeat(64), byte_size: manifest().entries[0].byte_size },
    });
  });

  test('fails closed for an unverified manifest or a non-exact legacy JSON preimage', () => {
    const unverified = manifest();
    (unverified as { verified: boolean }).verified = false;
    expect(() => buildIncomingMediaMigrationArtifacts(unverified)).toThrow(/verified=true/);

    const unexpected = manifest();
    unexpected.entries[0].messages_log_content_preimage = JSON.stringify({
      originalContentUrl: 'https://worker.example/images/incoming-acc-1-msg-000.jpg',
      previewImageUrl: 'https://other.example/images/incoming-acc-1-msg-000.jpg',
    });
    expect(() => buildIncomingMediaMigrationArtifacts(unexpected)).toThrow(/exactly match/);
  });

  test('accepts only the exact frozen 77-row, 27,625,839-byte JPEG cohort', () => {
    const short = manifest();
    short.entries.pop();
    expect(() => buildIncomingMediaMigrationArtifacts(short)).toThrow(/exactly 77 rows/);

    const byteDrift = manifest();
    byteDrift.entries[0].byte_size += 1;
    expect(() => buildIncomingMediaMigrationArtifacts(byteDrift)).toThrow(/27625839 bytes/);

    const mimeDrift = manifest();
    const row = mimeDrift.entries[0];
    (row as { mime_type: string }).mime_type = 'image/png';
    row.r2_key = row.r2_key.replace(/\.jpg$/, '.png');
    const url = `https://worker.example/images/${row.r2_key}`;
    row.messages_log_content_preimage = JSON.stringify({ originalContentUrl: url, previewImageUrl: url });
    expect(() => buildIncomingMediaMigrationArtifacts(mimeDrift)).toThrow(/77 image\/jpeg rows/);
  });

  test('rejects ambiguous payloads, duplicate identities, unsafe identifiers, and non-historical keys', () => {
    const payload = manifest();
    payload.entries[0].messages_log_content_preimage = JSON.stringify({
      originalContentUrl: 'https://worker.example/images/incoming-acc-1-msg-000.jpg',
      previewImageUrl: 'https://worker.example/images/incoming-acc-1-msg-000.jpg',
      caption: 'not allowed',
    });
    expect(() => buildIncomingMediaMigrationArtifacts(payload)).toThrow(/only the two image URL fields/);

    const duplicate = manifest();
    duplicate.entries[1] = { ...duplicate.entries[0], incoming_media_id: 'legacy-log-001', messages_log_id: 'log-001' };
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

    const wrongProvenance = manifest();
    (wrongProvenance as { provenance_basis: string }).provenance_basis = 'raw_event_snapshot';
    expect(() => buildIncomingMediaMigrationArtifacts(wrongProvenance)).toThrow(/legacy_user_path_reconstruction/);

    const fakeRawSnapshot = manifest();
    (fakeRawSnapshot as { raw_event_snapshot: boolean }).raw_event_snapshot = true;
    expect(() => buildIncomingMediaMigrationArtifacts(fakeRawSnapshot)).toThrow(/raw_event_snapshot=false/);

    const mismatchedUser = manifest();
    mismatchedUser.entries[0].sender_user_id = 'another-user';
    expect(() => buildIncomingMediaMigrationArtifacts(mismatchedUser)).toThrow(/legacy user-path source/);

    const nonDeterministicId = manifest();
    nonDeterministicId.entries[0].incoming_media_id = 'media-1';
    expect(() => buildIncomingMediaMigrationArtifacts(nonDeterministicId)).toThrow(/deterministic legacy/);

    const badTimestamp = manifest();
    badTimestamp.entries[0].messages_log_created_at = 'not-a-timestamp';
    expect(() => buildIncomingMediaMigrationArtifacts(badTimestamp)).toThrow(/ISO-8601 timestamp/);
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

  test('the changes assertions make the full apply sequence atomic on a stale preimage', () => {
    const input = manifest();
    const apply = JSON.parse(buildIncomingMediaMigrationArtifacts(input)['apply.json']) as {
      operations: Array<{ sql: string }>;
    };
    const setup = (contents: string[]) => {
      const db = new TestDatabase(':memory:');
      db.exec('PRAGMA foreign_keys = ON');
      db.exec(`
        CREATE TABLE line_accounts (id TEXT PRIMARY KEY);
        CREATE TABLE messages_log (id TEXT PRIMARY KEY, content TEXT NOT NULL);
        CREATE TABLE incoming_media (
          id TEXT PRIMARY KEY,
          line_account_id TEXT NOT NULL REFERENCES line_accounts(id),
          line_message_id TEXT NOT NULL,
          source_type TEXT NOT NULL CHECK (source_type IN ('user', 'group', 'room')),
          source_id TEXT NOT NULL,
          sender_user_id TEXT,
          r2_key TEXT NOT NULL,
          mime_type TEXT,
          byte_size INTEGER,
          sha256 TEXT,
          status TEXT NOT NULL CHECK (status IN ('pending', 'stored', 'failed')),
          stored_at TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          UNIQUE (line_account_id, line_message_id)
        );
      `);
      db.prepare('INSERT INTO line_accounts (id) VALUES (?)').run('acc-1');
      const insertLog = db.prepare('INSERT INTO messages_log (id, content) VALUES (?, ?)');
      input.entries.forEach((entry, index) => insertLog.run(entry.messages_log_id, contents[index]));
      return db;
    };
    const executeBatch = (db: TestDatabase) => {
      db.exec('BEGIN');
      try {
        for (const operation of apply.operations) db.exec(operation.sql);
        db.exec('COMMIT');
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    };

    const matchingContents = input.entries.map((entry) => entry.messages_log_content_preimage);
    const matching = setup(matchingContents);
    expect(() => executeBatch(matching)).not.toThrow();
    expect(matching.prepare('SELECT COUNT(*) AS count FROM incoming_media').get()).toEqual({ count: N });
    expect(matching.prepare("SELECT created_at FROM incoming_media WHERE id = 'legacy-log-000'").get()).toEqual({
      created_at: input.entries[0].messages_log_created_at,
    });
    matching.close();

    const staleContent = JSON.stringify({ originalContentUrl: 'stale', previewImageUrl: 'stale' });
    const staleContents = [...matchingContents];
    staleContents[0] = staleContent;
    const stale = setup(staleContents);
    expect(() => executeBatch(stale)).toThrow(/malformed JSON/);
    expect(stale.prepare('SELECT COUNT(*) AS count FROM incoming_media').get()).toEqual({ count: 0 });
    expect(stale.prepare('SELECT content FROM messages_log WHERE id = ?').get('log-000')).toEqual({ content: staleContent });
    stale.close();
  });
});
