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

// grandfathered (< 041) かつ破壊的な migration (027/029 の DROP TABLE / RENAME TO):
// adoption (adoptGrandfathered) では probe でスキーマ実在を確認の上「記録のみ」で通し、
// 破壊的でない pre-041 は従来どおり実行する。2026-09-02 に 0.0.0-dev 環境の adoption が
// 検証段階の throw で必ず停止する報告があった。
describe('grandfathered migrations (adopt-stamp)', () => {
  const DESTRUCTIVE_027 = Buffer.from(
    'CREATE TABLE friend_scenarios_new (id TEXT PRIMARY KEY);\n' +
      'DROP TABLE friend_scenarios;\n' +
      'ALTER TABLE friend_scenarios_new RENAME TO friend_scenarios;',
  );

  /** probe (センチネル確認) に成功応答を返す記録付き executor。 */
  function recordingExecute(opts: { probeRow?: Record<string, number> | null; priorChecksum?: string } = {}) {
    const calls: Array<{ sql: string; params?: any[] }> = [];
    const execute = vi.fn(async (req: { sql: string; params?: any[] }) => {
      calls.push({ sql: req.sql, params: req.params });
      if (req.sql.includes('SELECT checksum')) {
        return {
          success: true,
          result: [{ results: opts.priorChecksum ? [{ checksum: opts.priorChecksum }] : [] }],
        };
      }
      if (req.sql.includes('AS bootstrapped')) {
        const row = opts.probeRow === undefined
          ? { bootstrapped: 1, m027: 1, m029: 1 }
          : opts.probeRow;
        return { success: true, result: [{ results: row ? [row] : [] }] };
      }
      return { success: true, result: [] };
    });
    return { calls, execute };
  }

  it('stamps a destructive pre-041 migration into the ledger without executing it', async () => {
    const { calls, execute } = recordingExecute();

    const [result] = await applyD1Migrations({
      creds,
      databaseId: 'db',
      names: ['027_dedup_delivery.sql'],
      migrations: new Map([['027_dedup_delivery.sql', DESTRUCTIVE_027]]),
      adoptGrandfathered: true,
      execute: execute as any,
    });

    expect(result).toMatchObject({
      name: '027_dedup_delivery.sql',
      alreadyApplied: false,
      adopted: true,
      executedStatements: 0,
      skippedStatements: 0,
    });
    // 破壊的 SQL は 1 文も D1 に送られていない
    expect(calls.some((c) => /DROP TABLE|RENAME TO/i.test(c.sql))).toBe(false);
    // probe が走り、台帳には記録されている
    expect(calls.some((c) => c.sql.includes('AS bootstrapped'))).toBe(true);
    expect(
      calls.some(
        (c) =>
          c.sql.includes('INSERT INTO _line_harness_migrations') &&
          c.params?.[0] === '027_dedup_delivery.sql',
      ),
    ).toBe(true);
  });

  it('additive pre-041 migrations still EXECUTE under adoption (no stamp)', async () => {
    // 旧 CLI インストール (migration 027 以前から存在) には 030-040 が本当に
    // 未適用の DB があり得る。additive はブリッジとして実行されねばならない。
    const { calls, execute } = recordingExecute();

    const results = await applyD1Migrations({
      creds,
      databaseId: 'db',
      names: ['027_dedup_delivery.sql', '031_batch_lock_at.sql'],
      migrations: new Map([
        ['027_dedup_delivery.sql', DESTRUCTIVE_027],
        ['031_batch_lock_at.sql', Buffer.from('ALTER TABLE broadcasts ADD COLUMN batch_lock_at TEXT;')],
      ]),
      adoptGrandfathered: true,
      execute: execute as any,
    });

    expect(results.map((r) => ({ name: r.name, adopted: r.adopted ?? false }))).toEqual([
      { name: '027_dedup_delivery.sql', adopted: true },
      { name: '031_batch_lock_at.sql', adopted: false },
    ]);
    expect(calls.some((c) => c.sql.includes('ADD COLUMN batch_lock_at'))).toBe(true);
    expect(calls.some((c) => /DROP TABLE/i.test(c.sql))).toBe(false);
  });

  it('refuses to stamp when the DB predates the destructive migrations (probe fails)', async () => {
    // probe 失敗 = 027/029 適用前の取り残し DB。台帳へは一切書かず明示エラー。
    const { calls, execute } = recordingExecute({
      probeRow: { bootstrapped: 1, m027: 0, m029: 1 },
    });

    await expect(
      applyD1Migrations({
        creds,
        databaseId: 'db',
        names: ['027_dedup_delivery.sql'],
        migrations: new Map([['027_dedup_delivery.sql', DESTRUCTIVE_027]]),
        adoptGrandfathered: true,
        execute: execute as any,
      }),
    ).rejects.toThrow(/adoption を中止しました/);
    expect(calls.some((c) => c.sql.includes('INSERT INTO _line_harness_migrations'))).toBe(false);
  });

  it('does not block on a checksum mismatch for an adoptable migration (never executed anyway)', async () => {
    const { execute } = recordingExecute({ priorChecksum: 'sha256:old-bytes' });

    const [result] = await applyD1Migrations({
      creds,
      databaseId: 'db',
      names: ['029_account_management_v2.sql'],
      migrations: new Map([
        ['029_account_management_v2.sql', Buffer.from('DROP TABLE broadcasts_old;')],
      ]),
      adoptGrandfathered: true,
      execute: execute as any,
    });
    expect(result).toMatchObject({ alreadyApplied: true });
  });

  it('without adoptGrandfathered, destructive pre-041 still fails validation (normal updates unchanged)', async () => {
    const execute = vi.fn(async () => ({ success: true, result: [] }));
    await expect(
      applyD1Migrations({
        creds,
        databaseId: 'db',
        names: ['027_dedup_delivery.sql'],
        migrations: new Map([['027_dedup_delivery.sql', DESTRUCTIVE_027]]),
        execute: execute as any,
      }),
    ).rejects.toThrow(/destructive schema changes/);
    expect(execute).not.toHaveBeenCalled();
  });

  it('still rejects destructive SQL in post-cutoff migrations even under adoption', async () => {
    const execute = vi.fn(async () => ({ success: true, result: [] }));
    await expect(
      applyD1Migrations({
        creds,
        databaseId: 'db',
        names: ['071_bad.sql'],
        migrations: new Map([['071_bad.sql', Buffer.from('DROP TABLE friends;')]]),
        adoptGrandfathered: true,
        execute: execute as any,
      }),
    ).rejects.toThrow(/destructive schema changes/);
    // 検証段階で止まるので D1 には何も送られていない
    expect(execute).not.toHaveBeenCalled();
  });
});
