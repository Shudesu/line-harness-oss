import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  internRoleOfGroup,
  loadInternRichMenuChoice,
  relinkInternFriends,
  resolveInternRichMenuIds,
  saveInternRichMenuChoice,
} from './intern-richmenus.js';

// vite が node:sqlite を読めないため require で読む
const { DatabaseSync } = createRequire(import.meta.url)('node:sqlite') as typeof import('node:sqlite');
type DatabaseSync = InstanceType<typeof DatabaseSync>;

// node:sqlite で D1 の形だけまねる（prepare → bind → first / all / run）
function fakeD1(sqlite: DatabaseSync): D1Database {
  const prepare = (sql: string) => {
    let args: unknown[] = [];
    const stmt = {
      bind(...a: unknown[]) { args = a; return stmt; },
      async first<T>() { return (sqlite.prepare(sql).get(...(args as never[])) as T) ?? null; },
      async all<T>() { return { results: sqlite.prepare(sql).all(...(args as never[])) as T[] }; },
      async run() { const r = sqlite.prepare(sql).run(...(args as never[])); return { meta: { changes: Number(r.changes) } }; },
    };
    return stmt;
  };
  return { prepare } as unknown as D1Database;
}

const ACCOUNT = 'acct-intern';
let sqlite: DatabaseSync;
let db: D1Database;

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE account_settings (id TEXT PRIMARY KEY, line_account_id TEXT, key TEXT, value TEXT, created_at TEXT, updated_at TEXT, UNIQUE (line_account_id, key));
    CREATE TABLE rich_menu_groups (id TEXT PRIMARY KEY, account_id TEXT, name TEXT, default_page_id TEXT, status TEXT);
    CREATE TABLE rich_menu_pages (id TEXT PRIMARY KEY, group_id TEXT, order_index INTEGER, line_richmenu_id TEXT);
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_user_id TEXT, line_account_id TEXT, is_following INTEGER, metadata TEXT);
    INSERT INTO rich_menu_groups VALUES ('g-lock', '${ACCOUNT}', '鍵付き', NULL, 'published');
    INSERT INTO rich_menu_pages VALUES ('p-lock', 'g-lock', 0, 'richmenu-lock');
    INSERT INTO rich_menu_groups VALUES ('g-open', '${ACCOUNT}', '解放後', NULL, 'published');
    INSERT INTO rich_menu_pages VALUES ('p-open', 'g-open', 0, 'richmenu-open');
    INSERT INTO rich_menu_groups VALUES ('g-draft', '${ACCOUNT}', '下書き', NULL, 'draft');
    INSERT INTO rich_menu_pages VALUES ('p-draft', 'g-draft', 0, NULL);
    INSERT INTO rich_menu_groups VALUES ('g-other', 'acct-other', 'ほかのアカウント', NULL, 'published');
    INSERT INTO rich_menu_pages VALUES ('p-other', 'g-other', 0, 'richmenu-other');
    INSERT INTO friends VALUES ('f1', 'U1', '${ACCOUNT}', 1, '{"survey_step":"done"}');
    INSERT INTO friends VALUES ('f2', 'U2', '${ACCOUNT}', 1, '{"survey_step":"grade"}');
    INSERT INTO friends VALUES ('f3', 'U3', '${ACCOUNT}', 1, NULL);
    INSERT INTO friends VALUES ('f4', 'U4', '${ACCOUNT}', 0, '{"survey_step":"done"}');
    INSERT INTO friends VALUES ('f5', 'U5', '${ACCOUNT}', 0, NULL);
    INSERT INTO friends VALUES ('f6', 'U6', 'acct-other', 1, NULL);
  `);
  db = fakeD1(sqlite);
});

describe('KIDOUインターンの鍵付き・解放後のメニュー選び', () => {
  it('選んでいなければ空（秘密の値のメニューを使う）', async () => {
    expect(await loadInternRichMenuChoice(db, ACCOUNT)).toEqual({ lockedGroupId: null, unlockedGroupId: null });
    expect(await resolveInternRichMenuIds(db, ACCOUNT)).toEqual({});
  });

  it('選んだメニューの、いま LINE 上にある ID を引く', async () => {
    await saveInternRichMenuChoice(db, ACCOUNT, { lockedGroupId: 'g-lock', unlockedGroupId: 'g-open' });
    expect(await resolveInternRichMenuIds(db, ACCOUNT)).toEqual({ locked: 'richmenu-lock', unlocked: 'richmenu-open' });
    // 公開し直して ID が変わったら新しいほうを引く
    sqlite.exec("UPDATE rich_menu_pages SET line_richmenu_id = 'richmenu-lock-2' WHERE id = 'p-lock'");
    expect((await resolveInternRichMenuIds(db, ACCOUNT)).locked).toBe('richmenu-lock-2');
  });

  it('公開していない・ほかのアカウントのメニューは引かない', async () => {
    await saveInternRichMenuChoice(db, ACCOUNT, { lockedGroupId: 'g-draft', unlockedGroupId: 'g-other' });
    expect(await resolveInternRichMenuIds(db, ACCOUNT)).toEqual({});
  });

  it('壊れた保存は選んでいない扱い', async () => {
    sqlite.exec(`INSERT INTO account_settings VALUES ('s1', '${ACCOUNT}', 'intern_richmenus', '{oops', '', '')`);
    expect(await loadInternRichMenuChoice(db, ACCOUNT)).toEqual({ lockedGroupId: null, unlockedGroupId: null });
  });

  it('メニューがどの役に選ばれているかを返す', async () => {
    await saveInternRichMenuChoice(db, ACCOUNT, { lockedGroupId: 'g-lock', unlockedGroupId: 'g-open' });
    expect(await internRoleOfGroup(db, ACCOUNT, 'g-lock')).toEqual(['locked']);
    expect(await internRoleOfGroup(db, ACCOUNT, 'g-open')).toEqual(['unlocked']);
    expect(await internRoleOfGroup(db, ACCOUNT, 'g-draft')).toEqual([]);
  });
});

describe('友だちへの付け直し', () => {
  function fakeLine() {
    const calls: { richMenuId: string; userIds: string[] }[] = [];
    return { calls, line: { async linkRichMenuBulk(richMenuId: string, userIds: string[]) { calls.push({ richMenuId, userIds }); } } };
  }

  it('答え終えた人には解放後、ブロック中とほかのアカウントの人は外す', async () => {
    const { calls, line } = fakeLine();
    expect(await relinkInternFriends(db, line, ACCOUNT, 'unlocked', 'richmenu-open')).toBe(1);
    expect(calls).toEqual([{ richMenuId: 'richmenu-open', userIds: ['U1'] }]);
  });

  it('まだ答え終えていない人（途中・未回答）には鍵付き', async () => {
    const { calls, line } = fakeLine();
    expect(await relinkInternFriends(db, line, ACCOUNT, 'locked', 'richmenu-lock')).toBe(2);
    expect(calls[0].userIds.sort()).toEqual(['U2', 'U3']);
  });
});
