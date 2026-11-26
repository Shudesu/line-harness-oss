import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMileageRulesForEvent, postMileageEntry, processPendingMileageEvents, updateMileageRule,
  type ApplyMileageRulesInput, type PostMileageEntryInput,
} from '../src/mileage.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const NOW = '2026-09-10T12:00:00.000+09:00';
const BEFORE = '2026-09-09T10:00:00.000+09:00';
const HELD = '9999-12-31T23:59:59';
const CASES = [
  ['builtin-message-received', 'message_received', 'line', 'message', null],
  ['builtin-link-clicked', 'link_clicked', 'tracked_link', 'link', 'trackedLinkId'],
  ['builtin-form-submitted', 'form_submitted', 'form', 'form', 'formId'],
  ['builtin-booking-created', 'booking_created', 'booking', 'booking', null],
  ['builtin-booking-created', 'booking_created', 'event_booking', 'event-booking', null],
  ['builtin-webinar-watch-5m', 'webinar_watch_5m', 'webinar', 'webinar:5m', 'webinarId'],
  ['builtin-webinar-watch-15m', 'webinar_watch_15m', 'webinar', 'webinar:15m', 'webinarId'],
  ['builtin-webinar-completed', 'webinar_completed', 'webinar', 'webinar:complete', 'webinarId'],
  ['builtin-webinar-cta-clicked', 'webinar_cta_clicked', 'webinar', 'webinar:cta', 'webinarId'],
  ['builtin-instagram-line-returned', 'instagram_line_returned', 'instagram', 'instagram:return', 'igsid'],
] as const;
type LegacyCase = typeof CASES[number];

function asD1(sqlite: Database.Database, afterRead?: (sql: string, result: unknown) => Promise<void>): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            async run() { const result = statement.run(...params); return { success: true, results: [], meta: { changes: result.changes } }; },
            async first<T>() {
              const row = (statement.get(...params) as T) ?? null;
              await afterRead?.(sql, row);
              return row;
            },
            async all<T>() { return { success: true, results: statement.all(...params) as T[], meta: {} }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

function execSafe(sqlite: Database.Database, sql: string) {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
    try { sqlite.exec(statement); } catch (error) {
      if (!/duplicate column name|already exists/i.test(String(error))) throw error;
    }
  }
}

describe('immutable historical mileage compatibility', () => {
  let sqlite: Database.Database;
  let db: D1Database;
  let sequence: number;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(NOW));
    sqlite = new Database(':memory:');
    execSafe(sqlite, readFileSync(join(ROOT, 'schema.sql'), 'utf8'));
    for (const file of readdirSync(join(ROOT, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
      execSafe(sqlite, readFileSync(join(ROOT, 'migrations', file), 'utf8'));
    }
    sqlite.exec(`INSERT INTO users(id, display_name) VALUES ('user-1', 'One'), ('user-2', 'Two');
      INSERT INTO line_accounts(id, channel_id, name, channel_access_token, channel_secret)
        VALUES ('account-1', 'channel-1', 'One', 'private-token', 'private-secret'),
               ('account-2', 'channel-2', 'Two', 'private-token', 'private-secret');
      INSERT INTO friends(id, line_user_id, user_id, line_account_id)
        VALUES ('friend-1', 'U1', 'user-1', 'account-1'), ('friend-2', 'U2', 'user-1', 'account-2'),
               ('friend-3', 'U3', 'user-2', 'account-1');`);
    db = asD1(sqlite);
    sequence = 0;
  });

  afterEach(() => { sqlite.close(); vi.useRealTimers(); vi.restoreAllMocks(); });

  function legacy(spec: LegacyCase, options: { status?: 'available' | 'pending' | 'void'; userId?: string | null; amount?: number } = {}) {
    const [ruleId, eventType, source, prefix, subjectField] = spec;
    const id = `history-${++sequence}`;
    const sourceId = `action-${sequence}`;
    const subjectKey = eventType === 'webinar_cta_clicked' ? 'subject-1:primary' : 'subject-1';
    const metadata = subjectField ? { [subjectField]: 'subject-1', ...(eventType === 'webinar_cta_clicked' ? { ctaId: 'primary' } : {}), backfilled: true } : { backfilled: true };
    sqlite.prepare(`INSERT INTO engagement_events(id, program_id, idempotency_key, event_type, source, source_event_id,
      actor_user_id, actor_friend_id, metadata, occurred_at, created_at)
      VALUES (?, 'default', ?, ?, ?, ?, ?, 'friend-1', ?, ?, ?)`)
      .run(id, `history:${prefix}:${id}`, eventType, source, sourceId, options.userId === undefined ? 'user-1' : options.userId, JSON.stringify(metadata), BEFORE, BEFORE);
    // 063 stores the subject only on the linked engagement event; 062 also stores it in the ledger.
    sqlite.prepare(`INSERT INTO mileage_ledger(id, program_id, beneficiary_user_id, beneficiary_friend_id,
      engagement_event_id, mileage_rule_id, entry_type, status, amount, reason, source,
      source_event_id, idempotency_key, metadata, occurred_at, created_at)
      VALUES (?, 'default', ?, 'friend-1', ?, ?, 'grant', ?, ?, 'Historical', ?, ?, ?, ?, ?, ?)`)
      .run(`mile-${id}`, options.userId === undefined ? 'user-1' : options.userId, id, ruleId,
        options.status ?? 'available', options.amount ?? 7, source, sourceId, `history-mile:${prefix}:${id}`,
        JSON.stringify(source === 'webinar' || source === 'instagram' ? { backfilled: true } : metadata), BEFORE, BEFORE);
    return { id: `mile-${id}`, ruleId, eventType, source, sourceId, subjectKey };
  }

  async function project(input: Partial<ApplyMileageRulesInput> & Pick<ApplyMileageRulesInput, 'eventType' | 'source' | 'sourceEventId'>) {
    await applyMileageRulesForEvent(db, { friendId: 'friend-1', occurredAt: BEFORE, ...input });
    const result = await processPendingMileageEvents(db, { now: NOW });
    expect(result.failed).toBe(0);
    return result;
  }

  function ledger() { return sqlite.prepare('SELECT * FROM mileage_ledger ORDER BY id').all(); }

  it.each(CASES)('retries the same action without duplicating %s (%s, %s)', async (...spec) => {
    const old = legacy(spec as unknown as LegacyCase);
    const original = ledger();
    await project({ eventType: old.eventType, source: old.source, sourceEventId: old.sourceId, subjectKey: old.subjectKey });
    expect(ledger()).toEqual(original);
    expect(sqlite.prepare(`SELECT status FROM mileage_event_queue`).all()).toEqual([{ status: 'processed' }]);
  });

  it.each(CASES.filter((spec) => spec[4]))('deduplicates distinct actions on the configured subject for %s', async (...spec) => {
    const old = legacy(spec as unknown as LegacyCase);
    const original = ledger();
    await project({ eventType: old.eventType, source: old.source, sourceEventId: 'repeat-action', subjectKey: old.subjectKey, friendId: 'friend-2' });
    expect(ledger()).toEqual(original);
    await project({ eventType: old.eventType, source: old.source, sourceEventId: 'new-action', subjectKey: 'new-subject' });
    expect(ledger()).toHaveLength(2);
  });

  it('allows another link day and another webinar CTA subject', async () => {
    const link = legacy(CASES[1]);
    const cta = legacy(CASES[8]);
    await project({ eventType: link.eventType, source: link.source, sourceEventId: 'tomorrow-link', subjectKey: link.subjectKey, occurredAt: NOW });
    await project({ eventType: cta.eventType, source: cta.source, sourceEventId: 'secondary-cta', subjectKey: 'subject-1:secondary' });
    expect(ledger()).toHaveLength(4);
  });

  it('recognizes a friend-only historical grant after identities are linked', async () => {
    const old = legacy(CASES[2], { userId: null });
    const original = ledger();
    await project({ eventType: old.eventType, source: old.source, sourceEventId: 'linked-repeat', subjectKey: old.subjectKey, friendId: 'friend-2' });
    expect(ledger()).toEqual(original);
    await project({ eventType: old.eventType, source: old.source, sourceEventId: 'unrelated-person', subjectKey: old.subjectKey, friendId: 'friend-3' });
    expect(ledger()).toHaveLength(2);
  });

  it('counts linked historical actor grants toward the daily cap and excludes void grants', async () => {
    for (let index = 0; index < 4; index += 1) legacy(CASES[0], { userId: null, amount: 1 });
    legacy(CASES[0], { userId: null, amount: 1, status: 'void' });
    await project({ eventType: 'message_received', source: 'line', sourceEventId: 'last-allowed', friendId: 'friend-2' });
    await project({ eventType: 'message_received', source: 'line', sourceEventId: 'over-cap', friendId: 'friend-2' });
    expect(ledger()).toHaveLength(6);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger WHERE source_event_id = 'over-cap'`).get()).toEqual({ count: 0 });
  });

  it.each([false, true])('atomically enforces the cap when two processors both see four grants (held: %s)', async (held) => {
    for (let index = 0; index < 4; index += 1) legacy(CASES[0], { userId: null, amount: 1 });
    legacy(CASES[0], { userId: null, amount: 1, status: 'void' });
    const original = ledger();
    for (const sourceEventId of ['race-first', 'race-second']) {
      await applyMileageRulesForEvent(db, {
        eventType: 'message_received', source: 'line', sourceEventId,
        friendId: 'friend-2', occurredAt: BEFORE,
      });
    }
    if (held) {
      sqlite.exec(`CREATE TABLE _line_harness_legacy_mileage_claims (
        engagement_event_id TEXT PRIMARY KEY REFERENCES engagement_events(id), migration_name TEXT NOT NULL,
        mileage_rule_id TEXT NOT NULL, rule_snapshot TEXT NOT NULL);
        INSERT INTO _line_harness_legacy_mileage_claims
        SELECT q.engagement_event_id, '062_mileage_admin_and_activity_rules.sql', r.id,
          json_object('amount', r.amount, 'initial_status', r.initial_status, 'conditions', r.conditions,
            'source', r.source, 'event_type', r.event_type, 'is_active', r.is_active,
            'valid_from', r.valid_from, 'valid_until', r.valid_until)
        FROM mileage_event_queue q CROSS JOIN mileage_rules r WHERE r.id = 'builtin-message-received';`);
      sqlite.prepare('UPDATE mileage_event_queue SET available_at = ?').run(HELD);
    }
    let firstRead!: () => void;
    let release!: () => void;
    const firstReached = new Promise<void>((resolve) => { firstRead = resolve; });
    const bothRead = new Promise<void>((resolve) => { release = resolve; });
    const observedCounts: number[] = [];
    const concurrentDb = asD1(sqlite, async (sql, row) => {
      if (!/^\s*SELECT COUNT\(\*\) AS action_count/.test(sql) || observedCounts.length >= 2) return;
      observedCounts.push((row as { action_count: number }).action_count);
      if (observedCounts.length === 1) firstRead();
      else release();
      await bothRead;
    });
    // Start processor two only after processor one owns its queue row. Both
    // database reads then complete before either ledger INSERT can execute.
    const first = processPendingMileageEvents(concurrentDb, { now: NOW, limit: 1 });
    await firstReached;
    const second = processPendingMileageEvents(concurrentDb, { now: NOW, limit: 1 });
    const results = await Promise.all([first, second]);
    expect(observedCounts).toEqual([4, 4]);
    expect(results.map((result) => result.failed)).toEqual([0, 0]);
    expect(results.map((result) => result.processed)).toEqual([1, 1]);
    expect(results.reduce((sum, result) => sum + result.granted, 0)).toBe(1);
    expect(ledger()).toHaveLength(6);
    expect(ledger()).toEqual(expect.arrayContaining(original));
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger WHERE status != 'void'`).get()).toEqual({ count: 5 });
    if (held) expect(sqlite.prepare('SELECT DISTINCT available_at FROM mileage_event_queue').all()).toEqual([{ available_at: HELD }]);
  });

  it('reports a real SQL failure instead of treating it as a reached cap', async () => {
    for (let index = 0; index < 4; index += 1) legacy(CASES[0], { amount: 1 });
    sqlite.exec(`CREATE TRIGGER fail_mileage_insert BEFORE INSERT ON mileage_ledger
      WHEN NEW.source_event_id = 'failing-message'
      BEGIN SELECT RAISE(ABORT, 'Simulated mileage insert failure'); END;`);
    await applyMileageRulesForEvent(db, {
      eventType: 'message_received', source: 'line', sourceEventId: 'failing-message',
      friendId: 'friend-1', occurredAt: BEFORE,
    });
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ processed: 0, failed: 1, granted: 0 });
    expect(ledger()).toHaveLength(4);
    expect(sqlite.prepare('SELECT last_error FROM mileage_event_queue').get())
      .toEqual({ last_error: 'Simulated mileage insert failure' });
  });

  it('honors changed uniqueness while never granting the identical action again', async () => {
    const old = legacy(CASES[2]);
    await updateMileageRule(db, old.ruleId, { amount: 90, conditions: null });
    await project({ eventType: old.eventType, source: old.source, sourceEventId: old.sourceId, subjectKey: old.subjectKey });
    expect(ledger()).toHaveLength(1);
    await project({ eventType: old.eventType, source: old.source, sourceEventId: 'new-submission', subjectKey: old.subjectKey });
    expect(ledger()).toHaveLength(2);
    expect(sqlite.prepare(`SELECT amount FROM mileage_ledger WHERE source_event_id = 'new-submission'`).get()).toEqual({ amount: 90 });
  });

  async function currentGrant(old: ReturnType<typeof legacy>): Promise<PostMileageEntryInput> {
    const { event } = await applyMileageRulesForEvent(db, {
      eventType: old.eventType, source: old.source, sourceEventId: old.sourceId, friendId: 'friend-1', occurredAt: BEFORE,
    });
    return {
      beneficiaryUserId: 'user-1', beneficiaryFriendId: 'friend-1', engagementEventId: event.id,
      mileageRuleId: old.ruleId, entryType: 'grant', amount: 999, reason: 'Current',
      source: old.source, sourceEventId: old.sourceId, idempotencyKey: `rule:${old.ruleId}:event:${event.id}`,
      metadata: { ruleId: old.ruleId, eventType: old.eventType, beneficiaryType: 'actor' }, occurredAt: BEFORE,
    };
  }

  it.each(['available', 'pending', 'void'] as const)('returns the unchanged legacy %s entry, like canonical idempotency', async (status) => {
    const old = legacy(CASES[2], { status, amount: 13 });
    const original = ledger()[0];
    const input = await currentGrant(old);
    expect(await postMileageEntry(db, input)).toEqual(original);
    expect(await postMileageEntry(db, input)).toEqual(original);
    expect(ledger()).toEqual([original]);
  });

  it('returns existing legacy and canonical entries even when the final cap has been exhausted', async () => {
    const old = legacy(CASES[0], { amount: 1 });
    const input = await currentGrant(old);
    const cap = { sql: `SELECT COUNT(*) AS action_count FROM mileage_ledger WHERE status != 'void'`, values: [], limit: 1 };
    expect((await postMileageEntry(db, input, cap)).id).toBe(old.id);
    const canonicalInput = { ...input, sourceEventId: 'canonical-action', idempotencyKey: 'canonical-grant' };
    const canonical = await postMileageEntry(db, canonicalInput);
    expect(await postMileageEntry(db, canonicalInput, cap)).toEqual(canonical);
    expect(ledger()).toHaveLength(2);
  });

  it('scopes equal source IDs by program, rule, source and beneficiary; manual and referrer grants remain independent', async () => {
    const old = legacy(CASES[3]);
    const input = await currentGrant(old);
    sqlite.exec(`INSERT INTO mileage_programs(id, code, name, created_at, updated_at) VALUES ('other', 'other', 'Other', '2026-09-09', '2026-09-09');
      INSERT INTO mileage_rules(id, program_id, name, event_type, amount, created_at, updated_at) VALUES ('custom', 'default', 'Custom', 'booking_created', 77, '2026-09-09', '2026-09-09');`);
    const variations: Partial<PostMileageEntryInput>[] = [
      { programId: 'other' },
      { mileageRuleId: 'custom', idempotencyKey: `rule:custom:event:${input.engagementEventId}` },
      { source: 'event_booking' },
      { beneficiaryUserId: 'user-2', beneficiaryFriendId: 'friend-3' },
      { idempotencyKey: 'manual-grant' },
      { idempotencyKey: 'referral-grant', metadata: { ...input.metadata, beneficiaryType: 'referrer' } },
    ];
    for (const variation of variations) {
      const result = await postMileageEntry(db, { ...input, ...variation });
      expect(result.id).not.toBe(old.id);
      expect(ledger()).toHaveLength(2);
      sqlite.prepare('DELETE FROM mileage_ledger WHERE id != ?').run(old.id);
    }
  });

  it('still projects additional live custom rules for an action that had a historical builtin grant', async () => {
    const old = legacy(CASES[2]);
    sqlite.exec(`INSERT INTO mileage_rules(id, program_id, name, event_type, amount, created_at, updated_at)
      VALUES ('custom', 'default', 'Custom', 'form_submitted', 77, '2026-09-09', '2026-09-09');`);
    await project({ eventType: old.eventType, source: old.source, sourceEventId: old.sourceId, subjectKey: old.subjectKey });
    expect(ledger()).toHaveLength(2);
    expect(sqlite.prepare(`SELECT amount FROM mileage_ledger WHERE mileage_rule_id = 'custom'`).get()).toEqual({ amount: 77 });
  });

  async function heldClaim(options: { register?: boolean; sourceId?: string } = {}) {
    sqlite.exec(`CREATE TABLE IF NOT EXISTS _line_harness_legacy_mileage_claims (
      engagement_event_id TEXT PRIMARY KEY REFERENCES engagement_events(id), migration_name TEXT NOT NULL,
      mileage_rule_id TEXT NOT NULL, rule_snapshot TEXT NOT NULL);`);
    const { event } = await applyMileageRulesForEvent(db, {
      eventType: 'form_submitted', source: 'form', sourceEventId: options.sourceId ?? 'held-form',
      friendId: 'friend-1', subjectKey: 'held-subject', occurredAt: BEFORE,
    });
    sqlite.prepare('UPDATE mileage_event_queue SET available_at = ? WHERE engagement_event_id = ?').run(HELD, event.id);
    if (options.register !== false) {
      sqlite.prepare(`INSERT INTO _line_harness_legacy_mileage_claims
        SELECT ?, '062_mileage_admin_and_activity_rules.sql', id,
          json_object('amount', amount, 'initial_status', initial_status, 'conditions', conditions,
            'source', source, 'event_type', event_type, 'is_active', is_active, 'valid_from', valid_from, 'valid_until', valid_until)
        FROM mileage_rules WHERE id = 'builtin-form-submitted'`).run(event.id);
    }
    return event;
  }

  it('projects only the claimed builtin and leaves unregistered held rows invisible', async () => {
    const event = await heldClaim();
    await heldClaim({ register: false, sourceId: 'unregistered' });
    sqlite.exec(`INSERT INTO mileage_rules(id, program_id, name, event_type, amount, created_at, updated_at)
      VALUES ('late-rule', 'default', 'Later custom', 'form_submitted', 123, '2026-09-09', '2026-09-09');`);
    const result = await processPendingMileageEvents(db, { now: NOW });
    expect(result).toMatchObject({ claimed: 1, processed: 1, granted: 1, failed: 0 });
    expect(ledger()).toHaveLength(1);
    expect(sqlite.prepare(`SELECT mileage_rule_id FROM mileage_ledger`).get()).toEqual({ mileage_rule_id: 'builtin-form-submitted' });
    expect(sqlite.prepare(`SELECT status, available_at FROM mileage_event_queue WHERE engagement_event_id = ?`).get(event.id)).toEqual({ status: 'processed', available_at: HELD });
  });

  it('fails changed held policy without grants or exposing retry rows to old workers', async () => {
    const event = await heldClaim();
    await updateMileageRule(db, 'builtin-form-submitted', { amount: 50 });
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ claimed: 1, failed: 1, processed: 0 });
    expect(ledger()).toHaveLength(0);
    expect(sqlite.prepare(`SELECT status, available_at, last_error FROM mileage_event_queue WHERE engagement_event_id = ?`).get(event.id))
      .toEqual({ status: 'failed', available_at: HELD, last_error: expect.stringContaining('policy changed') });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_event_queue WHERE status IN ('pending','failed') AND datetime(available_at) <= datetime(?)`).get(NOW)).toEqual({ count: 0 });
    await updateMileageRule(db, 'builtin-form-submitted', { amount: 10 });
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ processed: 1, granted: 1, failed: 0 });
  });

  it('recovers a stale held processing claim without making it eligible for old runtime', async () => {
    const event = await heldClaim();
    sqlite.prepare(`UPDATE mileage_event_queue SET status = 'processing', attempts = 1, processing_started_at = ? WHERE engagement_event_id = ?`).run(BEFORE, event.id);
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ processed: 1, granted: 1, failed: 0 });
    expect(sqlite.prepare(`SELECT available_at FROM mileage_event_queue WHERE engagement_event_id = ?`).get(event.id)).toEqual({ available_at: HELD });
  });

  it('rejects a retroactive tier multiplier introduced while a claim was held', async () => {
    await heldClaim();
    sqlite.exec(`INSERT INTO tags(id, name, mileage_multiplier_bps) VALUES ('new-tier', 'New tier', 15000);
      INSERT INTO friend_tags(friend_id, tag_id, assigned_at) VALUES ('friend-1', 'new-tier', '2026-09-01');`);
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ failed: 1, granted: 0 });
    expect(ledger()).toHaveLength(0);
    expect(sqlite.prepare('SELECT available_at, last_error FROM mileage_event_queue').get())
      .toEqual({ available_at: HELD, last_error: expect.stringContaining('multiplier changed') });
  });

  it('fails a claim attached to a different action instead of silently processing it', async () => {
    const event = await heldClaim();
    sqlite.prepare(`UPDATE engagement_events SET event_type = 'booking_created' WHERE id = ?`).run(event.id);
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ failed: 1, processed: 0, granted: 0 });
    expect(ledger()).toHaveLength(0);
  });

  it('rejects malformed snapshots without leaking sensitive content to logs or queue errors', async () => {
    const event = await heldClaim();
    const log = vi.spyOn(console, 'log');
    const error = vi.spyOn(console, 'error');
    sqlite.prepare(`UPDATE _line_harness_legacy_mileage_claims SET rule_snapshot = ? WHERE engagement_event_id = ?`)
      .run('private-token private-secret', event.id);
    expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ failed: 1, granted: 0 });
    expect(log).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(JSON.stringify(sqlite.prepare(`SELECT last_error FROM mileage_event_queue`).all())).not.toMatch(/private-token|private-secret/);
  });
});
