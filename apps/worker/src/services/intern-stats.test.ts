import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import {
  getInternStats,
  jstDates,
  recordFollowEvent,
  recordUnfollowByLineUser,
  resetFollowEventsTableFlag,
} from './intern-stats.js';
import { INTERN_RICHMENUS_KEY } from './intern-richmenus.js';

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
// 2026-11-08 12:00（日本時間）
const NOW = new Date('2026-11-08T03:00:00.000Z');

let sqlite: DatabaseSync;
let db: D1Database;

function addFriend(id: string, opts: { createdAt: string; following?: boolean; meta?: Record<string, unknown>; account?: string }) {
  sqlite
    .prepare('INSERT INTO friends (id, line_user_id, line_account_id, is_following, metadata, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(id, 'U' + id, opts.account ?? ACCOUNT, opts.following === false ? 0 : 1, JSON.stringify(opts.meta ?? {}), opts.createdAt, opts.createdAt);
}

beforeEach(() => {
  resetFollowEventsTableFlag();
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_user_id TEXT UNIQUE, line_account_id TEXT, is_following INTEGER, metadata TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT);
    CREATE TABLE messages_log (id TEXT PRIMARY KEY, friend_id TEXT, direction TEXT, message_type TEXT, content TEXT, source TEXT, line_account_id TEXT, created_at TEXT);
    CREATE TABLE account_settings (id TEXT PRIMARY KEY, line_account_id TEXT, key TEXT, value TEXT, created_at TEXT, updated_at TEXT, UNIQUE(line_account_id, key));
    CREATE TABLE rich_menu_groups (id TEXT PRIMARY KEY, account_id TEXT, name TEXT, default_page_id TEXT, status TEXT);
    CREATE TABLE rich_menu_pages (id TEXT PRIMARY KEY, group_id TEXT, order_index INTEGER, line_richmenu_id TEXT);
    CREATE TABLE rich_menu_areas (id TEXT PRIMARY KEY, page_id TEXT, bounds_x INTEGER, bounds_y INTEGER, action_type TEXT, action_data TEXT);
  `);
  db = fakeD1(sqlite);
});

describe('日付', () => {
  it('日本時間の今日までの n 日を古い順に返す', () => {
    // 2026-11-07 15:30Z は日本時間で 11/8 の 0:30
    expect(jstDates(3, new Date('2026-11-07T15:30:00.000Z'))).toEqual(['2026-11-06', '2026-11-07', '2026-11-08']);
  });
});

describe('ブロックの記録', () => {
  it('表が無くても作って記録する', async () => {
    addFriend('a', { createdAt: '2026-11-08T09:00:00.000+09:00' });
    await recordFollowEvent(db, { friendId: 'a', lineAccountId: ACCOUNT, event: 'follow', at: '2026-11-08T09:00:00.000+09:00' });
    await recordUnfollowByLineUser(db, { lineUserId: 'Ua', lineAccountId: ACCOUNT });
    const rows = sqlite.prepare('SELECT friend_id, event, line_account_id FROM friend_follow_events ORDER BY event').all();
    expect(rows).toEqual([
      { friend_id: 'a', event: 'follow', line_account_id: ACCOUNT },
      { friend_id: 'a', event: 'unfollow', line_account_id: ACCOUNT },
    ]);
  });

  it('LINE が同じ知らせを送り直しても1件だけ記録する', async () => {
    addFriend('a', { createdAt: '2026-11-08T09:00:00.000+09:00' });
    await recordUnfollowByLineUser(db, { lineUserId: 'Ua', lineAccountId: ACCOUNT, eventId: 'ev-1' });
    await recordUnfollowByLineUser(db, { lineUserId: 'Ua', lineAccountId: ACCOUNT, eventId: 'ev-1' });
    await recordUnfollowByLineUser(db, { lineUserId: 'Ua', lineAccountId: ACCOUNT, eventId: 'ev-2' });
    expect(sqlite.prepare('SELECT id FROM friend_follow_events ORDER BY id').all()).toEqual([{ id: 'ev-1' }, { id: 'ev-2' }]);
  });

  it('日時は LINE で実際にブロックした時刻（知らせの timestamp）で記録する', async () => {
    addFriend('a', { createdAt: '2026-11-08T09:00:00.000+09:00' });
    // 2026-11-07 15:30Z は日本時間で 11/8 の 0:30
    await recordUnfollowByLineUser(db, { lineUserId: 'Ua', lineAccountId: ACCOUNT, eventId: 'ev-1', atMs: Date.parse('2026-11-07T15:30:00.000Z') });
    expect(sqlite.prepare('SELECT occurred_at FROM friend_follow_events').get()).toEqual({ occurred_at: '2026-11-08T00:30:00.000+09:00' });
  });

  it('知らない人のブロックは何もしない', async () => {
    await recordUnfollowByLineUser(db, { lineUserId: 'Unobody', lineAccountId: ACCOUNT });
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name = 'friend_follow_events'").get()).toBeUndefined();
  });
});

describe('数字の集計', () => {
  beforeEach(async () => {
    // 11/7 に3人、11/8 に2人。ほかのアカウントに1人
    addFriend('a', { createdAt: '2026-11-07T10:00:00.000+09:00', meta: { survey_step: 'done', survey_completed_at: '2026-11-07T10:05:00.000+09:00' } });
    addFriend('b', { createdAt: '2026-11-07T11:00:00.000+09:00', meta: { survey_step: 'grade' }, following: false });
    addFriend('c', { createdAt: '2026-11-07T12:00:00.000+09:00', meta: { survey_step: 'consent' }, following: false });
    addFriend('d', { createdAt: '2026-11-08T09:00:00.000+09:00', meta: { survey_step: 'done', survey_completed_at: '2026-11-08T09:03:00.000+09:00' } });
    addFriend('e', { createdAt: '2026-11-08T10:00:00.000+09:00' });
    addFriend('x', { createdAt: '2026-11-08T10:00:00.000+09:00', meta: { survey_step: 'done' }, account: 'other' });
    // b は追加した日にブロック。c は記録を始める前にブロック（記録なし）
    await recordFollowEvent(db, { friendId: 'b', lineAccountId: ACCOUNT, event: 'unfollow', at: '2026-11-07T20:00:00.000+09:00' });
  });

  it('合計とアンケートの段階ごとの人数', async () => {
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    expect(s.totals).toEqual({ friends: 5, following: 3, blocked: 2, surveyDone: 2 });
    expect(s.funnel.map((f) => [f.key, f.count, f.blocked])).toEqual([
      ['friend', 5, 2],
      ['greeted', 4, 2],
      ['consented', 3, 1],
      ['university', 3, 1],
      ['grade', 2, 0],
      ['done', 2, 0],
    ]);
  });

  it('日ごとの追加・ブロック・回答完了', async () => {
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    expect(s.daily).toHaveLength(7);
    expect(s.since).toBe('2026-11-02');
    expect(s.daily.at(-2)).toEqual({ date: '2026-11-07', newFriends: 3, blocks: 1, surveyDone: 1 });
    expect(s.daily.at(-1)).toEqual({ date: '2026-11-08', newFriends: 2, blocks: 0, surveyDone: 1 });
  });

  it('事業メンバーは進み具合と日ごとの推移に数えない（合計には残す）', async () => {
    // a（回答完了）と b（ブロック済み）をメンバーとして外す
    const s = await getInternStats(db, ACCOUNT, 7, NOW, ['a', 'b']);
    expect(s.excludedMembers).toBe(2);
    expect(s.totals).toEqual({ friends: 5, following: 3, blocked: 2, surveyDone: 2 });
    expect(s.funnel.map((f) => [f.key, f.count, f.blocked])).toEqual([
      ['friend', 3, 1],
      ['greeted', 2, 1],
      ['consented', 1, 0],
      ['university', 1, 0],
      ['grade', 1, 0],
      ['done', 1, 0],
    ]);
    expect(s.daily.at(-2)).toEqual({ date: '2026-11-07', newFriends: 1, blocks: 0, surveyDone: 0 });
    expect(s.daily.at(-1)).toEqual({ date: '2026-11-08', newFriends: 2, blocks: 0, surveyDone: 1 });
  });

  it('追加から何日目にブロックしたか・記録の無いブロック', async () => {
    await recordFollowEvent(db, { friendId: 'e', lineAccountId: ACCOUNT, event: 'unfollow', at: '2026-11-12T10:00:00.000+09:00' });
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    expect(s.blockAfter.map((b) => b.count)).toEqual([1, 0, 1, 0, 0]);
    expect(s.blocksWithoutTime).toBe(1);
    expect(s.blockLogStartedAt).toBe('2026-11-07T20:00:00.000+09:00');
  });

  it('何日目かは経過時間ではなく日付で数える（夜に追加して翌朝ブロックは2日目）', async () => {
    addFriend('n', { createdAt: '2026-11-07T23:00:00.000+09:00' });
    await recordFollowEvent(db, { friendId: 'n', lineAccountId: ACCOUNT, event: 'unfollow', at: '2026-11-08T01:00:00.000+09:00' });
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    expect(s.blockAfter.map((b) => b.count)).toEqual([1, 1, 0, 0, 0]);
  });

  it('ブロック解除して戻った人のブロックは、戻った日から数える', async () => {
    // e は 11/8 に友だち追加 → 11/9 ブロック → 11/20 に戻る → 11/21 にまたブロック
    await recordFollowEvent(db, { friendId: 'e', lineAccountId: ACCOUNT, event: 'unfollow', at: '2026-11-09T10:00:00.000+09:00' });
    await recordFollowEvent(db, { friendId: 'e', lineAccountId: ACCOUNT, event: 'follow', at: '2026-11-20T10:00:00.000+09:00' });
    await recordFollowEvent(db, { friendId: 'e', lineAccountId: ACCOUNT, event: 'unfollow', at: '2026-11-21T10:00:00.000+09:00' });
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    // b（当日）・e の1回目（2日目）・e の2回目（戻った日から2日目）
    expect(s.blockAfter.map((b) => b.count)).toEqual([1, 2, 0, 0, 0]);
  });

  it('別のアカウントへの友だち追加は、戻った日に数えない', async () => {
    // e は 11/8 に友だち追加 → 11/20 に別のアカウントへ友だち追加 → 11/21 にこのアカウントでブロック
    await recordFollowEvent(db, { friendId: 'e', lineAccountId: 'other', event: 'follow', at: '2026-11-20T10:00:00.000+09:00' });
    await recordFollowEvent(db, { friendId: 'e', lineAccountId: ACCOUNT, event: 'unfollow', at: '2026-11-21T10:00:00.000+09:00' });
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    // b（当日）・e（最初の追加 11/8 から14日目）
    expect(s.blockAfter.map((b) => b.count)).toEqual([1, 0, 0, 1, 0]);
  });

  it('メニューのボタンごとの押された回数（ページを開くボタンは数えない）', async () => {
    sqlite.exec(`
      INSERT INTO account_settings VALUES ('s1', '${ACCOUNT}', '${INTERN_RICHMENUS_KEY}', '{"lockedGroupId":"g1","unlockedGroupId":"g2"}', '', '');
      INSERT INTO rich_menu_groups VALUES ('g1', '${ACCOUNT}', '鍵付き', 'p1', 'published'), ('g2', '${ACCOUNT}', '解放後', 'p2', 'published');
      INSERT INTO rich_menu_pages VALUES ('p1', 'g1', 0, 'rm1'), ('p2', 'g2', 0, 'rm2');
      INSERT INTO rich_menu_areas VALUES
        ('a1', 'p1', 0, 0, 'postback', '{"data":"isv:start","displayText":"アンケートに答える"}'),
        ('a2', 'p2', 0, 0, 'uri', '{"label":"マイページ","uri":"https://liff.line.me/x"}'),
        ('a3', 'p2', 800, 0, 'postback', '{"label":"Q&A","data":"isv:qa"}'),
        ('a4', 'p2', 0, 800, 'uri', '{"uri":"https://liff.line.me/x?page=mypage"}');
      INSERT INTO messages_log VALUES
        ('m1', 'a', 'incoming', 'text', 'isv:start', 'postback', '${ACCOUNT}', '2026-10-01T10:00:00.000+09:00'),
        ('m2', 'a', 'incoming', 'text', 'isv:start', 'postback', '${ACCOUNT}', '2026-11-07T10:00:00.000+09:00'),
        ('m3', 'a', 'incoming', 'text', 'isv:qa', 'postback', '${ACCOUNT}', '2026-11-08T14:30:00.000+09:00'),
        ('m4', 'x', 'incoming', 'text', 'isv:qa', 'postback', 'other', '2026-11-08T14:30:00.000+09:00'),
        ('m5', 'a', 'outgoing', 'text', 'isv:qa', 'postback', '${ACCOUNT}', '2026-11-08T14:30:00.000+09:00'),
        -- 合図を分ける前の Q&A は［ほかの質問を見る］と見分けられないので数えない
        ('m6', 'a', 'incoming', 'text', 'isv:qa', 'postback', '${ACCOUNT}', '2026-11-08T10:00:00.000+09:00');
    `);
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    expect(s.menuButtons).toEqual([
      { menu: 'locked', menuName: '鍵付き', label: 'アンケートに答える', kind: 'postback', count: 2, countInPeriod: 1, countFrom: null },
      { menu: 'unlocked', menuName: '解放後', label: 'マイページ', kind: 'uri', count: null, countInPeriod: null, countFrom: null },
      { menu: 'unlocked', menuName: '解放後', label: 'Q&A', kind: 'postback', count: 1, countInPeriod: 1, countFrom: '2026-11-08T14:07:03.000+09:00' },
      { menu: 'unlocked', menuName: '解放後', label: 'マイページ', kind: 'uri', count: null, countInPeriod: null, countFrom: null },
    ]);
  });

  it('メニューを選んでいなければボタンの行は無い', async () => {
    const s = await getInternStats(db, ACCOUNT, 7, NOW);
    expect(s.menuButtons).toEqual([]);
  });
});
