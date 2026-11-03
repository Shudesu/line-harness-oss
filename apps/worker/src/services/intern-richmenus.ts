// KIDOUインターンの「鍵付き（答える前）」「解放後（答えた後）」に使うリッチメニューを、
// 管理画面のリッチメニュー（rich_menu_groups）から選べるようにする。
//
// 選んだメニューは account_settings の intern_richmenus に group の id で置く。LINE 上の ID は
// 公開し直すたびに変わるので、使うときに group の1ページ目の line_richmenu_id を引く。
// 選んでいない・引けないときは今までどおり秘密の値（INTERN_*_RICHMENU_ID）を使う。
import { getAccountSetting, setAccountSetting } from '@line-crm/db';
import { linkRichMenuBulkChunked, type LineRichMenuClient } from '../lib/rich-menu-publisher.js';

export const INTERN_RICHMENUS_KEY = 'intern_richmenus';

export type InternMenuRole = 'locked' | 'unlocked';

export interface InternRichMenuChoice {
  lockedGroupId: string | null;
  unlockedGroupId: string | null;
}

export async function loadInternRichMenuChoice(db: D1Database, accountId: string): Promise<InternRichMenuChoice> {
  const raw = await getAccountSetting(db, accountId, INTERN_RICHMENUS_KEY);
  const empty = { lockedGroupId: null, unlockedGroupId: null };
  if (!raw) return empty;
  try {
    const v = JSON.parse(raw) as Partial<InternRichMenuChoice>;
    return {
      lockedGroupId: typeof v.lockedGroupId === 'string' && v.lockedGroupId ? v.lockedGroupId : null,
      unlockedGroupId: typeof v.unlockedGroupId === 'string' && v.unlockedGroupId ? v.unlockedGroupId : null,
    };
  } catch {
    return empty;
  }
}

export async function saveInternRichMenuChoice(db: D1Database, accountId: string, choice: InternRichMenuChoice): Promise<void> {
  await setAccountSetting(db, accountId, INTERN_RICHMENUS_KEY, JSON.stringify(choice));
}

/** アンケートで友だちに付けるページ（デフォルトのページ、無ければ1ページ目）の id。無ければ null */
export async function internMenuPageIdOf(db: D1Database, accountId: string, groupId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT p.id AS id FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.id = ? AND g.account_id = ?
        ORDER BY CASE WHEN p.id = g.default_page_id THEN 0 ELSE 1 END, p.order_index
        LIMIT 1`,
    )
    .bind(groupId, accountId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** 公開済みの group の、いま LINE 上にあるメニューの ID（1ページ目）。無ければ null */
export async function publishedRichMenuIdOf(db: D1Database, accountId: string, groupId: string): Promise<string | null> {
  const row = await db
    .prepare(
      `SELECT p.line_richmenu_id AS id FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.id = ? AND g.account_id = ? AND g.status = 'published' AND p.line_richmenu_id IS NOT NULL
        ORDER BY CASE WHEN p.id = g.default_page_id THEN 0 ELSE 1 END, p.order_index
        LIMIT 1`,
    )
    .bind(groupId, accountId)
    .first<{ id: string }>();
  return row?.id ?? null;
}

/** 管理画面で選んだメニューの LINE 上の ID。選んでいない・引けない役は入れない */
export async function resolveInternRichMenuIds(
  db: D1Database,
  accountId: string,
): Promise<{ locked?: string; unlocked?: string }> {
  const choice = await loadInternRichMenuChoice(db, accountId);
  const out: { locked?: string; unlocked?: string } = {};
  if (choice.lockedGroupId) {
    const id = await publishedRichMenuIdOf(db, accountId, choice.lockedGroupId);
    if (id) out.locked = id;
  }
  if (choice.unlockedGroupId) {
    const id = await publishedRichMenuIdOf(db, accountId, choice.unlockedGroupId);
    if (id) out.unlocked = id;
  }
  return out;
}

/** その group が KIDOUインターンのどの役に選ばれているか */
export async function internRoleOfGroup(db: D1Database, accountId: string, groupId: string): Promise<InternMenuRole[]> {
  const choice = await loadInternRichMenuChoice(db, accountId);
  const roles: InternMenuRole[] = [];
  if (choice.lockedGroupId === groupId) roles.push('locked');
  if (choice.unlockedGroupId === groupId) roles.push('unlocked');
  return roles;
}

/**
 * 友だちのまま（ブロックしていない）の人に、役に合うメニューを付け直す。
 * 答え終えた人（survey_step = done）には解放後、それ以外には鍵付き。
 */
export async function relinkInternFriends(
  db: D1Database,
  line: Pick<LineRichMenuClient, 'linkRichMenuBulk'>,
  accountId: string,
  role: InternMenuRole,
  richMenuId: string,
): Promise<number> {
  const done = role === 'unlocked';
  const rows = await db
    .prepare(
      `SELECT line_user_id FROM friends
        WHERE line_account_id = ? AND is_following = 1
          AND (COALESCE(json_extract(metadata, '$.survey_step'), '') = 'done') = ?`,
    )
    .bind(accountId, done ? 1 : 0)
    .all<{ line_user_id: string }>();
  const userIds = (rows.results ?? []).map((r) => r.line_user_id).filter(Boolean);
  const { total } = await linkRichMenuBulkChunked(line as LineRichMenuClient, richMenuId, userIds);
  return total;
}
