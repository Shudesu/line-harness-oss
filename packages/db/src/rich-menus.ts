import { jstNow } from './utils.js';

// =============================================================================
// Rich Menu Editor — groups / pages / areas
// =============================================================================
//
// 1 group = 1 リッチメニューセット (1 ページ構成も 1 group として扱う)
// 1 page  = タブ 1 枚 = LINE 上の richmenu 1 個
// 1 area  = page 内のタップ可能矩形。LINE 上限 20 個まで
//
// alias は決定論的に lhx-{groupId 先頭 8 文字}-{order_index} で命名。
// richmenuswitch アクションの遷移先は self の page_id を `targetPageId` で持つ。
// publish 時に publisher 側で alias_id へ解決する。

export interface RichMenuGroup {
  id: string;
  account_id: string;
  name: string;
  chat_bar_text: string;
  size: 'large' | 'compact';
  default_page_id: string | null;
  is_default_for_all: number;
  selected: number;
  status: 'draft' | 'published';
  publishing_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface RichMenuPage {
  id: string;
  group_id: string;
  order_index: number;
  name: string;
  alias_id: string;
  line_richmenu_id: string | null;
  image_r2_key: string | null;
  image_content_type: string | null;
  created_at: string;
  updated_at: string;
}

export interface RichMenuArea {
  id: string;
  page_id: string;
  bounds_x: number;
  bounds_y: number;
  bounds_width: number;
  bounds_height: number;
  action_type: 'uri' | 'message' | 'postback' | 'richmenuswitch';
  action_data: string; // JSON serialized
  created_at: string;
  updated_at: string;
}

export interface RichMenuAreaInput {
  boundsX: number;
  boundsY: number;
  boundsWidth: number;
  boundsHeight: number;
  actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
  actionData: Record<string, unknown>;
}

export interface RichMenuPageInput {
  // PATCH (replaceRichMenuPages) で **既存 page を保持** したい場合に同じ id を渡す。
  // 新規ページは undefined。この id が rich_menu_pages.id とそのまま一致するので、
  // `richmenuswitch.actionData.targetPageId` を再 PATCH で安定して解決できる。
  // また、保持された page の image_r2_key / line_richmenu_id は失われない。
  id?: string;
  name: string;
  orderIndex: number;
  areas: RichMenuAreaInput[];
}

export interface CreateRichMenuGroupInput {
  accountId: string;
  name: string;
  chatBarText: string;
  size: 'large' | 'compact';
  selected: boolean;
  pages: RichMenuPageInput[];
}

export interface UpdateRichMenuGroupMetaInput {
  name?: string;
  chatBarText?: string;
  isDefaultForAll?: boolean;
  selected?: boolean;
}

export interface RichMenuPageWithAreas extends RichMenuPage {
  areas: (RichMenuArea & { actionData: Record<string, unknown> })[];
}

export interface RichMenuGroupWithPages extends RichMenuGroup {
  pages: RichMenuPageWithAreas[];
}

// alias は決定論的命名: 同 group 内で order_index ごとに一意、再 publish も idempotent。
export function buildRichMenuAliasId(groupId: string, orderIndex: number): string {
  return `lhx-${groupId.slice(0, 8)}-${orderIndex}`;
}

export async function getRichMenuGroups(
  db: D1Database,
  accountId: string,
): Promise<RichMenuGroup[]> {
  const result = await db
    .prepare(
      `SELECT * FROM rich_menu_groups WHERE account_id = ? ORDER BY updated_at DESC`,
    )
    .bind(accountId)
    .all<RichMenuGroup>();
  return result.results ?? [];
}

export async function getRichMenuGroupById(
  db: D1Database,
  id: string,
): Promise<RichMenuGroup | null> {
  return (await db
    .prepare(`SELECT * FROM rich_menu_groups WHERE id = ?`)
    .bind(id)
    .first<RichMenuGroup>()) ?? null;
}

export async function getRichMenuGroupWithPages(
  db: D1Database,
  id: string,
): Promise<RichMenuGroupWithPages | null> {
  const group = await getRichMenuGroupById(db, id);
  if (!group) return null;
  const pagesResult = await db
    .prepare(
      `SELECT * FROM rich_menu_pages WHERE group_id = ? ORDER BY order_index`,
    )
    .bind(id)
    .all<RichMenuPage>();
  const pages = pagesResult.results ?? [];
  if (pages.length === 0) {
    return { ...group, pages: [] };
  }
  const placeholders = pages.map(() => '?').join(',');
  const areasResult = await db
    .prepare(
      `SELECT * FROM rich_menu_areas WHERE page_id IN (${placeholders}) ORDER BY id`,
    )
    .bind(...pages.map((p) => p.id))
    .all<RichMenuArea>();
  const areas = areasResult.results ?? [];
  const areasByPage = new Map<string, (RichMenuArea & { actionData: Record<string, unknown> })[]>();
  for (const a of areas) {
    const list = areasByPage.get(a.page_id) ?? [];
    list.push({ ...a, actionData: JSON.parse(a.action_data) });
    areasByPage.set(a.page_id, list);
  }
  return {
    ...group,
    pages: pages.map((p) => ({ ...p, areas: areasByPage.get(p.id) ?? [] })),
  };
}

export async function createRichMenuGroup(
  db: D1Database,
  input: CreateRichMenuGroupInput,
): Promise<RichMenuGroupWithPages> {
  const groupId = crypto.randomUUID();
  const now = jstNow();

  // pages の順序通りに alias_id を確定。
  // input.id は新規 group 作成時には信用しない (rich_menu_pages.id PK 衝突を防ぐ
  // ため。別 group のページから duplicate されたコピー由来の id 等)。
  // 既存 page を保持する PATCH 時のみ replaceRichMenuPages 側で id 維持する。
  const pageRecords = input.pages.map((p) => ({
    id: crypto.randomUUID(),
    orderIndex: p.orderIndex,
    name: p.name,
    aliasId: buildRichMenuAliasId(groupId, p.orderIndex),
    areas: p.areas,
  }));
  // 1 ページ目を default にしておく (削除されるまで暫定)。
  const defaultPageId = pageRecords[0]?.id ?? null;

  const stmts: D1PreparedStatement[] = [];
  stmts.push(
    db
      .prepare(
        `INSERT INTO rich_menu_groups
           (id, account_id, name, chat_bar_text, size, default_page_id,
            is_default_for_all, selected, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, 0, ?, 'draft', ?, ?)`,
      )
      .bind(
        groupId,
        input.accountId,
        input.name,
        input.chatBarText,
        input.size,
        defaultPageId,
        input.selected ? 1 : 0,
        now,
        now,
      ),
  );
  for (const p of pageRecords) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO rich_menu_pages
             (id, group_id, order_index, name, alias_id, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(p.id, groupId, p.orderIndex, p.name, p.aliasId, now, now),
    );
    for (const a of p.areas) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO rich_menu_areas
               (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height,
                action_type, action_data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            p.id,
            a.boundsX,
            a.boundsY,
            a.boundsWidth,
            a.boundsHeight,
            a.actionType,
            JSON.stringify(a.actionData),
            now,
            now,
          ),
      );
    }
  }
  await db.batch(stmts);

  const created = await getRichMenuGroupWithPages(db, groupId);
  if (!created) throw new Error('failed to read back created rich menu group');
  return created;
}

export async function updateRichMenuGroupMeta(
  db: D1Database,
  id: string,
  patch: UpdateRichMenuGroupMetaInput,
): Promise<void> {
  const sets: string[] = [];
  const vals: unknown[] = [];
  if (patch.name !== undefined) {
    sets.push('name = ?');
    vals.push(patch.name);
  }
  if (patch.chatBarText !== undefined) {
    sets.push('chat_bar_text = ?');
    vals.push(patch.chatBarText);
  }
  if (patch.isDefaultForAll !== undefined) {
    sets.push('is_default_for_all = ?');
    vals.push(patch.isDefaultForAll ? 1 : 0);
  }
  if (patch.selected !== undefined) {
    sets.push('selected = ?');
    vals.push(patch.selected ? 1 : 0);
  }
  if (sets.length === 0) return;
  sets.push('updated_at = ?');
  vals.push(jstNow());
  vals.push(id);
  await db
    .prepare(`UPDATE rich_menu_groups SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...vals)
    .run();
}

// pages 配列を「id 維持型」全置換する。
// - 入力 page.id が既存 rich_menu_pages.id にマッチした場合、そのページの
//   image_r2_key / image_content_type / line_richmenu_id / created_at は引き継ぐ。
//   richmenuswitch.actionData.targetPageId が PATCH を跨いでも安定して解決できる。
// - 入力にない既存 page は削除。新規 page は新 UUID で挿入。
// - 実装: UNIQUE (group_id, order_index) 制約衝突を避けるため、
//   一旦 group の全 page を DELETE → 新構成で INSERT し直す。保持対象のメタは
//   事前に取得しておいて INSERT 時に復元する。
// - areas は常に全置換 (cascade DELETE で消えた後 INSERT)。
export async function replaceRichMenuPages(
  db: D1Database,
  groupId: string,
  pages: RichMenuPageInput[],
): Promise<void> {
  const now = jstNow();

  // 既存 page のメタ (image / line_richmenu_id / created_at) を保持するため事前取得。
  const existing = (
    (
      await db
        .prepare(
          `SELECT id, image_r2_key, image_content_type, line_richmenu_id, created_at
             FROM rich_menu_pages WHERE group_id = ?`,
        )
        .bind(groupId)
        .all<{
          id: string;
          image_r2_key: string | null;
          image_content_type: string | null;
          line_richmenu_id: string | null;
          created_at: string;
        }>()
    ).results ?? []
  );
  const existingMap = new Map(existing.map((p) => [p.id, p]));

  // 入力を「保持 vs 新規」に振り分けつつメタを復元。
  // 重要: p.id を流用するのは「current group の existingMap に一致した時だけ」。
  // それ以外 (別 group の id / stale id / undefined) は新 UUID を割り当てる。
  // current group 外の id をそのまま INSERT すると rich_menu_pages.id が PK 衝突する。
  //
  // 同じ existing id が input 内に 2 回以上現れた場合 (route 側でも reject されるが
  // 防御として)、最初の出現だけメタを継承し、後続は新規扱いにして PK 衝突を回避する。
  const claimedReusedIds = new Set<string>();
  const newPageRecords = pages.map((p) => {
    let reused = p.id ? existingMap.get(p.id) : undefined;
    if (reused && claimedReusedIds.has(reused.id)) {
      reused = undefined;
    }
    if (reused) claimedReusedIds.add(reused.id);
    return {
      id: reused?.id ?? crypto.randomUUID(),
      orderIndex: p.orderIndex,
      name: p.name,
      aliasId: buildRichMenuAliasId(groupId, p.orderIndex),
      imageR2Key: reused?.image_r2_key ?? null,
      imageContentType: reused?.image_content_type ?? null,
      lineRichMenuId: reused?.line_richmenu_id ?? null,
      createdAt: reused?.created_at ?? now,
      areas: p.areas,
    };
  });

  const stmts: D1PreparedStatement[] = [];
  // UNIQUE 制約衝突を避けるため、いったん DELETE → 復元 INSERT。
  stmts.push(db.prepare(`DELETE FROM rich_menu_pages WHERE group_id = ?`).bind(groupId));

  for (const p of newPageRecords) {
    stmts.push(
      db
        .prepare(
          `INSERT INTO rich_menu_pages
             (id, group_id, order_index, name, alias_id,
              image_r2_key, image_content_type, line_richmenu_id,
              created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          p.id,
          groupId,
          p.orderIndex,
          p.name,
          p.aliasId,
          p.imageR2Key,
          p.imageContentType,
          p.lineRichMenuId,
          p.createdAt,
          now,
        ),
    );
    for (const a of p.areas) {
      stmts.push(
        db
          .prepare(
            `INSERT INTO rich_menu_areas
               (id, page_id, bounds_x, bounds_y, bounds_width, bounds_height,
                action_type, action_data, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            crypto.randomUUID(),
            p.id,
            a.boundsX,
            a.boundsY,
            a.boundsWidth,
            a.boundsHeight,
            a.actionType,
            JSON.stringify(a.actionData),
            now,
            now,
          ),
      );
    }
  }

  if (newPageRecords.length > 0) {
    const firstPage =
      newPageRecords.find((p) => p.orderIndex === 0) ?? newPageRecords[0];
    stmts.push(
      db
        .prepare(
          `UPDATE rich_menu_groups SET default_page_id = ?, updated_at = ? WHERE id = ?`,
        )
        .bind(firstPage.id, now, groupId),
    );
  }

  await db.batch(stmts);
}

export async function deleteRichMenuGroup(
  db: D1Database,
  id: string,
): Promise<boolean> {
  const result = await db
    .prepare(`DELETE FROM rich_menu_groups WHERE id = ?`)
    .bind(id)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function setRichMenuPageImage(
  db: D1Database,
  pageId: string,
  imageR2Key: string,
  imageContentType: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_pages SET image_r2_key = ?, image_content_type = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(imageR2Key, imageContentType, jstNow(), pageId)
    .run();
}

export async function pageBelongsToGroup(
  db: D1Database,
  groupId: string,
  pageId: string,
): Promise<boolean> {
  const row = await db
    .prepare(`SELECT 1 AS hit FROM rich_menu_pages WHERE id = ? AND group_id = ?`)
    .bind(pageId, groupId)
    .first<{ hit: number }>();
  return !!row;
}

// Publish ロックを取る。既にロックされていれば false (HTTP 409 用)。
export async function acquirePublishLock(
  db: D1Database,
  groupId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      `UPDATE rich_menu_groups
         SET publishing_at = ?
       WHERE id = ? AND publishing_at IS NULL`,
    )
    .bind(jstNow(), groupId)
    .run();
  return (result.meta?.changes ?? 0) > 0;
}

export async function releasePublishLock(
  db: D1Database,
  groupId: string,
): Promise<void> {
  await db
    .prepare(`UPDATE rich_menu_groups SET publishing_at = NULL WHERE id = ?`)
    .bind(groupId)
    .run();
}

export async function setPageRichMenuId(
  db: D1Database,
  pageId: string,
  lineRichMenuId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_pages SET line_richmenu_id = ?, updated_at = ? WHERE id = ?`,
    )
    .bind(lineRichMenuId, jstNow(), pageId)
    .run();
}

export async function markRichMenuGroupPublished(
  db: D1Database,
  groupId: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE rich_menu_groups
         SET status = 'published', publishing_at = NULL, updated_at = ?
       WHERE id = ?`,
    )
    .bind(jstNow(), groupId)
    .run();
}

// Unpublish 完了時の DB 整合: 全 page の line_richmenu_id を null に戻し、
// group.status を 'draft' に戻す。is_default_for_all も 0 に戻す
// (LINE 側で default unlink された前提)。LINE 側で alias / richmenu / default
// の削除が成功した後に呼ばれる想定。
export async function markRichMenuGroupUnpublished(
  db: D1Database,
  groupId: string,
): Promise<void> {
  const now = jstNow();
  await db.batch([
    db
      .prepare(
        `UPDATE rich_menu_pages
            SET line_richmenu_id = NULL, updated_at = ?
          WHERE group_id = ?`,
      )
      .bind(now, groupId),
    db
      .prepare(
        `UPDATE rich_menu_groups
            SET status = 'draft', publishing_at = NULL,
                is_default_for_all = 0, updated_at = ?
          WHERE id = ?`,
      )
      .bind(now, groupId),
  ]);
}
