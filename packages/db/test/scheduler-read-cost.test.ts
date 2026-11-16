import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getFriendScenariosDueForDelivery } from '../src/scenarios.js';
import { getBroadcasts, getScheduledBroadcastCandidates } from '../src/broadcasts.js';

// Workers のランタイムは UTC。タイムゾーン表記の無い旧データの解釈を本番と揃える。
const originalTz = process.env.TZ;
beforeAll(() => { process.env.TZ = 'UTC'; });
afterAll(() => { process.env.TZ = originalTz; });

const schema = readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8');
type Query = { sql: string; params: unknown[] };

/** better-sqlite3 を D1 の最小インターフェースに見せるアダプタ。 */
function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      const stmt = sqlite.prepare(sql);
      const run = (params: unknown[]) => ({
        async all<T>() { return { results: stmt.all(...params) as T[], success: true }; },
        async first<T>() { return (stmt.get(...params) as T) ?? null; },
      });
      return { ...run([]), bind: (...params: unknown[]) => run(params) };
    },
  } as unknown as D1Database;
}

/** 変更前の実装 (active 全件取得 → JS で期限判定)。回帰比較用。 */
function legacyDueScenarios(sqlite: Database.Database, now: string) {
  const rows = sqlite.prepare(
    `SELECT fs.* FROM friend_scenarios fs
       INNER JOIN scenarios s ON fs.scenario_id = s.id
       WHERE fs.status = 'active' AND s.is_active = 1 AND fs.next_delivery_at IS NOT NULL`,
  ).all() as Array<{ id: string; next_delivery_at: string }>;
  const nowMs = new Date(now).getTime();
  return rows
    .filter((r) => new Date(r.next_delivery_at).getTime() <= nowMs)
    .sort((a, b) => new Date(a.next_delivery_at).getTime() - new Date(b.next_delivery_at).getTime());
}

function capture(run: (db: D1Database) => Promise<unknown>): Promise<Query> {
  let captured: Query | null = null;
  const stmt = (sql: string, params: unknown[]) => ({
    async all() { captured = { sql, params }; return { results: [] }; },
  });
  const db = { prepare: (sql: string) => ({ ...stmt(sql, []), bind: (...p: unknown[]) => stmt(sql, p) }) } as unknown as D1Database;
  return run(db).then(() => {
    if (!captured) throw new Error('query was not issued');
    return captured;
  });
}

describe('getFriendScenariosDueForDelivery — 期限到来分だけを読む (挙動は従来どおり)', () => {
  const NOW = '2026-11-16T12:00:00.000+09:00'; // = 03:00:00Z
  function seed() {
    const sqlite = new Database(':memory:');
    sqlite.exec(schema);
    sqlite.exec(`INSERT INTO scenarios (id, name, trigger_type, is_active) VALUES ('on','on','manual',1),('off','off','manual',0)`);
    const values: Array<[string, string, string, string | null]> = [
      ['jst-due', 'on', 'active', '2026-11-16T11:59:59.999+09:00'],
      ['jst-exact', 'on', 'active', '2026-11-16T12:00:00.000+09:00'],
      ['z-exact', 'on', 'active', '2026-11-16T03:00:00.000Z'],
      ['z-due', 'on', 'active', '2026-11-16T02:00:00Z'],
      ['z-1ms-late', 'on', 'active', '2026-11-16T03:00:00.001Z'],
      ['jst-future', 'on', 'active', '2026-11-16T12:00:01.000+09:00'],
      ['naive-due', 'on', 'active', '2026-11-16T02:59:00.000'], // TZ なし = UTC 扱い (Workers と同じ)
      ['naive-future', 'on', 'active', '2026-11-16T03:00:01'],
      ['space-due', 'on', 'active', '2026-11-15 23:00:00'],
      ['old', 'on', 'active', '2025-01-01T00:00:00.000+09:00'],
      ['paused', 'on', 'paused', '2026-11-16T00:00:00.000+09:00'],
      ['completed', 'on', 'completed', '2026-11-16T00:00:00.000+09:00'],
      ['inactive-scenario', 'off', 'active', '2026-11-16T00:00:00.000+09:00'],
      ['no-time', 'on', 'active', null],
      ['garbage', 'on', 'active', 'not-a-date'],
    ];
    sqlite.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, ?)`);
    const f = sqlite.prepare(`INSERT INTO friends (id, line_user_id) VALUES (?, ?)`);
    const fs = sqlite.prepare(`INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at) VALUES (?, ?, ?, ?, ?)`);
    values.forEach(([id, sc, st, at]) => { f.run(`f-${id}`, `U-${id}`); fs.run(id, `f-${id}`, sc, st, at); });
    return sqlite;
  }

  it('Z / +09:00 / TZ なし表記が混在しても、従来の実装と同じ行を同じ順で返す', async () => {
    const sqlite = seed();
    const legacy = legacyDueScenarios(sqlite, NOW).map((r) => r.id);
    const now = (await getFriendScenariosDueForDelivery(asD1(sqlite), NOW)).map((r) => r.id);
    expect(now).toEqual(legacy);
    expect(now).toEqual(['old', 'space-due', 'z-due', 'naive-due', 'jst-due', 'jst-exact', 'z-exact']);
  });

  it('limit を付けても、期限の早い順の先頭 limit 件は従来と同じ', async () => {
    const sqlite = seed();
    const legacy = legacyDueScenarios(sqlite, NOW).map((r) => r.id);
    for (const limit of [1, 3, 7, 40]) {
      const got = (await getFriendScenariosDueForDelivery(asD1(sqlite), NOW, limit)).map((r) => r.id);
      expect(got.slice(0, limit)).toEqual(legacy.slice(0, limit));
    }
  });

  it('julianday が解釈できない旧表記も従来どおり JS の判定に回す', async () => {
    const sqlite = seed();
    // SQLite の julianday は '+0900' (コロン無し) を解釈しないが、JS の Date は解釈する
    sqlite.exec(`INSERT INTO friends (id, line_user_id) VALUES ('f-x','U-x')`);
    sqlite.exec(`INSERT INTO friend_scenarios (id, friend_id, scenario_id, status, next_delivery_at)
                 VALUES ('legacy-offset','f-x','on','active','2026-11-16T10:00:00+0900')`);
    expect(sqlite.prepare(`SELECT julianday('2026-11-16T10:00:00+0900') AS j`).get()).toEqual({ j: null });
    const legacy = legacyDueScenarios(sqlite, NOW).map((r) => r.id);
    const got = (await getFriendScenariosDueForDelivery(asD1(sqlite), NOW, 2)).map((r) => r.id);
    expect(legacy).toContain('legacy-offset');
    expect(got).toContain('legacy-offset');
    expect(got.slice(0, 2)).toEqual(legacy.slice(0, 2));
  });
});

describe('getScheduledBroadcastCandidates — 予約配信チェックは予約中だけを読む', () => {
  it('毎分チェックの対象 (期限到来の予約中) は getBroadcasts で絞った場合と同じ', async () => {
    const sqlite = new Database(':memory:');
    sqlite.exec(schema);
    const b = sqlite.prepare(`INSERT INTO broadcasts (id, title, message_type, message_content, status, scheduled_at, sent_at, created_at)
                              VALUES (?, 't', 'text', 'x', ?, ?, ?, ?)`);
    b.run('due-jst', 'scheduled', '2026-11-16T11:00:00.000+09:00', null, '2026-11-01 00:00:00');
    b.run('due-z', 'scheduled', '2026-11-16T01:00:00.000Z', null, '2026-11-01 00:00:00');
    b.run('future', 'scheduled', '2026-11-17T00:00:00.000+09:00', null, '2026-11-01 00:00:00');
    b.run('no-time', 'scheduled', null, null, '2026-11-01 00:00:00');
    b.run('draft', 'draft', '2026-11-16T00:00:00.000+09:00', null, '2026-11-01 00:00:00');
    b.run('sent', 'sent', '2026-11-16T00:00:00.000+09:00', '2026-11-16T00:00:01.000+09:00', '2026-11-01 00:00:00');
    b.run('sending', 'sending', '2026-11-16T00:00:00.000+09:00', null, '2026-11-01 00:00:00');
    sqlite.exec(`INSERT INTO broadcast_insights (id, broadcast_id, status) VALUES ('i1','sent','ready'),('i2','due-jst','pending')`);
    const nowMs = new Date('2026-11-16T12:00:00.000+09:00').getTime();
    const due = (rows: Array<{ id: string; status: string; scheduled_at: string | null }>) => rows
      .filter((r) => r.status === 'scheduled' && r.scheduled_at !== null && new Date(r.scheduled_at).getTime() <= nowMs)
      .map((r) => r.id);
    const db = asD1(sqlite);
    const legacy = due(await getBroadcasts(db));
    const candidates = await getScheduledBroadcastCandidates(db);
    expect(due(candidates)).toEqual(legacy);
    expect(legacy).toEqual(['due-jst', 'due-z']);
    expect(candidates.every((r) => r.status === 'scheduled' && r.scheduled_at !== null)).toBe(true);
  });
});

it('毎分ジョブの読み取りが無関係データ量 (1x / 100x / 1000x) に比例しない', async () => {
  const now = '2026-11-16T12:00:00.000+09:00';
  const scenarios = await capture((db) => getFriendScenariosDueForDelivery(db, now, 40));
  const broadcasts = await capture((db) => getScheduledBroadcastCandidates(db));
  const legacyScenarios = await capture(async (db) => {
    await db.prepare(`SELECT fs.* FROM friend_scenarios fs
       INNER JOIN scenarios s ON fs.scenario_id = s.id
       WHERE fs.status = 'active' AND s.is_active = 1 AND fs.next_delivery_at IS NOT NULL`).all();
  });
  const legacyBroadcasts = await capture((db) => getBroadcasts(db));
  const result = spawnSync('python3', [fileURLToPath(new URL('./helpers/scheduler-cost-probe.py', import.meta.url))], {
    input: JSON.stringify({ schema, now, queries: { scenarios, broadcasts },
      legacy: { scenarios: legacyScenarios, broadcasts: legacyBroadcasts } }),
    encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.unit).toBe('sqlite_vm_instructions_not_d1_rows');
  expect(report.growth.map((r: { scale: number }) => r.scale)).toEqual([1, 100, 1000]);
  console.info('scheduler-cost-report', JSON.stringify(report));
}, 130_000);
