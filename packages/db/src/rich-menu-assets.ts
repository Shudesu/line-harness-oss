export interface RichMenuAssetRow {
  rich_menu_id: string;
  line_account_id: string | null;
  image_key: string;
  image_url: string;
  mime_type: string;
  size: number | null;
  created_at: string;
  updated_at: string;
}

export async function ensureRichMenuAssetsTable(db: D1Database): Promise<void> {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS rich_menu_assets (
        rich_menu_id TEXT PRIMARY KEY,
        line_account_id TEXT,
        image_key TEXT NOT NULL,
        image_url TEXT NOT NULL,
        mime_type TEXT NOT NULL,
        size INTEGER,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    )
    .run();
  await db
    .prepare(`CREATE INDEX IF NOT EXISTS idx_rich_menu_assets_account ON rich_menu_assets (line_account_id)`)
    .run();
}

export async function listRichMenuAssets(
  db: D1Database,
  lineAccountId?: string | null,
): Promise<RichMenuAssetRow[]> {
  await ensureRichMenuAssetsTable(db);
  const result = lineAccountId
    ? await db
      .prepare(`SELECT * FROM rich_menu_assets WHERE line_account_id = ? ORDER BY updated_at DESC`)
      .bind(lineAccountId)
      .all<RichMenuAssetRow>()
    : await db.prepare(`SELECT * FROM rich_menu_assets ORDER BY updated_at DESC`).all<RichMenuAssetRow>();
  return result.results ?? [];
}

export async function getRichMenuAsset(
  db: D1Database,
  richMenuId: string,
): Promise<RichMenuAssetRow | null> {
  await ensureRichMenuAssetsTable(db);
  return db
    .prepare(`SELECT * FROM rich_menu_assets WHERE rich_menu_id = ?`)
    .bind(richMenuId)
    .first<RichMenuAssetRow>();
}

export async function upsertRichMenuAsset(
  db: D1Database,
  input: {
    richMenuId: string;
    lineAccountId?: string | null;
    imageKey: string;
    imageUrl: string;
    mimeType: string;
    size?: number | null;
  },
): Promise<RichMenuAssetRow> {
  await ensureRichMenuAssetsTable(db);
  const now = new Date().toISOString();
  await db
    .prepare(
      `INSERT INTO rich_menu_assets (
        rich_menu_id, line_account_id, image_key, image_url, mime_type, size, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(rich_menu_id) DO UPDATE SET
        line_account_id = excluded.line_account_id,
        image_key = excluded.image_key,
        image_url = excluded.image_url,
        mime_type = excluded.mime_type,
        size = excluded.size,
        updated_at = excluded.updated_at`,
    )
    .bind(
      input.richMenuId,
      input.lineAccountId ?? null,
      input.imageKey,
      input.imageUrl,
      input.mimeType,
      input.size ?? null,
      now,
      now,
    )
    .run();

  const row = await getRichMenuAsset(db, input.richMenuId);
  if (!row) throw new Error('Failed to save rich menu asset');
  return row;
}

export async function deleteRichMenuAsset(db: D1Database, richMenuId: string): Promise<void> {
  await ensureRichMenuAssetsTable(db);
  await db.prepare(`DELETE FROM rich_menu_assets WHERE rich_menu_id = ?`).bind(richMenuId).run();
}
