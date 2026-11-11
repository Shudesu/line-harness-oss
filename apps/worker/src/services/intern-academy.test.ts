import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { buildAcademyRequestDoneText, parseAcademyRequestDone, sendAcademyRequestDone } from './intern-academy.js';
import { COPY_SETTING_KEY, DEFAULT_COPY } from './intern-copy.js';

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

const ACCOUNT = 'acc-intern';
const USER = 'U' + 'a'.repeat(32);
const REQ = '0f8fad5b-d9cb-469f-a165-70867728950e';
const URL = 'https://liff.line.me/2000000000-abcdefgh/academy?course=x';
const valid = { line_user_id: USER, title: '  ES の書き方  ', url: URL, request_id: REQ };

describe('parseAcademyRequestDone', () => {
  it('正しい中身はそろえて通す', () => {
    expect(parseAcademyRequestDone(valid)).toEqual({ lineUserId: USER, title: 'ES の書き方', url: URL, requestId: REQ });
  });
  it('おかしな中身は断る', () => {
    expect(parseAcademyRequestDone(null)).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, line_user_id: 'U123' })).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, title: '   ' })).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, title: 'あ'.repeat(81) })).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, url: 'https://example.com/x' })).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, url: URL + 'a'.repeat(300) })).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, url: URL + '\nほか' })).toBeNull();
    expect(parseAcademyRequestDone({ ...valid, request_id: 'abc' })).toBeNull();
  });
});

describe('buildAcademyRequestDoneText', () => {
  it('{講座名} を置き換え、最後の行にリンクを付ける', () => {
    const t = buildAcademyRequestDoneText(DEFAULT_COPY.academyRequest.done, 'ES の書き方', URL);
    expect(t).toContain('「ES の書き方」を用意しました');
    expect(t.split('\n').pop()).toBe(URL);
  });
  it('長い文は1000字で切る', () => {
    const t = buildAcademyRequestDoneText('あ'.repeat(2000), 'x', URL);
    expect(t.length).toBe(1000 + 1 + URL.length);
  });
});

describe('sendAcademyRequestDone', () => {
  let sqlite: DatabaseSync;
  let db: D1Database;
  let pushes: { to: string; messages: unknown[]; opts?: { retryKey?: string } }[];
  let fail: Error | null;
  const client = {
    async pushMessage(to: string, messages: unknown[], opts?: { retryKey?: string }) {
      if (fail) throw fail;
      pushes.push({ to, messages, opts });
      return {};
    },
  };

  beforeEach(() => {
    sqlite = new DatabaseSync(':memory:');
    sqlite.exec(`
      CREATE TABLE friends (id TEXT PRIMARY KEY, line_user_id TEXT, line_account_id TEXT, is_following INTEGER);
      CREATE TABLE account_settings (id TEXT, line_account_id TEXT, key TEXT, value TEXT, created_at TEXT, updated_at TEXT);
      CREATE TABLE messages_log (id TEXT PRIMARY KEY, friend_id TEXT, direction TEXT, message_type TEXT, content TEXT, broadcast_id TEXT,
        scenario_step_id TEXT, delivery_type TEXT, source TEXT, line_account_id TEXT, created_at TEXT);
    `);
    db = fakeD1(sqlite);
    pushes = [];
    fail = null;
  });
  const input = parseAcademyRequestDone(valid)!;

  it('友だちに文面＋リンクを1通送り、トークの履歴に残す', async () => {
    sqlite.exec(`INSERT INTO friends VALUES ('f1', '${USER}', '${ACCOUNT}', 1)`);
    const copy = { ...DEFAULT_COPY, academyRequest: { done: '{講座名} ができました' } };
    sqlite.prepare('INSERT INTO account_settings VALUES (?, ?, ?, ?, ?, ?)').run('s1', ACCOUNT, COPY_SETTING_KEY, JSON.stringify(copy), 'x', 'x');
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('SENT');
    expect(pushes).toEqual([{ to: USER, messages: [{ type: 'text', text: `ES の書き方 ができました\n${URL}` }], opts: { retryKey: REQ } }]);
    const logs = sqlite.prepare('SELECT * FROM messages_log').all() as Record<string, unknown>[];
    expect(logs).toHaveLength(1);
    expect(logs[0]).toMatchObject({ friend_id: 'f1', direction: 'outgoing', message_type: 'text', source: 'intern_academy_request', line_account_id: ACCOUNT });
  });

  it('友だちでない・ブロック中・別アカウントの友だちには送らない', async () => {
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('NOT_FOLLOWING');
    sqlite.exec(`INSERT INTO friends VALUES ('f2', '${USER}', 'other', 1)`);
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('NOT_FOLLOWING');
    sqlite.exec(`INSERT INTO friends VALUES ('f1', '${USER}', '${ACCOUNT}', 0)`);
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('NOT_FOLLOWING');
    expect(pushes).toHaveLength(0);
  });

  it('LINE に送れなければ LINE_FAILED、同じ鍵で送れていた（409）なら SENT', async () => {
    sqlite.exec(`INSERT INTO friends VALUES ('f1', '${USER}', '${ACCOUNT}', 1)`);
    fail = new Error('LINE API error: 500 Internal Server Error — x');
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('LINE_FAILED');
    fail = new Error('LINE API error: 409 Conflict — The retry key is already accepted');
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('SENT');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM messages_log').get()).toEqual({ n: 0 });
  });

  it('履歴に残せなくても、送れていれば SENT', async () => {
    sqlite.exec(`INSERT INTO friends VALUES ('f1', '${USER}', '${ACCOUNT}', 1); DROP TABLE messages_log;`);
    expect(await sendAcademyRequestDone(db, client as never, ACCOUNT, input)).toBe('SENT');
    expect(pushes).toHaveLength(1);
  });
});
