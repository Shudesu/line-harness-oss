import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { claimWebhookEvent, resetWebhookEventsSeenFlag } from './webhook-dedupe.js';

// vite が node:sqlite を読めないため require で読む
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

// node:sqlite で D1 の形だけまねる（prepare → bind → run）
function fakeD1(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async run() { const r = sqlite.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const DAY = 24 * 60 * 60_000;
let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  resetWebhookEventsSeenFlag();
  sqlite = new DatabaseSync(':memory:');
  db = fakeD1(sqlite);
});

describe('LINE が送り直した知らせ', () => {
  it('初めての番号は処理し、同じ番号の2回目は飛ばす', async () => {
    expect(await claimWebhookEvent(db, 'ev-1', { prune: false })).toBe(true);
    expect(await claimWebhookEvent(db, 'ev-1', { prune: false })).toBe(false);
    expect(await claimWebhookEvent(db, 'ev-2', { prune: false })).toBe(true);
  });

  it('番号が無い知らせは今までどおり毎回処理する', async () => {
    expect(await claimWebhookEvent(db, undefined)).toBe(true);
    expect(await claimWebhookEvent(db, '')).toBe(true);
  });

  it('覚えの読み書きに失敗しても処理は止めない', async () => {
    const broken = { prepare() { throw new Error('db down'); } } as unknown as D1Database;
    expect(await claimWebhookEvent(broken, 'ev-1')).toBe(true);
  });

  it('7日より古い覚えは片付ける', async () => {
    const now = Date.parse('2026-11-08T03:00:00.000Z');
    await claimWebhookEvent(db, 'old', { now: now - 8 * DAY, prune: false });
    await claimWebhookEvent(db, 'recent', { now: now - 1 * DAY, prune: false });
    await claimWebhookEvent(db, 'new', { now, prune: true });
    expect(sqlite.prepare('SELECT id FROM webhook_events_seen ORDER BY id').all()).toEqual([{ id: 'new' }, { id: 'recent' }]);
  });
});
