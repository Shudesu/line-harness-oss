// KIDOUインターンの「数字」タブ。友だち追加・ブロック・アンケートの進み具合・メニューのボタンを数える。
//
// ブロックした日時は friends に残らない（is_following が 0 になるだけ）ので、follow / unfollow を
// friend_follow_events に1件ずつ記録する。表は使うときに無ければ作る（本番の DB に手で流さなくてよいように。
// 同じ中身を migrations/051 にも置いている）。記録を始める前のブロックは日時が分からない。
import { jstNow } from '@line-crm/db';
import { loadInternRichMenuChoice } from './intern-richmenus.js';

export type FollowEvent = 'follow' | 'unfollow';

let tableReady = false;

/** テスト用：表を作ったかどうかの覚えを消す */
export function resetFollowEventsTableFlag(): void {
  tableReady = false;
}

export async function ensureFollowEventsTable(db: D1Database): Promise<void> {
  if (tableReady) return;
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS friend_follow_events (
         id              TEXT PRIMARY KEY,
         friend_id       TEXT NOT NULL,
         line_account_id TEXT,
         event           TEXT NOT NULL CHECK (event IN ('follow', 'unfollow')),
         occurred_at     TEXT NOT NULL
       )`,
    )
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_friend_follow_events_account ON friend_follow_events (line_account_id, event, occurred_at)')
    .run();
  await db
    .prepare('CREATE INDEX IF NOT EXISTS idx_friend_follow_events_friend ON friend_follow_events (friend_id, event)')
    .run();
  tableReady = true;
}

/** 友だち追加（ブロック解除を含む）・ブロックを1件記録する。失敗しても呼び出し元は止めない */
export async function recordFollowEvent(
  db: D1Database,
  opts: { friendId: string; lineAccountId: string | null | undefined; event: FollowEvent; at?: string; eventId?: string | null },
): Promise<void> {
  try {
    await ensureFollowEventsTable(db);
    // LINE が同じ知らせを送り直したときは同じ webhookEventId が来るので、id にして二重に入れない
    await db
      .prepare('INSERT OR IGNORE INTO friend_follow_events (id, friend_id, line_account_id, event, occurred_at) VALUES (?, ?, ?, ?, ?)')
      .bind(opts.eventId || crypto.randomUUID(), opts.friendId, opts.lineAccountId ?? null, opts.event, opts.at ?? jstNow())
      .run();
  } catch (err) {
    console.error('[intern-stats] failed to record follow event', err);
  }
}

/** ブロックの記録用。LINE のユーザー ID から友だちの id を引いて記録する */
export async function recordUnfollowByLineUser(
  db: D1Database,
  opts: { lineUserId: string; lineAccountId: string | null | undefined; eventId?: string | null },
): Promise<void> {
  try {
    const row = await db
      .prepare('SELECT id, line_account_id FROM friends WHERE line_user_id = ?')
      .bind(opts.lineUserId)
      .first<{ id: string; line_account_id: string | null }>();
    if (!row) return;
    await recordFollowEvent(db, { friendId: row.id, lineAccountId: opts.lineAccountId ?? row.line_account_id, event: 'unfollow', eventId: opts.eventId });
  } catch (err) {
    console.error('[intern-stats] failed to record unfollow', err);
  }
}

// ── 集計 ─────────────────────────────────────────────

// アンケートの段階（この順に進む）。survey_step が無い人は「あいさつ前」
const STEP_ORDER = ['consent', 'university', 'grade', 'graduation_year', 'done'] as const;

export interface FunnelRow {
  key: string;
  label: string;
  count: number;
  /** いまブロック中の人数（この段階まで進んだ人のうち） */
  blocked: number;
}

export interface DailyRow {
  date: string; // YYYY-MM-DD（日本時間）
  newFriends: number;
  blocks: number;
  surveyDone: number;
}

export interface BlockAfterRow {
  label: string;
  count: number;
}

export interface MenuButtonRow {
  menu: 'locked' | 'unlocked';
  menuName: string;
  label: string;
  kind: 'postback' | 'uri' | 'other';
  /** postback のときだけ数える。ページを開くボタンは数えられない */
  count: number | null;
  countInPeriod: number | null;
}

export interface InternStats {
  days: number;
  since: string;
  totals: { friends: number; following: number; blocked: number; surveyDone: number };
  funnel: FunnelRow[];
  daily: DailyRow[];
  blockAfter: BlockAfterRow[];
  blockLogStartedAt: string | null;
  blocksWithoutTime: number;
  menuButtons: MenuButtonRow[];
}

/** 日本時間の今日から n-1 日前までの日付（古い順） */
export function jstDates(days: number, now = new Date()): string[] {
  const base = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(base.getTime() - i * 24 * 60 * 60 * 1000);
    out.push(d.toISOString().slice(0, 10));
  }
  return out;
}

const BLOCK_BUCKETS: { label: string; max: number }[] = [
  { label: '追加した日のうち', max: 1 },
  { label: '2〜3日目', max: 3 },
  { label: '4〜7日目', max: 7 },
  { label: '8〜30日目', max: 30 },
  { label: '31日目以降', max: Infinity },
];

export async function getInternStats(db: D1Database, accountId: string, days: number, now = new Date()): Promise<InternStats> {
  await ensureFollowEventsTable(db);
  const dates = jstDates(days, now);
  const since = dates[0];

  // 合計
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS friends,
         SUM(CASE WHEN is_following = 1 THEN 1 ELSE 0 END) AS following,
         SUM(CASE WHEN COALESCE(json_extract(metadata, '$.survey_step'), '') = 'done' THEN 1 ELSE 0 END) AS survey_done
       FROM friends WHERE line_account_id = ?`,
    )
    .bind(accountId)
    .first<{ friends: number; following: number | null; survey_done: number | null }>();
  const friends = totals?.friends ?? 0;
  const following = totals?.following ?? 0;

  // アンケートの段階ごと
  const stepRows = await db
    .prepare(
      `SELECT COALESCE(json_extract(metadata, '$.survey_step'), '') AS step,
         COUNT(*) AS n, SUM(CASE WHEN is_following = 1 THEN 0 ELSE 1 END) AS blocked
       FROM friends WHERE line_account_id = ? GROUP BY step`,
    )
    .bind(accountId)
    .all<{ step: string; n: number; blocked: number | null }>();
  const byStep = new Map<string, { n: number; blocked: number }>();
  for (const r of stepRows.results ?? []) byStep.set(r.step, { n: r.n, blocked: r.blocked ?? 0 });
  const reached = (fromIndex: number) => {
    let n = 0;
    let blocked = 0;
    for (const s of STEP_ORDER.slice(fromIndex)) {
      const v = byStep.get(s);
      if (v) { n += v.n; blocked += v.blocked; }
    }
    return { n, blocked };
  };
  let allBlocked = 0;
  for (const v of byStep.values()) allBlocked += v.blocked;
  const funnel: FunnelRow[] = [
    { key: 'friend', label: '友だちになった', count: friends, blocked: allBlocked },
    { key: 'greeted', label: 'あいさつ・お願いのカードを受け取った', ...pick(reached(0)) },
    { key: 'consented', label: '同意した（大学の質問へ）', ...pick(reached(1)) },
    { key: 'university', label: '大学を答えた', ...pick(reached(2)) },
    { key: 'grade', label: '学年を答えた', ...pick(reached(3)) },
    { key: 'done', label: '卒業予定年まで答えた（回答完了）', ...pick(reached(4)) },
  ];

  // 日ごと
  const newRows = await db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS d, COUNT(*) AS n FROM friends
        WHERE line_account_id = ? AND substr(created_at, 1, 10) >= ? GROUP BY d`,
    )
    .bind(accountId, since)
    .all<{ d: string; n: number }>();
  const blockRows = await db
    .prepare(
      `SELECT substr(occurred_at, 1, 10) AS d, COUNT(*) AS n FROM friend_follow_events
        WHERE line_account_id = ? AND event = 'unfollow' AND substr(occurred_at, 1, 10) >= ? GROUP BY d`,
    )
    .bind(accountId, since)
    .all<{ d: string; n: number }>();
  const doneRows = await db
    .prepare(
      `SELECT substr(json_extract(metadata, '$.survey_completed_at'), 1, 10) AS d, COUNT(*) AS n FROM friends
        WHERE line_account_id = ? AND json_extract(metadata, '$.survey_completed_at') IS NOT NULL
          AND substr(json_extract(metadata, '$.survey_completed_at'), 1, 10) >= ? GROUP BY d`,
    )
    .bind(accountId, since)
    .all<{ d: string; n: number }>();
  const toMap = (rows: { d: string; n: number }[] | undefined) => new Map((rows ?? []).map((r) => [r.d, r.n]));
  const newMap = toMap(newRows.results);
  const blockMap = toMap(blockRows.results);
  const doneMap = toMap(doneRows.results);
  const daily: DailyRow[] = dates.map((date) => ({
    date,
    newFriends: newMap.get(date) ?? 0,
    blocks: blockMap.get(date) ?? 0,
    surveyDone: doneMap.get(date) ?? 0,
  }));

  // 友だち追加から何日目にブロックしたか（記録のあるブロックだけ）。経過時間ではなく日本時間の日付どうしで数える。
  // ブロック解除して戻った人は、同じアカウントでのそのブロックの直前の友だち追加から数える（記録が無ければ最初に友だちになった日）
  const gaps = await db
    .prepare(
      `SELECT julianday(substr(e.occurred_at, 1, 10)) - julianday(substr(COALESCE(
                (SELECT MAX(p.occurred_at) FROM friend_follow_events p
                  WHERE p.friend_id = e.friend_id AND p.line_account_id = e.line_account_id
                    AND p.event = 'follow' AND p.occurred_at <= e.occurred_at),
                f.created_at), 1, 10)) AS gap
         FROM friend_follow_events e JOIN friends f ON f.id = e.friend_id
        WHERE e.line_account_id = ? AND e.event = 'unfollow'`,
    )
    .bind(accountId)
    .all<{ gap: number | null }>();
  const blockAfter: BlockAfterRow[] = BLOCK_BUCKETS.map((b) => ({ label: b.label, count: 0 }));
  for (const g of gaps.results ?? []) {
    const dayNo = Math.floor(Math.max(0, g.gap ?? 0)) + 1; // 追加した日を1日目と数える
    const i = BLOCK_BUCKETS.findIndex((b) => dayNo <= b.max);
    blockAfter[i].count += 1;
  }
  const firstLog = await db
    .prepare('SELECT MIN(occurred_at) AS at FROM friend_follow_events WHERE line_account_id = ?')
    .bind(accountId)
    .first<{ at: string | null }>();
  // いまブロック中なのに、ブロックの記録が無い人（記録を始める前にブロックした人）
  const noTime = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM friends f
        WHERE f.line_account_id = ? AND f.is_following = 0
          AND NOT EXISTS (SELECT 1 FROM friend_follow_events e WHERE e.friend_id = f.id AND e.event = 'unfollow')`,
    )
    .bind(accountId)
    .first<{ n: number }>();

  const menuButtons = await getMenuButtonStats(db, accountId, since);

  return {
    days,
    since,
    totals: { friends, following, blocked: friends - following, surveyDone: totals?.survey_done ?? 0 },
    funnel,
    daily,
    blockAfter,
    blockLogStartedAt: firstLog?.at ?? null,
    blocksWithoutTime: noTime?.n ?? 0,
    menuButtons,
  };
}

function pick(v: { n: number; blocked: number }): { count: number; blocked: number } {
  return { count: v.n, blocked: v.blocked };
}

// 名前の無いページを開くボタンは、ミニアプリの行き先（?page=）から名前を付ける
const PAGE_LABELS: Record<string, string> = { mypage: 'マイページ', jobs: '求人を探す', apply: '応募状況' };

function uriLabel(uri: string): string | null {
  try {
    const page = new URL(uri).searchParams.get('page');
    return (page && PAGE_LABELS[page]) || null;
  } catch {
    return null;
  }
}

/** いま選んでいる鍵付き・解放後のメニューのボタンごとに、押された回数を数える */
async function getMenuButtonStats(db: D1Database, accountId: string, since: string): Promise<MenuButtonRow[]> {
  const choice = await loadInternRichMenuChoice(db, accountId);
  const roles: { menu: 'locked' | 'unlocked'; groupId: string | null }[] = [
    { menu: 'locked', groupId: choice.lockedGroupId },
    { menu: 'unlocked', groupId: choice.unlockedGroupId },
  ];
  const out: MenuButtonRow[] = [];
  for (const role of roles) {
    if (!role.groupId) continue;
    const areas = await db
      .prepare(
        `SELECT g.name AS group_name, p.order_index, a.bounds_x, a.bounds_y, a.action_type, a.action_data
           FROM rich_menu_groups g
           JOIN rich_menu_pages p ON p.group_id = g.id
           JOIN rich_menu_areas a ON a.page_id = p.id
          WHERE g.id = ? AND g.account_id = ?
          ORDER BY p.order_index, a.bounds_y, a.bounds_x`,
      )
      .bind(role.groupId, accountId)
      .all<{ group_name: string; order_index: number; bounds_x: number; bounds_y: number; action_type: string; action_data: string }>();
    for (const a of areas.results ?? []) {
      let data: { label?: unknown; data?: unknown; displayText?: unknown; uri?: unknown; text?: unknown } = {};
      try {
        data = JSON.parse(a.action_data) ?? {};
      } catch {
        data = {};
      }
      const label =
        (typeof data.label === 'string' && data.label) ||
        (typeof data.displayText === 'string' && data.displayText) ||
        (typeof data.text === 'string' && data.text) ||
        (typeof data.uri === 'string' && uriLabel(data.uri)) ||
        'ボタン';
      if (a.action_type === 'postback' && typeof data.data === 'string' && data.data) {
        const counts = await db
          .prepare(
            `SELECT COUNT(*) AS total, SUM(CASE WHEN substr(created_at, 1, 10) >= ? THEN 1 ELSE 0 END) AS recent
               FROM messages_log
              WHERE source = 'postback' AND direction = 'incoming' AND content = ? AND line_account_id = ?`,
          )
          .bind(since, data.data, accountId)
          .first<{ total: number; recent: number | null }>();
        out.push({
          menu: role.menu,
          menuName: a.group_name,
          label,
          kind: 'postback',
          count: counts?.total ?? 0,
          countInPeriod: counts?.recent ?? 0,
        });
      } else {
        out.push({
          menu: role.menu,
          menuName: a.group_name,
          label,
          kind: a.action_type === 'uri' ? 'uri' : 'other',
          count: null,
          countInPeriod: null,
        });
      }
    }
  }
  return out;
}
