import { describe, it, expect, beforeEach } from 'vitest';
import { createRequire } from 'node:module';
import { toJstString } from '@line-crm/db';
import { JOIN_ORDER_KEY, attachPendingJoinRef, isBotUserAgent, isJoinRef, isTapId, listJoinLinks, newJoinRef, newTapId, recordJoinOpen, recordJoinTap, saveJoinOrder, type JoinConfig } from './intern-join.js';

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
const USER = 'U' + 'a'.repeat(32);
const config: JoinConfig = { accountId: ACCOUNT, liffId: '2011537213-test', loginChannelId: '2011537213', botBasicId: '@899hdfxg' };
const okVerify = async () => USER;

let sqlite: DatabaseSync;
let db: D1Database;

function addFriend(id: string, lineUserId: string, createdAt: Date) {
  sqlite.prepare('INSERT INTO friends (id, line_user_id, line_account_id, ref_code, is_following, created_at, updated_at) VALUES (?, ?, ?, NULL, 1, ?, ?)')
    .run(id, lineUserId, ACCOUNT, toJstString(createdAt), toJstString(createdAt));
}
function friendRef(id: string) {
  return (sqlite.prepare('SELECT ref_code FROM friends WHERE id = ?').get(id) as { ref_code: string | null }).ref_code;
}

beforeEach(() => {
  sqlite = new DatabaseSync(':memory:');
  sqlite.exec(`
    CREATE TABLE friends (id TEXT PRIMARY KEY, line_user_id TEXT, line_account_id TEXT, ref_code TEXT, last_ref_code TEXT, last_ref_at TEXT, is_following INTEGER, metadata TEXT DEFAULT '{}', created_at TEXT, updated_at TEXT);
    CREATE TABLE entry_routes (id TEXT PRIMARY KEY, ref_code TEXT UNIQUE, name TEXT, tag_id TEXT, scenario_id TEXT, redirect_url TEXT, pool_id TEXT,
      intro_template_id TEXT, run_account_friend_add_scenarios INTEGER DEFAULT 1, is_active INTEGER DEFAULT 1, created_at TEXT, updated_at TEXT);
    CREATE TABLE ref_tracking (id TEXT PRIMARY KEY, ref_code TEXT, friend_id TEXT, entry_route_id TEXT, source_url TEXT, fbclid TEXT, gclid TEXT, twclid TEXT,
      ttclid TEXT, utm_source TEXT, utm_medium TEXT, utm_campaign TEXT, user_agent TEXT, ip_address TEXT, created_at TEXT);
    CREATE TABLE friend_tags (friend_id TEXT, tag_id TEXT, assigned_at TEXT, PRIMARY KEY (friend_id, tag_id));
    CREATE TABLE account_settings (id TEXT PRIMARY KEY, line_account_id TEXT, key TEXT, value TEXT, created_at TEXT, updated_at TEXT, UNIQUE(line_account_id, key));
    INSERT INTO entry_routes (id, ref_code, name, tag_id, is_active, created_at, updated_at) VALUES ('r1', 'ki-tiktok01', 'TikTok', 'tag-tiktok', 1, '2026-11-03T00:00:00.000+09:00', '');
    INSERT INTO entry_routes (id, ref_code, name, tag_id, is_active, created_at, updated_at) VALUES ('r2', 'ki-stopped1', '止めた', NULL, 0, '2026-11-02T00:00:00.000+09:00', '');
  `);
  db = fakeD1(sqlite);
});

describe('経路の記号', () => {
  it('ki- ＋8けたで作り、形を確かめられる', () => {
    const ref = newJoinRef();
    expect(ref).toMatch(/^ki-[a-z0-9]{8}$/);
    expect(isJoinRef(ref)).toBe(true);
    expect(isJoinRef('abc')).toBe(false);
    expect(isJoinRef('ki-../x')).toBe(false);
  });
});

const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 350.0';
const USER2 = 'U' + 'b'.repeat(32);
function tapRows() {
  return sqlite.prepare("SELECT ref_code, friend_id, source_url, created_at FROM ref_tracking WHERE source_url LIKE 'tap:%' ORDER BY created_at").all() as {
    ref_code: string; friend_id: string | null; source_url: string; created_at: string;
  }[];
}
function ageTaps(ms: number) {
  for (const r of tapRows()) {
    sqlite.prepare('UPDATE ref_tracking SET created_at = ? WHERE source_url = ? AND ref_code = ? AND created_at = ?')
      .run(toJstString(new Date(new Date(r.created_at).getTime() - ms)), r.source_url, r.ref_code, r.created_at);
  }
}

describe('押した記録（ログインなし）', () => {
  it('番号の形を確かめ、ロボットを見分ける', () => {
    expect(isTapId(newTapId())).toBe(true);
    expect(isTapId('x')).toBe(false);
    expect(isBotUserAgent(IPHONE_UA)).toBe(false);
    expect(isBotUserAgent('facebookexternalhit/1.1')).toBe(true);
    expect(isBotUserAgent('Mozilla/5.0 (compatible; Slackbot-LinkExpanding 1.0)')).toBe(true);
    expect(isBotUserAgent(null)).toBe(true);
  });

  it('動いているリンクだけ記録する（止めたリンク・知らない記号・ロボット・準備前は記録しない）', async () => {
    const tapId = newTapId();
    expect(await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId, userAgent: IPHONE_UA })).toBe(true);
    expect(await recordJoinTap(db, config, { ref: 'ki-stopped1', tapId, userAgent: IPHONE_UA })).toBe(false);
    expect(await recordJoinTap(db, config, { ref: 'ki-unknown1', tapId, userAgent: IPHONE_UA })).toBe(false);
    expect(await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId, userAgent: 'facebookexternalhit/1.1' })).toBe(false);
    expect(await recordJoinTap(db, { ...config, accountId: undefined }, { ref: 'ki-tiktok01', tapId, userAgent: IPHONE_UA })).toBe(false);
    expect(tapRows()).toHaveLength(1);
  });

  it('押した直後の友だち追加に経路とタグを付ける', async () => {
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    addFriend('f1', USER, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBe('ki-tiktok01');
    expect(friendRef('f1')).toBe('ki-tiktok01');
    expect(sqlite.prepare("SELECT tag_id FROM friend_tags WHERE friend_id = 'f1'").get()).toEqual({ tag_id: 'tag-tiktok' });
    expect(tapRows()[0].friend_id).toBe('f1');
  });

  it('1つの押した記録は1人にだけ付ける（2人目は経路なし）', async () => {
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    addFriend('f1', USER, new Date());
    addFriend('f2', USER2, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBe('ki-tiktok01');
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f2', lineUserId: USER2, lineAccountId: ACCOUNT })).toBeNull();
    expect(friendRef('f2')).toBeNull();
  });

  it('5分より前に押された記録は付けない', async () => {
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    ageTaps(6 * 60 * 1000);
    addFriend('f1', USER, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBeNull();
  });

  it('同じブラウザで押し直した記録はまとめて1人と数え、まとめてその人に付ける', async () => {
    const tapId = newTapId();
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId, userAgent: IPHONE_UA });
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId, userAgent: IPHONE_UA });
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    let link = (await listJoinLinks(db, ACCOUNT)).links.find((l) => l.refCode === 'ki-tiktok01')!;
    expect(link.openedCount).toBe(2);
    addFriend('f1', USER, new Date());
    await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT });
    link = (await listJoinLinks(db, ACCOUNT)).links.find((l) => l.refCode === 'ki-tiktok01')!;
    expect(link.openedCount).toBe(2);
    expect(link.friendCount).toBe(1);
  });

  it('ブロック解除で戻った前からの友だちは、押した記録を使わず、直後の新しい人に付ける', async () => {
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    addFriend('f1', USER, new Date(Date.now() - 3 * 24 * 3600 * 1000));
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBeNull();
    expect(friendRef('f1')).toBeNull();
    expect(tapRows()[0].friend_id).toBeNull();
    addFriend('f2', USER2, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f2', lineUserId: USER2, lineAccountId: ACCOUNT })).toBe('ki-tiktok01');
  });

  it('4分台に押された記録は付ける', async () => {
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    ageTaps(4 * 60 * 1000 + 50 * 1000);
    addFriend('f1', USER, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBe('ki-tiktok01');
  });

  it('ほかのアカウントの友だち追加では押した記録を使わない', async () => {
    await recordJoinTap(db, config, { ref: 'ki-tiktok01', tapId: newTapId(), userAgent: IPHONE_UA });
    addFriend('f1', USER, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: 'other' })).toBeNull();
    expect(tapRows()[0].friend_id).toBeNull();
  });

  it('LIFF の控えがある人は、控えのほうを先に使う', async () => {
    expect(await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify)).toBe('ok');
    sqlite.exec("INSERT INTO entry_routes (id, ref_code, name, tag_id, is_active, created_at, updated_at) VALUES ('r3', 'ki-insta001', 'インスタ', NULL, 1, '', '')");
    await recordJoinTap(db, config, { ref: 'ki-insta001', tapId: newTapId(), userAgent: IPHONE_UA });
    addFriend('f1', USER, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBe('ki-tiktok01');
    expect(tapRows()[0].friend_id).toBeNull();
  });
});

describe('LIFF で開いてから友だち追加', () => {
  it('まだ友だちでない人は控えておき、追加の合図で経路とタグを付ける', async () => {
    expect(await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify)).toBe('ok');
    addFriend('f1', USER, new Date());
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBe('ki-tiktok01');
    expect(friendRef('f1')).toBe('ki-tiktok01');
    expect(sqlite.prepare('SELECT tag_id FROM friend_tags WHERE friend_id = ?').get('f1')).toEqual({ tag_id: 'tag-tiktok' });
    const { links, friendsWithoutLink } = await listJoinLinks(db, ACCOUNT);
    const tiktok = links.find((l) => l.refCode === 'ki-tiktok01')!;
    expect(tiktok.openedCount).toBe(1);
    expect(tiktok.friendCount).toBe(1);
    expect(friendsWithoutLink).toBe(0);
  });

  it('ログインの画面で一緒に友だち追加して、合図が先に来た人にも付ける', async () => {
    addFriend('f1', USER, new Date());
    expect(await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify)).toBe('ok');
    expect(friendRef('f1')).toBe('ki-tiktok01');
  });

  it('前からの友だちが開いても経路は付けず、開いた数だけ数える', async () => {
    addFriend('f1', USER, new Date(Date.now() - 3 * 24 * 3600_000));
    await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify);
    expect(friendRef('f1')).toBeNull();
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f1', lineUserId: USER, lineAccountId: ACCOUNT })).toBeNull();
    const tiktok = (await listJoinLinks(db, ACCOUNT)).links.find((l) => l.refCode === 'ki-tiktok01')!;
    expect(tiktok.openedCount).toBe(1);
    expect(tiktok.friendCount).toBe(0);
  });

  it('開き直しは1回と数える', async () => {
    await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify);
    await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify);
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM ref_tracking').get() as { n: number }).n).toBe(1);
  });

  it('本人を確かめられない・止めたリンク・準備前は記録しない', async () => {
    expect(await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, async () => null)).toBe('unauthorized');
    expect(await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-stopped1' }, okVerify)).toBe('invalid');
    expect(await recordJoinOpen(db, { ...config, loginChannelId: undefined }, { idToken: 't', ref: 'ki-tiktok01' }, okVerify)).toBe('not_ready');
    expect((sqlite.prepare('SELECT COUNT(*) AS n FROM ref_tracking').get() as { n: number }).n).toBe(0);
  });

  it('ほかのアカウントの友だち追加では何もしない', async () => {
    await recordJoinOpen(db, config, { idToken: 't', ref: 'ki-tiktok01' }, okVerify);
    expect(await attachPendingJoinRef(db, ACCOUNT, { friendId: 'f9', lineUserId: USER, lineAccountId: 'other' })).toBeNull();
  });
});

describe('経路ごとの人数', () => {
  it('アンケートを最後まで答えた人を経路ごとに数える（ほかのアカウントは数えない）', async () => {
    sqlite.exec(`
      INSERT INTO friends (id, line_user_id, line_account_id, ref_code, is_following, metadata, created_at, updated_at) VALUES
        ('a', 'Ua', '${ACCOUNT}', 'ki-tiktok01', 1, '{"survey_step":"done"}', '2026-11-05T10:00:00.000+09:00', ''),
        ('b', 'Ub', '${ACCOUNT}', 'ki-tiktok01', 0, '{"survey_step":"done"}', '2026-11-05T11:00:00.000+09:00', ''),
        ('c', 'Uc', '${ACCOUNT}', 'ki-tiktok01', 1, '{"survey_step":"grade"}', '2026-11-05T12:00:00.000+09:00', ''),
        ('d', 'Ud', 'other', 'ki-tiktok01', 1, '{"survey_step":"done"}', '2026-11-05T12:00:00.000+09:00', '');
    `);
    const tiktok = (await listJoinLinks(db, ACCOUNT)).links.find((l) => l.id === 'r1')!;
    expect(tiktok.friendCount).toBe(3);
    expect(tiktok.followingCount).toBe(2);
    expect(tiktok.surveyDoneCount).toBe(2);
  });
});

describe('経路ごとの人数の並び順', () => {
  const ids = async () => (await listJoinLinks(db, ACCOUNT)).links.map((l) => l.id);

  it('並べ替える前は新しい順', async () => {
    expect(await ids()).toEqual(['r1', 'r2']);
  });

  it('保存した順に並び、あとから作ったリンクは上に出る。経路リンクでない id・重複は捨てる', async () => {
    sqlite.exec(`INSERT INTO entry_routes (id, ref_code, name, is_active, created_at, updated_at) VALUES ('other', 'abc', 'ほか', 1, '2026-11-01', '')`);
    await saveJoinOrder(db, ACCOUNT, ['r2', 'other', 'r1', 'r2', 'nope']);
    expect(await ids()).toEqual(['r2', 'r1']);
    expect(JSON.parse((sqlite.prepare('SELECT value FROM account_settings WHERE key = ?').get(JOIN_ORDER_KEY) as { value: string }).value)).toEqual(['r2', 'r1']);
    sqlite.exec(`INSERT INTO entry_routes (id, ref_code, name, is_active, created_at, updated_at) VALUES ('r3', 'ki-new00001', '新しい', 1, '2026-11-04T00:00:00.000+09:00', '')`);
    expect(await ids()).toEqual(['r3', 'r2', 'r1']);
  });

  it('空の並びを保存すると新しい順に戻る', async () => {
    await saveJoinOrder(db, ACCOUNT, ['r2', 'r1']);
    await saveJoinOrder(db, ACCOUNT, []);
    expect(await ids()).toEqual(['r1', 'r2']);
  });

  it('ほかのアカウントの並び順は効かない', async () => {
    await saveJoinOrder(db, 'other-account', ['r2', 'r1']);
    expect(await ids()).toEqual(['r1', 'r2']);
  });

  it('控えが壊れていても新しい順で出す', async () => {
    sqlite.exec(`INSERT INTO account_settings VALUES ('s1', '${ACCOUNT}', 'intern_join_order', '{oops', '', '')`);
    expect(await ids()).toEqual(['r1', 'r2']);
  });
});
