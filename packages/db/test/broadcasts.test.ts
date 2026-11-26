import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createBroadcast } from '../src/broadcasts.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      const stmt = sqlite.prepare(query);
      return {
        bind(...params: unknown[]) {
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('createBroadcast', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(readFileSync(join(__dirname, '../schema.sql'), 'utf8'));
    // schema.sql is the historical base schema; these production migrations
    // add the columns createBroadcast writes atomically today.
    sqlite.exec('ALTER TABLE broadcasts ADD COLUMN line_account_id TEXT');
    sqlite.exec('ALTER TABLE broadcasts ADD COLUMN alt_text TEXT');
    db = asD1(sqlite);
  });

  test('persists a caller-supplied stable id and account fields atomically', async () => {
    const id = '11111111-2222-4333-8444-555555555555';
    const result = await createBroadcast(db, {
      id,
      title: 'Personalized notice',
      messageType: 'text',
      messageContent: '{{name}}さんへ',
      targetType: 'all',
      scheduledAt: '2026-08-12T09:00:00.000+09:00',
      lineAccountId: 'account-1',
      altText: '通知',
    });

    expect(result.id).toBe(id);
    expect(result.status).toBe('scheduled');
    expect(result.line_account_id).toBe('account-1');
    expect(result.alt_text).toBe('通知');
  });

  test('the same stable id cannot create a second row', async () => {
    const input = {
      id: '11111111-2222-4333-8444-555555555555',
      title: 'Notice',
      messageType: 'text' as const,
      messageContent: 'hello',
      targetType: 'all' as const,
    };

    await createBroadcast(db, input);
    await expect(createBroadcast(db, input)).rejects.toThrow(/UNIQUE constraint failed/);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM broadcasts').get()).toEqual({ count: 1 });
  });
});
