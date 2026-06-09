import { jstNow } from './utils.js';
// =============================================================================
// LINE Accounts — Multi-Account Management
// =============================================================================

export interface LineAccount {
  id: string;
  channel_id: string;
  name: string;
  channel_access_token: string;
  channel_secret: string;
  login_channel_id: string | null;
  login_channel_secret: string | null;
  liff_id: string | null;
  is_active: number;
  country: string | null;
  role: string | null;
  display_order: number;
  token_expires_at: string | null;
  /** P1 (2026-06-07): token refresh CAS ロック。NULL = 解放、TS = lock 中。 */
  token_refresh_lock_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateLineAccountInput {
  channelId: string;
  name: string;
  channelAccessToken: string;
  channelSecret: string;
  loginChannelId?: string | null;
  loginChannelSecret?: string | null;
  liffId?: string | null;
}

export async function createLineAccount(
  db: D1Database,
  input: CreateLineAccountInput,
): Promise<LineAccount> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // Auto-fill display_order to (max existing + 1) so new accounts go to the end.
  // COALESCE handles the empty-table case: -1 + 1 = 0.
  const orderRow = await db
    .prepare(`SELECT COALESCE(MAX(display_order), -1) + 1 AS next FROM line_accounts`)
    .first<{ next: number }>();
  const displayOrder = orderRow?.next ?? 0;

  await db
    .prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret,
          login_channel_id, login_channel_secret, liff_id,
          is_active, display_order, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)`,
    )
    .bind(
      id,
      input.channelId,
      input.name,
      input.channelAccessToken,
      input.channelSecret,
      input.loginChannelId ?? null,
      input.loginChannelSecret ?? null,
      input.liffId ?? null,
      displayOrder,
      now,
      now,
    )
    .run();

  return (await getLineAccountById(db, id))!;
}

export async function getLineAccountById(
  db: D1Database,
  id: string,
): Promise<LineAccount | null> {
  return db
    .prepare(`SELECT * FROM line_accounts WHERE id = ?`)
    .bind(id)
    .first<LineAccount>();
}

export async function getLineAccounts(db: D1Database): Promise<LineAccount[]> {
  const result = await db
    .prepare(`SELECT * FROM line_accounts ORDER BY display_order ASC, created_at ASC`)
    .all<LineAccount>();
  return result.results;
}

export async function getLineAccountByChannelId(
  db: D1Database,
  channelId: string,
): Promise<LineAccount | null> {
  return db
    .prepare(`SELECT * FROM line_accounts WHERE channel_id = ?`)
    .bind(channelId)
    .first<LineAccount>();
}

/**
 * Reverse-lookup an account by its LINE Login `login_channel_id` (= the `aud`
 * claim of a verified LIFF / LINE Login id_token). Used by routes that have a
 * verified token and need to resolve the owning account *strictly* — without
 * falling back to legacy heuristics that may match the wrong tenant.
 *
 * Returns `null` if no account has registered this login channel. Multiple
 * accounts SHOULD NOT share the same `login_channel_id` (LIFF login channels
 * are 1:1 with messaging channels in practice); if they ever do, the first
 * row wins (`LIMIT 1`).
 */
export async function getLineAccountByLoginChannelId(
  db: D1Database,
  loginChannelId: string,
): Promise<LineAccount | null> {
  return db
    .prepare(`SELECT * FROM line_accounts WHERE login_channel_id = ? LIMIT 1`)
    .bind(loginChannelId)
    .first<LineAccount>();
}

export type UpdateLineAccountInput = Partial<
  Pick<
    LineAccount,
    | 'name'
    | 'channel_access_token'
    | 'channel_secret'
    | 'login_channel_id'
    | 'login_channel_secret'
    | 'liff_id'
    | 'is_active'
    | 'token_expires_at'
  >
>;

export async function updateLineAccount(
  db: D1Database,
  id: string,
  updates: UpdateLineAccountInput,
): Promise<LineAccount | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.channel_access_token !== undefined) {
    fields.push('channel_access_token = ?');
    values.push(updates.channel_access_token);
  }
  if (updates.channel_secret !== undefined) {
    fields.push('channel_secret = ?');
    values.push(updates.channel_secret);
  }
  if (updates.login_channel_id !== undefined) {
    fields.push('login_channel_id = ?');
    values.push(updates.login_channel_id);
  }
  if (updates.login_channel_secret !== undefined) {
    fields.push('login_channel_secret = ?');
    values.push(updates.login_channel_secret);
  }
  if (updates.liff_id !== undefined) {
    fields.push('liff_id = ?');
    values.push(updates.liff_id);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }
  if (updates.token_expires_at !== undefined) {
    fields.push('token_expires_at = ?');
    values.push(updates.token_expires_at);
  }

  if (fields.length === 0) return getLineAccountById(db, id);

  fields.push('updated_at = ?');
  values.push(jstNow());
  values.push(id);

  await db
    .prepare(`UPDATE line_accounts SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getLineAccountById(db, id);
}

export async function deleteLineAccount(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM line_accounts WHERE id = ?`).bind(id).run();
}

export interface UpdateLineAccountFieldsInput {
  country?: string | null;
  role?: string | null;
  isActive?: boolean;
  loginChannelId?: string | null;
  loginChannelSecret?: string | null;
  liffId?: string | null;
}

export async function updateLineAccountFields(
  db: D1Database,
  id: string,
  input: UpdateLineAccountFieldsInput,
): Promise<LineAccount | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (input.country !== undefined) {
    sets.push('country = ?');
    binds.push(input.country); // empty string normalization happens at the route layer
  }
  if (input.role !== undefined) {
    sets.push('role = ?');
    binds.push(input.role);
  }
  if (input.isActive !== undefined) {
    sets.push('is_active = ?');
    binds.push(input.isActive ? 1 : 0);
  }
  if (input.loginChannelId !== undefined) {
    sets.push('login_channel_id = ?');
    binds.push(input.loginChannelId);
  }
  if (input.loginChannelSecret !== undefined) {
    sets.push('login_channel_secret = ?');
    binds.push(input.loginChannelSecret);
  }
  if (input.liffId !== undefined) {
    sets.push('liff_id = ?');
    binds.push(input.liffId);
  }

  if (sets.length === 0) {
    return getLineAccountById(db, id);
  }

  sets.push('updated_at = ?');
  binds.push(jstNow());
  binds.push(id);

  await db
    .prepare(`UPDATE line_accounts SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...binds)
    .run();

  return getLineAccountById(db, id);
}

export async function updateLineAccountOrder(
  db: D1Database,
  ordered: Array<{ id: string; displayOrder: number }>,
): Promise<void> {
  if (ordered.length === 0) return;

  const now = jstNow();
  const stmts = ordered.map(({ id, displayOrder }) =>
    db.prepare(`UPDATE line_accounts SET display_order = ?, updated_at = ? WHERE id = ?`)
      .bind(displayOrder, now, id),
  );

  // db.batch is atomic on D1; if any UPDATE fails, none commit.
  await db.batch(stmts);
}
