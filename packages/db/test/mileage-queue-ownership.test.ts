import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyMileageRulesForEvent, processPendingMileageEvents, ensureDefaultMileageProgram } from '../src/mileage.js';

const NOW = '2026-10-21T10:00:00.000+09:00';
const LATER = '2026-10-21T10:11:00.000+09:00';
const HELD = '9999-12-31T23:59:59';
type Hook = (sql: string) => Promise<void>;

function asD1(sqlite: Database.Database, hooks: { afterList?: Hook; afterRead?: Hook; beforeWrite?: Hook } = {}): D1Database {
  function prepare(sql: string, params: unknown[] = []): D1PreparedStatement {
    return {
      bind(...values: unknown[]) { return prepare(sql, values); },
      async first<T>() {
        const result = (sqlite.prepare(sql).get(...params) as T) ?? null;
        await hooks.afterRead?.(sql);
        return result;
      },
      async all<T>() {
        const results = sqlite.prepare(sql).all(...params) as T[];
        await hooks.afterList?.(sql);
        return { success: true, results, meta: {} };
      },
      async run() {
        await hooks.beforeWrite?.(sql);
        const result = sqlite.prepare(sql).run(...params);
        return { success: true, results: [], meta: { changes: result.changes } };
      },
    } as D1PreparedStatement;
  }
  return { prepare } as D1Database;
}

function barrier() {
  let reached!: () => void;
  let release!: () => void;
  const entered = new Promise<void>(resolve => { reached = resolve; });
  const released = new Promise<void>(resolve => { release = resolve; });
  return { entered, release, async wait() { reached(); await released; } };
}

for (const held of [false, true]) {
  describe(`${held ? 'historical held' : 'normal'} mileage queue attempt ownership`, () => {
    let sqlite: Database.Database;
    let db: D1Database;
    beforeEach(async () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(new Date(NOW));
      vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
      sqlite = new Database(':memory:');
      sqlite.pragma('foreign_keys = ON');
      sqlite.exec(readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'));
      sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
        VALUES('account','channel','Test','local-token','local-secret');
        INSERT INTO friends(id,line_user_id,line_account_id) VALUES('friend','LINE-USER','account');`);
      db = asD1(sqlite);
      // Upstream bootstrap is schema-only: seed the one rule exercised here.
      await ensureDefaultMileageProgram(db);
      sqlite.prepare(`INSERT INTO mileage_rules
        (id,program_id,name,event_type,source,amount,initial_status,conditions,is_active,created_at,updated_at)
        VALUES('builtin-message-received','default','Test message grant','message_received','line',1,
          'available','{"dailyCapActions":5}',1,?,?)`).run(NOW,NOW);
      await applyMileageRulesForEvent(db, {
        eventType: 'message_received', source: 'line', sourceEventId: 'message',
        friendId: 'friend', occurredAt: NOW,
      });
      if (held) {
        sqlite.exec(`CREATE TABLE _line_harness_legacy_mileage_claims (
          engagement_event_id TEXT PRIMARY KEY REFERENCES engagement_events(id), migration_name TEXT NOT NULL,
          mileage_rule_id TEXT NOT NULL, rule_snapshot TEXT NOT NULL);
          INSERT INTO _line_harness_legacy_mileage_claims
          SELECT q.engagement_event_id, '062_mileage_admin_and_activity_rules.sql', r.id,
            json_object('amount',r.amount,'initial_status',r.initial_status,'conditions',r.conditions,
              'source',r.source,'event_type',r.event_type,'is_active',r.is_active,
              'valid_from',r.valid_from,'valid_until',r.valid_until)
          FROM mileage_event_queue q CROSS JOIN mileage_rules r WHERE r.id='builtin-message-received';`);
        sqlite.prepare('UPDATE mileage_event_queue SET available_at=?').run(HELD);
      }
    });
    afterEach(() => {
      expect(fetch).not.toHaveBeenCalled();
      sqlite.close();
      vi.restoreAllMocks();
      vi.useRealTimers();
    });
    const state = () => sqlite.prepare('SELECT * FROM mileage_event_queue').get();
    const ledger = () => sqlite.prepare('SELECT * FROM mileage_ledger ORDER BY id').all();

    it('keeps normal processing and replay idempotent', async () => {
      expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ claimed: 1, processed: 1, failed: 0 });
      const original = ledger();
      expect(original).toHaveLength(1);
      expect(await processPendingMileageEvents(db, { now: NOW })).toEqual({ claimed: 0, processed: 0, failed: 0, granted: 0 });
      expect(ledger()).toEqual(original);
      expect(state()).toMatchObject({ status: 'processed', attempts: 1 });
      if (held) expect(state()).toMatchObject({ available_at: HELD });
    });

    it.each([0, 4])('rejects a stale selected row after attempt %i advances', async attempts => {
      sqlite.prepare('UPDATE mileage_event_queue SET attempts=?').run(attempts);
      sqlite.exec(`CREATE TRIGGER reject_grant BEFORE INSERT ON mileage_ledger
        BEGIN SELECT RAISE(ABORT, 'local projection failure'); END;`);
      const gate = barrier();
      const delayed = asD1(sqlite, { afterList: async sql => {
        if (sql.includes('FROM mileage_event_queue q')) await gate.wait();
      } });
      const old = processPendingMileageEvents(delayed, { now: NOW });
      await gate.entered;
      try {
        expect(await processPendingMileageEvents(db, { now: NOW })).toMatchObject({ claimed: 1, failed: 1 });
      } finally { gate.release(); }
      const newerState = state();
      expect(await old).toEqual({ claimed: 0, processed: 0, failed: 0, granted: 0 });
      expect(state()).toEqual(newerState);
      expect(state()).toMatchObject({ attempts: attempts + 1, status: 'failed' });
      expect(ledger()).toEqual([]);
    });

    it('keeps a newer success when an expired attempt returns a late failure', async () => {
      const gate = barrier();
      const oldDb = asD1(sqlite, { afterRead: async sql => {
        if (sql.includes('SELECT * FROM engagement_events WHERE id')) {
          await gate.wait();
          throw new Error('old read timed out');
        }
      } });
      const old = processPendingMileageEvents(oldDb, { now: NOW });
      await gate.entered;
      let newerState: unknown;
      let original: unknown;
      try {
        expect(await processPendingMileageEvents(db, { now: LATER })).toMatchObject({ claimed: 1, processed: 1, failed: 0 });
        newerState = state();
        original = ledger();
      } finally { gate.release(); }
      expect(await old).toMatchObject({ claimed: 1, failed: 1 });
      expect(state()).toEqual(newerState);
      expect(state()).toMatchObject({ status: 'processed', attempts: 2 });
      expect(ledger()).toEqual(original);
      expect(ledger()).toHaveLength(1);
    });

    it('keeps the current owner at exactly ten minutes and excludes an overlapping tick', async () => {
      const gate = barrier();
      const firstDb = asD1(sqlite, { afterRead: async sql => {
        if (sql.includes('SELECT * FROM engagement_events WHERE id')) await gate.wait();
      } });
      const first = processPendingMileageEvents(firstDb, { now: NOW });
      await gate.entered;
      try {
        for (const now of [NOW, '2026-10-21T10:10:00.000+09:00']) {
          expect(await processPendingMileageEvents(db, { now }))
            .toEqual({ claimed: 0, processed: 0, failed: 0, granted: 0 });
          expect(state()).toMatchObject({ status: 'processing', attempts: 1, processing_started_at: NOW });
        }
      } finally { gate.release(); }
      expect(await first).toMatchObject({ claimed: 1, processed: 1, failed: 0 });
      expect(state()).toMatchObject({ status: 'processed', attempts: 1 });
      expect(ledger()).toHaveLength(1);
    });

    it('keeps the newer retry state when an expired attempt completes late', async () => {
      const gate = barrier();
      const oldDb = asD1(sqlite, { beforeWrite: async sql => {
        if (sql.includes("SET status = 'processed'")) await gate.wait();
      } });
      const old = processPendingMileageEvents(oldDb, { now: NOW });
      await gate.entered;
      const newerDb = asD1(sqlite, { afterRead: async sql => {
        if (sql.includes('SELECT * FROM engagement_events WHERE id')) throw new Error('new read timed out');
      } });
      let newerState: unknown;
      try {
        expect(await processPendingMileageEvents(newerDb, { now: LATER })).toMatchObject({ claimed: 1, failed: 1 });
        newerState = state();
      } finally { gate.release(); }
      expect(await old).toMatchObject({ claimed: 1, processed: 1 });
      expect(state()).toEqual(newerState);
      expect(state()).toMatchObject({ status: 'failed', attempts: 2 });
      expect(ledger()).toHaveLength(1);
      expect(await processPendingMileageEvents(db, { now: '2026-10-21T10:30:00.000+09:00' }))
        .toMatchObject({ claimed: 1, processed: 1, failed: 0 });
      expect(ledger()).toHaveLength(1);
      expect(state()).toMatchObject({ status: 'processed', attempts: 3 });
    });
  });
}
