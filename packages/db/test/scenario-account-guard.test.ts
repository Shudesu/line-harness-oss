import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  enrollFriendInScenario,
  scenarioAllowedForFriendAccount,
} from '../src/scenarios.js';

/**
 * Cross-account enrollment guard.
 *
 * Regression: a friend row is shared across every channel of the same LINE
 * provider (same userId), so following a SECOND account reuses the row and
 * only rewrites line_account_id — the ref_code issued by the FIRST account
 * survives. The follow handler then resolved that stale ref to an entry_route
 * owned by the first account and enrolled the friend in its scenario; the
 * delivery worker picks its push client from the friend's CURRENT account, so
 * account A's step message went out of account B's official account.
 */

const __dirname = dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = join(__dirname, '..');
const MIGRATIONS_DIR = join(PKG_ROOT, 'migrations');

const BENIGN = /duplicate column name|already exists/i;

function execSafe(db: Database.Database, sql: string): void {
  for (const stmt of sql
    .split(/;\s*(?:\r?\n|$)/)
    .map((s) => s.trim())
    .filter(Boolean)) {
    try {
      db.exec(stmt);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (!BENIGN.test(msg)) throw err;
    }
  }
}

function setupDb(): Database.Database {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PKG_ROOT, 'schema.sql'), 'utf8'));
  const migrationFiles = readdirSync(MIGRATIONS_DIR)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  for (const file of migrationFiles) {
    execSafe(db, readFileSync(join(MIGRATIONS_DIR, file), 'utf8'));
  }
  return db;
}

// enrollFriendInScenario gates on result.meta.changes, so the wrapper has to
// surface better-sqlite3's change count (an empty meta reads as "no insert").
function asD1(sqlite: Database.Database): D1Database {
  const wrap = (query: string, params: unknown[]) => {
    const stmt = sqlite.prepare(query);
    return {
      async run() {
        const info = stmt.run(...params);
        return {
          results: [],
          success: true,
          meta: { changes: info.changes, last_row_id: Number(info.lastInsertRowid) },
        };
      },
      async first<T>() {
        return (stmt.get(...params) as T) ?? null;
      },
      async all<T>() {
        return { results: stmt.all(...params) as T[], success: true, meta: {} };
      },
    };
  };
  return {
    prepare(query: string) {
      return {
        bind: (...params: unknown[]) => wrap(query, params),
        ...wrap(query, []),
      };
    },
  } as unknown as D1Database;
}

const ACCOUNT_A = 'acct-beauty-trend-lab';
const ACCOUNT_B = 'acct-ai-blossom';

function seed(
  sqlite: Database.Database,
  opts: { friendAccount: string | null; scenarioAccount: string | null },
): { friendId: string; scenarioId: string } {
  const friendId = 'friend-1';
  const scenarioId = 'scenario-1';

  for (const [id, name] of [
    [ACCOUNT_A, 'Beauty Trend Lab'],
    [ACCOUNT_B, 'AI BLOSSOM'],
  ]) {
    sqlite
      .prepare(
        `INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
         VALUES (?, ?, ?, 'token', 'secret')`,
      )
      .run(id, `channel-${id}`, name);
  }

  sqlite
    .prepare(
      `INSERT INTO friends (id, line_user_id, display_name, line_account_id, ref_code)
       VALUES (?, 'U-shared-across-channels', 'はるな', ?, 'slimming')`,
    )
    .run(friendId, opts.friendAccount);

  sqlite
    .prepare(
      `INSERT INTO scenarios (id, name, trigger_type, is_active, delivery_mode, line_account_id)
       VALUES (?, '痩身ステップ配信', 'manual', 1, 'absolute_time', ?)`,
    )
    .run(scenarioId, opts.scenarioAccount);

  sqlite
    .prepare(
      `INSERT INTO scenario_steps (id, scenario_id, step_order, delay_minutes, message_type, message_content, offset_days, delivery_time)
       VALUES ('step-1', ?, 1, 0, 'text', '「がんばってるのに痩せない」その理由', 1, '20:00')`,
    )
    .run(scenarioId);

  return { friendId, scenarioId };
}

function enrollmentCount(sqlite: Database.Database): number {
  const row = sqlite.prepare('SELECT COUNT(*) AS n FROM friend_scenarios').get() as { n: number };
  return row.n;
}

describe('cross-account scenario enrollment guard', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = setupDb();
  });

  test('does not enroll a friend in another account\'s scenario', async () => {
    const { friendId, scenarioId } = seed(sqlite, {
      friendAccount: ACCOUNT_B,
      scenarioAccount: ACCOUNT_A,
    });

    const result = await enrollFriendInScenario(asD1(sqlite), friendId, scenarioId);

    expect(result).toBeNull();
    expect(enrollmentCount(sqlite)).toBe(0);
  });

  test('enrolls when the scenario belongs to the friend\'s own account', async () => {
    const { friendId, scenarioId } = seed(sqlite, {
      friendAccount: ACCOUNT_A,
      scenarioAccount: ACCOUNT_A,
    });

    const result = await enrollFriendInScenario(asD1(sqlite), friendId, scenarioId);

    expect(result).not.toBeNull();
    expect(enrollmentCount(sqlite)).toBe(1);
  });

  test('enrolls when the scenario is unassigned (single-account install)', async () => {
    const { friendId, scenarioId } = seed(sqlite, {
      friendAccount: ACCOUNT_B,
      scenarioAccount: null,
    });

    const result = await enrollFriendInScenario(asD1(sqlite), friendId, scenarioId);

    expect(result).not.toBeNull();
    expect(enrollmentCount(sqlite)).toBe(1);
  });

  test('enrolls when the friend has no account yet', async () => {
    const { friendId, scenarioId } = seed(sqlite, {
      friendAccount: null,
      scenarioAccount: ACCOUNT_A,
    });

    const result = await enrollFriendInScenario(asD1(sqlite), friendId, scenarioId);

    expect(result).not.toBeNull();
    expect(enrollmentCount(sqlite)).toBe(1);
  });

  describe('scenarioAllowedForFriendAccount', () => {
    test('rejects only a hard mismatch', async () => {
      const { friendId } = seed(sqlite, {
        friendAccount: ACCOUNT_B,
        scenarioAccount: ACCOUNT_A,
      });
      const db = asD1(sqlite);

      expect(await scenarioAllowedForFriendAccount(db, friendId, ACCOUNT_A)).toBe(false);
      expect(await scenarioAllowedForFriendAccount(db, friendId, ACCOUNT_B)).toBe(true);
      expect(await scenarioAllowedForFriendAccount(db, friendId, null)).toBe(true);
    });

    test('allows an unknown friend id rather than blocking delivery', async () => {
      expect(await scenarioAllowedForFriendAccount(asD1(sqlite), 'missing', ACCOUNT_A)).toBe(true);
    });
  });
});
