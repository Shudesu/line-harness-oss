import { describe, expect, it, vi } from 'vitest';
import {
  applyD1Migrations,
  splitSqlStatements,
} from '../src/migrations.js';

const creds = { accountId: 'account', apiToken: 'token' };

describe('splitSqlStatements', () => {
  it('rejects destructive table rebuilds', () => {
    expect(() => splitSqlStatements('DROP TABLE friends;')).toThrow(
      'destructive schema changes',
    );
    expect(() => splitSqlStatements('ALTER TABLE old RENAME TO current;')).toThrow(
      'destructive schema changes',
    );
  });
  it('splits statements while preserving semicolons inside strings and comments', () => {
    const sql = `
      -- first; comment
      CREATE TABLE demo (value TEXT);
      INSERT INTO demo VALUES ('a;b');
      /* block; comment */ UPDATE demo SET value = "c;d";
    `;

    expect(splitSqlStatements(sql)).toEqual([
      '-- first; comment\n      CREATE TABLE demo (value TEXT)',
      "INSERT INTO demo VALUES ('a;b')",
      '/* block; comment */ UPDATE demo SET value = "c;d"',
    ]);
  });

  it('ignores empty and comment-only fragments', () => {
    expect(splitSqlStatements('-- only a comment;\n; /* another */')).toEqual([]);
  });

  it('rejects trigger bodies instead of splitting them incorrectly', () => {
    expect(() =>
      splitSqlStatements(
        'CREATE TRIGGER t AFTER INSERT ON a BEGIN UPDATE b SET x = 1; END;',
      ),
    ).toThrow(/CREATE TRIGGER/);
  });
});

describe('applyD1Migrations', () => {
  it('continues later statements after a duplicate column and records completion', async () => {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const execute = vi.fn(async (opts: { sql: string; params?: any[] }) => {
      calls.push({ sql: opts.sql, params: opts.params });
      if (opts.sql.includes('SELECT checksum')) {
        return { success: true, result: [{ results: [] }] };
      }
      if (opts.sql.includes('ADD COLUMN existing')) {
        throw new Error('duplicate column name: existing');
      }
      return { success: true, result: [] };
    });

    const [result] = await applyD1Migrations({
      creds,
      databaseId: 'db',
      names: ['046_partial.sql'],
      migrations: new Map([
        [
          '046_partial.sql',
          Buffer.from(
            'ALTER TABLE demo ADD COLUMN existing TEXT; ALTER TABLE demo ADD COLUMN missing TEXT;',
          ),
        ],
      ]),
      execute: execute as any,
    });

    expect(result).toMatchObject({
      alreadyApplied: false,
      executedStatements: 1,
      skippedStatements: 1,
    });
    expect(calls.some((call) => call.sql.includes('ADD COLUMN missing'))).toBe(true);
    expect(calls.at(-1)?.sql).toContain('INSERT INTO _line_harness_migrations');
  });

  it('skips a migration whose matching checksum is already recorded', async () => {
    const source = Buffer.from('CREATE TABLE demo (id TEXT);');
    const { createHash } = await import('node:crypto');
    const checksum = `sha256:${createHash('sha256').update(source).digest('hex')}`;
    const execute = vi.fn(async (opts: { sql: string }) => {
      if (opts.sql.includes('SELECT checksum')) {
        return {
          success: true,
          result: [{ results: [{ checksum }] }],
        };
      }
      return { success: true, result: [] };
    });

    const [result] = await applyD1Migrations({
      creds,
      databaseId: 'db',
      names: ['041_demo.sql'],
      migrations: new Map([['041_demo.sql', source]]),
      execute: execute as any,
    });

    expect(result.alreadyApplied).toBe(true);
    expect(execute).toHaveBeenCalledTimes(2); // ledger CREATE + checksum SELECT
  });

  it('fails before any D1 write when the bundle is missing a declared migration', async () => {
    const execute = vi.fn();
    await expect(
      applyD1Migrations({
        creds,
        databaseId: 'db',
        names: ['missing.sql'],
        migrations: new Map(),
        execute: execute as any,
      }),
    ).rejects.toThrow(/missing\.sql missing in bundle/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('refuses to reuse a migration filename with different bytes', async () => {
    const execute = vi.fn(async (opts: { sql: string }) => {
      if (opts.sql.includes('SELECT checksum')) {
        return {
          success: true,
          result: [{ results: [{ checksum: 'sha256:old' }] }],
        };
      }
      return { success: true, result: [] };
    });

    await expect(
      applyD1Migrations({
        creds,
        databaseId: 'db',
        names: ['041_demo.sql'],
        migrations: new Map([
          ['041_demo.sql', Buffer.from('CREATE TABLE changed (id TEXT);')],
        ]),
        execute: execute as any,
      }),
    ).rejects.toThrow(/changed after it was applied/);
  });
});
