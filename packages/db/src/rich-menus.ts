import { jstNow } from './utils';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface RichMenuLocal {
  id: string;
  line_rich_menu_id: string;
  name: string;
  chat_bar_text: string;
  size_width: number;
  size_height: number;
  areas_json: string;
  image_url: string | null;
  is_default: number;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface RichMenuRule {
  id: string;
  name: string;
  tag_id: string;
  rich_menu_id: string;
  priority: number;
  is_active: number;
  line_account_id: string | null;
  created_at: string;
}

export interface RichMenuAlias {
  id: string;
  alias_id: string;
  rich_menu_id: string;
  created_at: string;
}

// ─── Rich Menu CRUD ──────────────────────────────────────────────────────────

export async function getRichMenusLocal(db: D1Database, lineAccountId?: string): Promise<RichMenuLocal[]> {
  const sql = lineAccountId
    ? 'SELECT * FROM rich_menus WHERE line_account_id = ? ORDER BY created_at DESC'
    : 'SELECT * FROM rich_menus ORDER BY created_at DESC';
  const result = await db.prepare(sql).bind(...(lineAccountId ? [lineAccountId] : [])).all<RichMenuLocal>();
  return result.results;
}

export async function getRichMenuLocalById(db: D1Database, id: string): Promise<RichMenuLocal | null> {
  return db.prepare('SELECT * FROM rich_menus WHERE id = ?').bind(id).first<RichMenuLocal>();
}

export async function getRichMenuLocalByLineId(db: D1Database, lineRichMenuId: string): Promise<RichMenuLocal | null> {
  return db.prepare('SELECT * FROM rich_menus WHERE line_rich_menu_id = ?').bind(lineRichMenuId).first<RichMenuLocal>();
}

export async function createRichMenuLocal(
  db: D1Database,
  data: {
    lineRichMenuId: string;
    name: string;
    chatBarText?: string;
    sizeWidth?: number;
    sizeHeight?: number;
    areasJson?: string;
    imageUrl?: string;
    lineAccountId?: string;
  },
): Promise<RichMenuLocal> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO rich_menus (id, line_rich_menu_id, name, chat_bar_text, size_width, size_height, areas_json, image_url, line_account_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      data.lineRichMenuId,
      data.name,
      data.chatBarText || 'メニュー',
      data.sizeWidth || 2500,
      data.sizeHeight || 1686,
      data.areasJson || '[]',
      data.imageUrl || null,
      data.lineAccountId || null,
      now,
      now,
    )
    .run();
  return (await getRichMenuLocalById(db, id))!;
}

export async function updateRichMenuLocal(
  db: D1Database,
  id: string,
  data: { name?: string; areasJson?: string; imageUrl?: string; isDefault?: number },
): Promise<void> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const bindings: unknown[] = [now];
  if (data.name !== undefined) { sets.push('name = ?'); bindings.push(data.name); }
  if (data.areasJson !== undefined) { sets.push('areas_json = ?'); bindings.push(data.areasJson); }
  if (data.imageUrl !== undefined) { sets.push('image_url = ?'); bindings.push(data.imageUrl); }
  if (data.isDefault !== undefined) { sets.push('is_default = ?'); bindings.push(data.isDefault); }
  bindings.push(id);
  await db.prepare(`UPDATE rich_menus SET ${sets.join(', ')} WHERE id = ?`).bind(...bindings).run();
}

export async function deleteRichMenuLocal(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM rich_menus WHERE id = ?').bind(id).run();
}

// ─── Rules ───────────────────────────────────────────────────────────────────

export async function getRichMenuRules(db: D1Database, lineAccountId?: string): Promise<RichMenuRule[]> {
  const sql = lineAccountId
    ? 'SELECT * FROM rich_menu_rules WHERE line_account_id = ? OR line_account_id IS NULL ORDER BY priority DESC'
    : 'SELECT * FROM rich_menu_rules ORDER BY priority DESC';
  const result = await db.prepare(sql).bind(...(lineAccountId ? [lineAccountId] : [])).all<RichMenuRule>();
  return result.results;
}

export async function createRichMenuRule(
  db: D1Database,
  data: { name: string; tagId: string; richMenuId: string; priority?: number; lineAccountId?: string },
): Promise<RichMenuRule> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO rich_menu_rules (id, name, tag_id, rich_menu_id, priority, line_account_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, data.name, data.tagId, data.richMenuId, data.priority || 0, data.lineAccountId || null, now)
    .run();
  return (await db.prepare('SELECT * FROM rich_menu_rules WHERE id = ?').bind(id).first<RichMenuRule>())!;
}

export async function deleteRichMenuRule(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM rich_menu_rules WHERE id = ?').bind(id).run();
}

// Evaluate which menu a friend should get based on their tags
export async function evaluateRichMenuForFriend(
  db: D1Database,
  friendId: string,
  lineAccountId?: string,
): Promise<string | null> {
  const rules = await getRichMenuRules(db, lineAccountId);
  for (const rule of rules) {
    if (!rule.is_active) continue;
    const hasTag = await db
      .prepare('SELECT 1 FROM friend_tags WHERE friend_id = ? AND tag_id = ?')
      .bind(friendId, rule.tag_id)
      .first();
    if (hasTag) {
      const menu = await getRichMenuLocalById(db, rule.rich_menu_id);
      return menu?.line_rich_menu_id || null;
    }
  }
  return null;
}

// ─── Aliases ─────────────────────────────────────────────────────────────────

export async function getRichMenuAliases(db: D1Database): Promise<RichMenuAlias[]> {
  const result = await db.prepare('SELECT * FROM rich_menu_aliases ORDER BY created_at DESC').all<RichMenuAlias>();
  return result.results;
}

export async function createRichMenuAliasLocal(
  db: D1Database,
  data: { aliasId: string; richMenuId: string },
): Promise<RichMenuAlias> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO rich_menu_aliases (id, alias_id, rich_menu_id, created_at) VALUES (?, ?, ?, ?)')
    .bind(id, data.aliasId, data.richMenuId, now)
    .run();
  return (await db.prepare('SELECT * FROM rich_menu_aliases WHERE id = ?').bind(id).first<RichMenuAlias>())!;
}

export async function deleteRichMenuAliasLocal(db: D1Database, aliasId: string): Promise<void> {
  await db.prepare('DELETE FROM rich_menu_aliases WHERE alias_id = ?').bind(aliasId).run();
}
