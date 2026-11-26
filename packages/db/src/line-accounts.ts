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
  og_site_name: string | null;
  og_default_image_url: string | null;
  og_default_description: string | null;
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
  ogSiteName?: string | null;
  ogDefaultImageUrl?: string | null;
  ogDefaultDescription?: string | null;
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
          is_active, display_order,
          og_site_name, og_default_image_url, og_default_description,
          created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?, ?, ?, ?)`,
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
      input.ogSiteName ?? null,
      input.ogDefaultImageUrl ?? null,
      input.ogDefaultDescription ?? null,
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

/**
 * アカウント文脈を持たない送信経路で使うチャネルアクセストークンを決める。
 *
 * 送信系はどこも「env の `LINE_CHANNEL_ACCESS_TOKEN` を既定にして、friend や
 * リンクからアカウントが分かればそれで上書きする」という形になっている。この既定が
 * 曲者で、`friends.line_account_id` が NULL のまま（webhook がアカウントを解決
 * できなかった友だち、アカウント登録より前に入った友だち）だと env の値が使われる。
 *
 * env の値は Worker のシークレットで、テナントの `line_accounts` とは別の置き場所に
 * ある。管理画面からトークンを更新できるのは `line_accounts` だけなので、トークンを
 * 回転させると2つの値が食い違い、**同じテナントの中で「LIFF もインサイトも直ったのに
 * 送信だけ 500」という切り分けづらい壊れ方**をする（2026-08-24 に実際に起きた）。
 *
 * 有効なアカウントが1本しか無いテナントでは、どれを使うかに曖昧さが無い。その場合は
 * `line_accounts` を正として env を無視することで、この食い違い自体を消す。
 * 複数ある場合は推測すると別アカウントの名前で送信してしまうので、従来どおり env を
 * 返して呼び出し側の文脈解決に委ねる。
 *
 * D1 が読めないときは env にフォールバックする — ここは送信経路の入口なので、
 * throw すると呼び出し元がまとめて 500 になる。
 */
export async function resolveDefaultAccessToken(
  db: D1Database,
  envAccessToken: string,
): Promise<string> {
  const account = await resolveDefaultLineAccount(db);
  return account?.channel_access_token || envAccessToken;
}

/**
 * `resolveDefaultAccessToken` の実体。トークンだけでなく**行そのもの**を返す。
 *
 * 呼び出し側がアカウント ID も必要とする場面があるため分けてある。たとえばシナリオの
 * 初回プッシュは、送信トークンと**同じアカウント**をリンク装飾（`decorateForFriendPush`）
 * にも渡さないと、「正しいチャネルから送られたのに LIFF リンクだけ持ち主不明」という
 * ちぐはぐな状態になる（Codex review round 1 の指摘）。トークンだけ解決して ID を
 * 取りこぼすと、その友だちはグローバルの LIFF 同意画面に飛ばされる。
 *
 * 有効なアカウントが「ちょうど1本」のときだけ行を返す。0本・複数本・D1 障害では null。
 */
export async function resolveDefaultLineAccount(db: D1Database): Promise<LineAccount | null> {
  try {
    // LIMIT 2 で足りる: 「ちょうど1本か」だけ分かればよい。
    const result = await db
      .prepare(
        `SELECT * FROM line_accounts
          WHERE is_active = 1 AND channel_access_token IS NOT NULL AND channel_access_token <> ''
          LIMIT 2`,
      )
      .all<LineAccount>();
    const rows = result?.results ?? [];
    if (rows.length === 1 && rows[0]?.channel_access_token) {
      return rows[0];
    }
  } catch {
    // null を返す（呼び出し側が env へフォールバックする）
  }
  return null;
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
    | 'og_site_name'
    | 'og_default_image_url'
    | 'og_default_description'
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
  if (updates.og_site_name !== undefined) {
    fields.push('og_site_name = ?');
    values.push(updates.og_site_name);
  }
  if (updates.og_default_image_url !== undefined) {
    fields.push('og_default_image_url = ?');
    values.push(updates.og_default_image_url);
  }
  if (updates.og_default_description !== undefined) {
    fields.push('og_default_description = ?');
    values.push(updates.og_default_description);
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
  ogSiteName?: string | null;
  ogDefaultImageUrl?: string | null;
  ogDefaultDescription?: string | null;
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
  if (input.ogSiteName !== undefined) {
    sets.push('og_site_name = ?');
    binds.push(input.ogSiteName);
  }
  if (input.ogDefaultImageUrl !== undefined) {
    sets.push('og_default_image_url = ?');
    binds.push(input.ogDefaultImageUrl);
  }
  if (input.ogDefaultDescription !== undefined) {
    sets.push('og_default_description = ?');
    binds.push(input.ogDefaultDescription);
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
