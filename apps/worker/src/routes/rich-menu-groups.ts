import { Hono } from 'hono';
import {
  getRichMenuGroups,
  getRichMenuGroupById,
  getRichMenuGroupWithPages,
  createRichMenuGroup,
  updateRichMenuGroupMeta,
  replaceRichMenuPages,
  deleteRichMenuGroup,
  setRichMenuPageImage,
  pageBelongsToGroup,
  acquirePublishLock,
  releasePublishLock,
  setPageRichMenuId,
  markRichMenuGroupPublished,
  markRichMenuGroupUnpublished,
  getLineAccountById,
  getFollowingLineUserIdsByTag,
  type RichMenuGroup,
  type RichMenuGroupWithPages,
  type RichMenuPageInput,
  type RichMenuAreaInput,
  type CreateRichMenuGroupInput,
  type UpdateRichMenuGroupMetaInput,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { validateRichMenuImage } from '../lib/image-validator.js';
import {
  publishRichMenuGroup,
  unpublishRichMenuGroup,
  linkRichMenuBulkChunked,
  type LineRichMenuClient,
  type R2Like,
  type GroupInput,
} from '../lib/rich-menu-publisher.js';

export const richMenuGroups = new Hono<Env>();

// ----- Serialization (snake_case row → camelCase response) -----

function serializeGroup(row: RichMenuGroup) {
  return {
    id: row.id,
    accountId: row.account_id,
    name: row.name,
    chatBarText: row.chat_bar_text,
    size: row.size,
    defaultPageId: row.default_page_id,
    isDefaultForAll: row.is_default_for_all === 1,
    selected: row.selected === 1,
    status: row.status,
    publishingAt: row.publishing_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function serializeGroupWithPages(row: RichMenuGroupWithPages) {
  return {
    ...serializeGroup(row),
    pages: row.pages.map((p) => ({
      id: p.id,
      orderIndex: p.order_index,
      name: p.name,
      aliasId: p.alias_id,
      lineRichmenuId: p.line_richmenu_id,
      imageR2Key: p.image_r2_key,
      imageContentType: p.image_content_type,
      areas: p.areas.map((a) => ({
        id: a.id,
        boundsX: a.bounds_x,
        boundsY: a.bounds_y,
        boundsWidth: a.bounds_width,
        boundsHeight: a.bounds_height,
        actionType: a.action_type,
        actionData: a.actionData,
      })),
    })),
  };
}

// ----- Input parsing / validation -----

const VALID_SIZES = new Set(['large', 'compact']);
const VALID_ACTION_TYPES = new Set(['uri', 'message', 'postback', 'richmenuswitch']);

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

function parseAreaInput(raw: unknown): Parsed<RichMenuAreaInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'area must be object' };
  const r = raw as Record<string, unknown>;
  const fields: (keyof RichMenuAreaInput)[] = ['boundsX', 'boundsY', 'boundsWidth', 'boundsHeight'];
  for (const f of fields) {
    if (typeof r[f] !== 'number' || !Number.isFinite(r[f]) || (r[f] as number) < 0) {
      return { ok: false, error: `area.${f} must be a non-negative number` };
    }
  }
  if ((r.boundsWidth as number) <= 0 || (r.boundsHeight as number) <= 0) {
    return { ok: false, error: 'area width/height must be positive' };
  }
  if (typeof r.actionType !== 'string' || !VALID_ACTION_TYPES.has(r.actionType)) {
    return { ok: false, error: `area.actionType must be one of ${[...VALID_ACTION_TYPES].join('/')}` };
  }
  if (!r.actionData || typeof r.actionData !== 'object') {
    return { ok: false, error: 'area.actionData must be object' };
  }
  return {
    ok: true,
    value: {
      boundsX: r.boundsX as number,
      boundsY: r.boundsY as number,
      boundsWidth: r.boundsWidth as number,
      boundsHeight: r.boundsHeight as number,
      actionType: r.actionType as RichMenuAreaInput['actionType'],
      actionData: r.actionData as Record<string, unknown>,
    },
  };
}

function parsePageInput(raw: unknown): Parsed<RichMenuPageInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'page must be object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.name !== 'string' || r.name.length === 0) return { ok: false, error: 'page.name required' };
  if (typeof r.orderIndex !== 'number' || !Number.isInteger(r.orderIndex) || r.orderIndex < 0) {
    return { ok: false, error: 'page.orderIndex must be non-negative integer' };
  }
  if (r.id !== undefined && (typeof r.id !== 'string' || r.id.length === 0)) {
    return { ok: false, error: 'page.id must be non-empty string when present' };
  }
  if (!Array.isArray(r.areas)) return { ok: false, error: 'page.areas must be array' };
  if (r.areas.length > 20) return { ok: false, error: 'page.areas exceeds LINE limit of 20' };
  const areas: RichMenuAreaInput[] = [];
  for (const a of r.areas) {
    const parsed = parseAreaInput(a);
    if (!parsed.ok) return parsed;
    areas.push(parsed.value);
  }
  return {
    ok: true,
    value: {
      id: r.id as string | undefined,
      name: r.name,
      orderIndex: r.orderIndex,
      areas,
    },
  };
}

function parsePages(raw: unknown): Parsed<RichMenuPageInput[]> {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false, error: 'pages must be a non-empty array' };
  const pages: RichMenuPageInput[] = [];
  for (const p of raw) {
    const parsed = parsePageInput(p);
    if (!parsed.ok) return parsed;
    pages.push(parsed.value);
  }
  // order_index は 0..N-1 で重複なしを必須化。
  const orders = pages.map((p) => p.orderIndex).sort((a, b) => a - b);
  for (let i = 0; i < orders.length; i++) {
    if (orders[i] !== i) return { ok: false, error: 'page.orderIndex must be 0..N-1 with no duplicates' };
  }
  // page.id (任意) が指定されている場合、payload 内で重複していないことを保証。
  // 重複していると PATCH の id 維持で existingMap が同じ row を 2 回返し PK 衝突する。
  const seen = new Set<string>();
  for (const p of pages) {
    if (p.id !== undefined) {
      if (seen.has(p.id)) {
        return { ok: false, error: `page.id "${p.id}" is duplicated in pages array` };
      }
      seen.add(p.id);
    }
  }
  return { ok: true, value: pages };
}

// create では input.page.id がそのまま DB 投入されない (新 UUID で再生成) ため、
// area.actionData.targetPageId が input.page.id を指していても publish 時に解決できない。
// 段階的なフローを促すため、create 時の richmenuswitch action は明示的に拒否する。
// switcher を組みたい場合は作成後 PATCH で追加する。
function rejectRichmenuswitchInCreate(pages: RichMenuPageInput[]): string | null {
  for (const p of pages) {
    for (const a of p.areas) {
      if (a.actionType === 'richmenuswitch') {
        return 'create payload may not include richmenuswitch actions; create the group first, then PATCH with switcher actions';
      }
    }
  }
  return null;
}

function parseCreateBody(raw: unknown): Parsed<CreateRichMenuGroupInput> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  if (typeof r.accountId !== 'string' || r.accountId.length === 0) return { ok: false, error: 'accountId required' };
  if (typeof r.name !== 'string' || r.name.length === 0) return { ok: false, error: 'name required' };
  if (typeof r.chatBarText !== 'string' || r.chatBarText.length === 0 || r.chatBarText.length > 14) {
    return { ok: false, error: 'chatBarText required (1..14 chars)' };
  }
  if (typeof r.size !== 'string' || !VALID_SIZES.has(r.size)) return { ok: false, error: 'size must be large or compact' };
  if (r.selected !== undefined && typeof r.selected !== 'boolean') {
    return { ok: false, error: 'selected must be boolean' };
  }
  const pages = parsePages(r.pages);
  if (!pages.ok) return pages;
  return {
    ok: true,
    value: {
      accountId: r.accountId,
      name: r.name,
      chatBarText: r.chatBarText,
      size: r.size as 'large' | 'compact',
      selected: r.selected === true,
      pages: pages.value,
    },
  };
}

function parsePatchBody(raw: unknown): Parsed<{ meta: UpdateRichMenuGroupMetaInput; pages?: RichMenuPageInput[] }> {
  if (!raw || typeof raw !== 'object') return { ok: false, error: 'body must be object' };
  const r = raw as Record<string, unknown>;
  const meta: UpdateRichMenuGroupMetaInput = {};
  if (r.name !== undefined) {
    if (typeof r.name !== 'string' || r.name.length === 0) return { ok: false, error: 'name must be non-empty string' };
    meta.name = r.name;
  }
  if (r.chatBarText !== undefined) {
    if (typeof r.chatBarText !== 'string' || r.chatBarText.length === 0 || r.chatBarText.length > 14) {
      return { ok: false, error: 'chatBarText must be 1..14 chars' };
    }
    meta.chatBarText = r.chatBarText;
  }
  if (r.isDefaultForAll !== undefined) {
    if (typeof r.isDefaultForAll !== 'boolean') return { ok: false, error: 'isDefaultForAll must be boolean' };
    meta.isDefaultForAll = r.isDefaultForAll;
  }
  if (r.selected !== undefined) {
    if (typeof r.selected !== 'boolean') return { ok: false, error: 'selected must be boolean' };
    meta.selected = r.selected;
  }
  let pages: RichMenuPageInput[] | undefined;
  if (r.pages !== undefined) {
    const p = parsePages(r.pages);
    if (!p.ok) return p;
    pages = p.value;
  }
  return { ok: true, value: { meta, pages } };
}

// ----- Routes -----

// LINE 上の rich menu の画像をプロキシで返す (Authorization が必要なため
// admin 経由で取得して画面に流す)。
richMenuGroups.get('/api/rich-menu-groups/external/:richMenuId/image', async (c) => {
  const richMenuId = c.req.param('richMenuId');
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);
  const res = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    { headers: { Authorization: `Bearer ${account.channel_access_token}` } },
  );
  if (!res.ok) {
    return c.json(
      { success: false, error: `LINE image fetch failed: ${res.status}` },
      res.status === 404 ? 404 : 500,
    );
  }
  return new Response(res.body, {
    headers: {
      'Content-Type': res.headers.get('content-type') ?? 'image/png',
      'Cache-Control': 'private, max-age=300',
    },
  });
});

// LINE 上の admin 管理外 rich menu を D1 に取り込んで管理対象にする。
// 取り込み後は通常の編集画面で操作できる。
//
// query: { accountId, richMenuId }
richMenuGroups.post('/api/rich-menu-groups/import', async (c) => {
  const accountId = c.req.query('accountId');
  const richMenuId = c.req.query('richMenuId');
  if (!accountId || !richMenuId) {
    return c.json({ success: false, error: 'accountId and richMenuId query params required' }, 400);
  }
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);

  // 既に admin 管理下にあるかチェック
  const existing = await c.env.DB
    .prepare(
      `SELECT g.id, g.name FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ? AND p.line_richmenu_id = ?`,
    )
    .bind(accountId, richMenuId)
    .first<{ id: string; name: string }>();
  if (existing) {
    return c.json(
      { success: false, error: `既に管理画面で管理中のメニューです: ${existing.name}` },
      409,
    );
  }

  const auth = `Bearer ${account.channel_access_token}`;

  // 1. LINE から rich menu 詳細を取得
  const detailRes = await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
    headers: { Authorization: auth },
  });
  if (!detailRes.ok) {
    return c.json(
      { success: false, error: `LINE 詳細取得失敗: ${detailRes.status} ${await detailRes.text()}` },
      500,
    );
  }
  type LineArea = {
    bounds: { x: number; y: number; width: number; height: number };
    action: {
      type: string;
      uri?: string;
      text?: string;
      data?: string;
      displayText?: string;
      richMenuAliasId?: string;
    };
  };
  const detail = (await detailRes.json()) as {
    name: string;
    chatBarText: string;
    selected: boolean;
    size: { width: number; height: number };
    areas: LineArea[];
  };

  // 2. size 判定
  const size: 'large' | 'compact' | null =
    detail.size.width === 2500 && detail.size.height === 1686
      ? 'large'
      : detail.size.width === 2500 && detail.size.height === 843
        ? 'compact'
        : null;
  if (!size) {
    return c.json(
      {
        success: false,
        error: `非対応サイズ ${detail.size.width}x${detail.size.height}。管理画面は 2500×1686 (Large) と 2500×843 (Compact) のみ対応しています。`,
      },
      400,
    );
  }

  // 3. action 変換 (LINE → admin)
  const convertedAreas: RichMenuAreaInput[] = [];
  for (const a of detail.areas ?? []) {
    if (a.action.type === 'uri' && typeof a.action.uri === 'string') {
      convertedAreas.push({
        boundsX: a.bounds.x, boundsY: a.bounds.y,
        boundsWidth: a.bounds.width, boundsHeight: a.bounds.height,
        actionType: 'uri',
        actionData: { uri: a.action.uri },
      });
    } else if (a.action.type === 'message' && typeof a.action.text === 'string') {
      convertedAreas.push({
        boundsX: a.bounds.x, boundsY: a.bounds.y,
        boundsWidth: a.bounds.width, boundsHeight: a.bounds.height,
        actionType: 'message',
        actionData: { text: a.action.text },
      });
    } else if (a.action.type === 'postback' && typeof a.action.data === 'string') {
      convertedAreas.push({
        boundsX: a.bounds.x, boundsY: a.bounds.y,
        boundsWidth: a.bounds.width, boundsHeight: a.bounds.height,
        actionType: 'postback',
        actionData: {
          data: a.action.data,
          ...(a.action.displayText ? { displayText: a.action.displayText } : {}),
        },
      });
    } else if (a.action.type === 'richmenuswitch') {
      return c.json(
        {
          success: false,
          error:
            'タブ切替 (richmenuswitch) を含むリッチメニューは現在インポートできません。タブ切替は管理画面で複数ページとして新規作成してください。',
        },
        400,
      );
    } else {
      return c.json(
        {
          success: false,
          error: `非対応アクション「${a.action.type}」を含むリッチメニューはインポートできません。`,
        },
        400,
      );
    }
  }

  // 4. 画像を LINE から取得して R2 に保存
  const imgRes = await fetch(
    `https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`,
    { headers: { Authorization: auth } },
  );
  if (!imgRes.ok) {
    return c.json(
      { success: false, error: `LINE 画像取得失敗: ${imgRes.status}` },
      500,
    );
  }
  const contentType = imgRes.headers.get('content-type') ?? 'image/png';
  const ext = contentType.includes('jpeg') ? 'jpg' : 'png';
  const imageBytes = new Uint8Array(await imgRes.arrayBuffer());

  // 5. D1 に group + page + areas を作成
  const created = await createRichMenuGroup(c.env.DB, {
    accountId,
    name: detail.name,
    chatBarText: detail.chatBarText,
    size,
    selected: detail.selected,
    pages: [
      {
        name: 'ページ 1',
        orderIndex: 0,
        areas: convertedAreas,
      },
    ],
  });
  const newPage = created.pages[0];

  // 6. 画像を R2 に保存して page に紐付け
  const r2Key = `rich-menus/${accountId}/${created.id}/${newPage.id}/${Date.now()}.${ext}`;
  await c.env.IMAGES.put(r2Key, imageBytes, { httpMetadata: { contentType } });
  await setRichMenuPageImage(c.env.DB, newPage.id, r2Key, contentType);

  // 7. line_richmenu_id を埋めて status='published' に
  await setPageRichMenuId(c.env.DB, newPage.id, richMenuId);
  await markRichMenuGroupPublished(c.env.DB, created.id);

  // 8. alias を upsert (今後の再 publish 時の安定 ID として)
  const aliasId = `lhx-${created.id.slice(0, 8)}-0`;
  try {
    await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
      method: 'DELETE',
      headers: { Authorization: auth },
    });
  } catch {
    // 無視
  }
  await fetch('https://api.line.me/v2/bot/richmenu/alias', {
    method: 'POST',
    headers: { Authorization: auth, 'Content-Type': 'application/json' },
    body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
  });

  return c.json({ success: true, data: { id: created.id, name: created.name } });
});

// LINE 公式アカウント上のリッチメニュー実態と admin 管理状態を突き合わせて返す。
// 一覧画面で「LINE 上には登録されているが admin 外」「現在の default」を可視化するために使う。
richMenuGroups.get('/api/rich-menu-groups/external', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);
  const auth = `Bearer ${account.channel_access_token}`;

  type LineMenu = {
    richMenuId: string;
    name: string;
    chatBarText: string;
    selected: boolean;
    size: { width: number; height: number };
    areas: unknown[];
  };

  // 並列に問い合わせる
  const [listRes, defRes] = await Promise.all([
    fetch('https://api.line.me/v2/bot/richmenu/list', { headers: { Authorization: auth } }),
    fetch('https://api.line.me/v2/bot/user/all/richmenu', { headers: { Authorization: auth } }),
  ]);
  if (!listRes.ok) {
    return c.json(
      { success: false, error: `LINE rich menu list failed: ${listRes.status}` },
      500,
    );
  }
  const listJson = (await listRes.json()) as { richmenus?: LineMenu[] };
  const lineMenus = listJson.richmenus ?? [];

  let currentDefault: string | null = null;
  if (defRes.status === 200) {
    const j = (await defRes.json()) as { richMenuId?: string };
    currentDefault = j.richMenuId ?? null;
  }
  // 404 = default 未設定、それ以外の error は warn として無視 (画面が止まらないように)

  // admin 管理の line_richmenu_id を引いて、各 line menu に admin 情報を付与
  const adminRows = (
    await c.env.DB
      .prepare(
        `SELECT p.line_richmenu_id, p.name AS page_name,
                g.id AS group_id, g.name AS group_name, g.status AS group_status
           FROM rich_menu_pages p
           JOIN rich_menu_groups g ON g.id = p.group_id
          WHERE g.account_id = ? AND p.line_richmenu_id IS NOT NULL`,
      )
      .bind(accountId)
      .all<{
        line_richmenu_id: string;
        page_name: string;
        group_id: string;
        group_name: string;
        group_status: string;
      }>()
  ).results ?? [];
  const adminByRichMenuId = new Map(adminRows.map((r) => [r.line_richmenu_id, r]));

  return c.json({
    success: true,
    data: {
      currentDefault,
      lineMenus: lineMenus.map((m) => {
        const admin = adminByRichMenuId.get(m.richMenuId);
        return {
          richMenuId: m.richMenuId,
          name: m.name,
          chatBarText: m.chatBarText,
          selected: m.selected,
          size: m.size,
          areasCount: Array.isArray(m.areas) ? m.areas.length : 0,
          isCurrentDefault: currentDefault === m.richMenuId,
          adminManaged: !!admin,
          adminInfo: admin
            ? {
                groupId: admin.group_id,
                groupName: admin.group_name,
                pageName: admin.page_name,
                groupStatus: admin.group_status,
              }
            : null,
        };
      }),
    },
  });
});

// LINE 上の rich menu を直接削除する (admin 管理外の orphan を片付ける用)。
// admin 管理されている richMenuId を渡された場合は 409 で拒否
// (Unpublish 経由で消すべき)。
richMenuGroups.delete('/api/rich-menu-groups/external/:richMenuId', async (c) => {
  const richMenuId = c.req.param('richMenuId');
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  const account = await getLineAccountById(c.env.DB, accountId);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 404);

  // admin 管理下の richmenu はここでは削除させない
  const adminRow = await c.env.DB
    .prepare(
      `SELECT g.id, g.name FROM rich_menu_pages p
         JOIN rich_menu_groups g ON g.id = p.group_id
        WHERE g.account_id = ? AND p.line_richmenu_id = ?`,
    )
    .bind(accountId, richMenuId)
    .first<{ id: string; name: string }>();
  if (adminRow) {
    return c.json(
      {
        success: false,
        error: `この richMenu は admin 管理下のメニュー「${adminRow.name}」に紐づいています。編集画面の「LINE から取り下げ」を使ってください。`,
      },
      409,
    );
  }

  const auth = `Bearer ${account.channel_access_token}`;
  const res = await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
    method: 'DELETE',
    headers: { Authorization: auth },
  });
  if (!res.ok && res.status !== 404) {
    return c.json(
      { success: false, error: `LINE delete failed: ${res.status} ${await res.text()}` },
      500,
    );
  }
  return c.json({ success: true });
});

richMenuGroups.get('/api/rich-menu-groups', async (c) => {
  const accountId = c.req.query('accountId');
  if (!accountId) return c.json({ success: false, error: 'accountId query param required' }, 400);
  const groups = await getRichMenuGroups(c.env.DB, accountId);
  // 各 group の代表画像 (default_page_id の image_r2_key、なければ order_index=0 の page) を取得。
  // 一覧カードでサムネを出すために 1 クエリで JOIN する。
  let imageByGroupId = new Map<string, { key: string; contentType: string | null }>();
  if (groups.length > 0) {
    const placeholders = groups.map(() => '?').join(',');
    const result = await c.env.DB
      .prepare(
        `SELECT
            g.id AS group_id,
            COALESCE(
              (SELECT image_r2_key FROM rich_menu_pages WHERE id = g.default_page_id),
              (SELECT image_r2_key FROM rich_menu_pages WHERE group_id = g.id ORDER BY order_index LIMIT 1)
            ) AS image_r2_key,
            COALESCE(
              (SELECT image_content_type FROM rich_menu_pages WHERE id = g.default_page_id),
              (SELECT image_content_type FROM rich_menu_pages WHERE group_id = g.id ORDER BY order_index LIMIT 1)
            ) AS image_content_type
           FROM rich_menu_groups g
          WHERE g.id IN (${placeholders})`,
      )
      .bind(...groups.map((g) => g.id))
      .all<{ group_id: string; image_r2_key: string | null; image_content_type: string | null }>();
    for (const r of result.results ?? []) {
      if (r.image_r2_key) {
        imageByGroupId.set(r.group_id, {
          key: r.image_r2_key,
          contentType: r.image_content_type,
        });
      }
    }
  }
  return c.json({
    success: true,
    data: groups.map((g) => ({
      ...serializeGroup(g),
      thumbnailR2Key: imageByGroupId.get(g.id)?.key ?? null,
    })),
  });
});

richMenuGroups.get('/api/rich-menu-groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true, data: serializeGroupWithPages(group) });
});

richMenuGroups.post('/api/rich-menu-groups', async (c) => {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const parsed = parseCreateBody(body);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);
  const switcherRejection = rejectRichmenuswitchInCreate(parsed.value.pages);
  if (switcherRejection) return c.json({ success: false, error: switcherRejection }, 400);
  const created = await createRichMenuGroup(c.env.DB, parsed.value);
  return c.json({ success: true, data: serializeGroupWithPages(created) });
});

richMenuGroups.patch('/api/rich-menu-groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  const existing = await getRichMenuGroupById(c.env.DB, groupId);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);

  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const parsed = parsePatchBody(body);
  if (!parsed.ok) return c.json({ success: false, error: parsed.error }, 400);

  await updateRichMenuGroupMeta(c.env.DB, groupId, parsed.value.meta);
  if (parsed.value.pages) {
    await replaceRichMenuPages(c.env.DB, groupId, parsed.value.pages);
  }
  const refreshed = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!refreshed) return c.json({ success: false, error: 'group disappeared after update' }, 500);
  return c.json({ success: true, data: serializeGroupWithPages(refreshed) });
});

richMenuGroups.delete('/api/rich-menu-groups/:groupId', async (c) => {
  const groupId = c.req.param('groupId');
  // 公開中の group をいきなり削除すると LINE 上に richmenu / alias / default が
  // 残って復旧不能になる。デフォルトでは status='published' を 409 で reject し、
  // ?force=true (確信を持って残骸を残してもよい) でだけ進める。
  const force = c.req.query('force') === 'true';
  const existing = await getRichMenuGroupById(c.env.DB, groupId);
  if (!existing) return c.json({ success: false, error: 'not found' }, 404);
  if (existing.status === 'published' && !force) {
    return c.json(
      {
        success: false,
        error: 'group is published. Unpublish (POST /unpublish) first, or pass ?force=true to delete D1 row anyway (LINE 側に残骸が残る点に注意)',
      },
      409,
    );
  }
  const ok = await deleteRichMenuGroup(c.env.DB, groupId);
  if (!ok) return c.json({ success: false, error: 'not found' }, 404);
  return c.json({ success: true });
});

// ----- Image upload -----

richMenuGroups.post('/api/rich-menu-groups/:groupId/pages/:pageId/image', async (c) => {
  const { groupId, pageId } = c.req.param();
  const contentType = c.req.header('content-type') ?? '';
  if (contentType !== 'image/png' && contentType !== 'image/jpeg') {
    return c.json({ success: false, error: 'content-type must be image/png or image/jpeg' }, 400);
  }

  const exists = await pageBelongsToGroup(c.env.DB, groupId, pageId);
  if (!exists) return c.json({ success: false, error: 'page not found in group' }, 404);

  const buf = new Uint8Array(await c.req.arrayBuffer());
  const validation = validateRichMenuImage(buf, buf.byteLength);
  if (!validation.ok) return c.json({ success: false, error: validation.error }, 400);

  const group = await getRichMenuGroupById(c.env.DB, groupId);
  if (!group) return c.json({ success: false, error: 'group not found' }, 404);

  // group.size と画像サイズが一致してないと publish 時に LINE API でコンテンツアップロードが
  // 弾かれる (richmenu の宣言サイズと content の dimensions は一致必須)。事前に拒否する。
  if (validation.size !== group.size) {
    return c.json(
      {
        success: false,
        error: `image size '${validation.size}' does not match group size '${group.size}'`,
      },
      400,
    );
  }

  const ext = contentType === 'image/png' ? 'png' : 'jpg';
  const key = `rich-menus/${group.account_id}/${groupId}/${pageId}/${Date.now()}.${ext}`;
  await c.env.IMAGES.put(key, buf, { httpMetadata: { contentType } });
  await setRichMenuPageImage(c.env.DB, pageId, key, contentType);

  return c.json({
    success: true,
    data: { imageR2Key: key, imageContentType: contentType, size: validation.size },
  });
});

// 画像取得 — エディタからの <img src="..."> 用。private cache でアクセス制御は auth に委ねる。
richMenuGroups.get('/api/rich-menu-images/:key{.+}', async (c) => {
  const key = c.req.param('key');
  // This path is exempt from authMiddleware (public), so it must never serve
  // arbitrary bucket objects: editor uploads all live under rich-menus/.
  if (!key.startsWith('rich-menus/')) return c.notFound();
  const obj = await c.env.IMAGES.get(key);
  if (!obj) return c.notFound();
  return new Response(obj.body, {
    headers: {
      'Content-Type': obj.httpMetadata?.contentType ?? 'application/octet-stream',
      'Cache-Control': 'private, max-age=60',
    },
  });
});

// ----- Publish -----

function createLineClient(channelAccessToken: string): LineRichMenuClient {
  const auth = `Bearer ${channelAccessToken}`;
  return {
    async createRichMenu(payload) {
      const res = await fetch('https://api.line.me/v2/bot/richmenu', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(`LINE createRichMenu failed: ${res.status} ${await res.text()}`);
      return res.json() as Promise<{ richMenuId: string }>;
    },
    async uploadRichMenuImage(richMenuId, image, contentType) {
      const res = await fetch(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': contentType },
        body: image,
      });
      if (!res.ok) throw new Error(`LINE uploadRichMenuImage failed: ${res.status} ${await res.text()}`);
    },
    async deleteRichMenuAlias(aliasId) {
      const res = await fetch(`https://api.line.me/v2/bot/richmenu/alias/${aliasId}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE deleteRichMenuAlias failed: ${res.status} ${await res.text()}`);
      }
    },
    async createRichMenuAlias(aliasId, richMenuId) {
      const res = await fetch('https://api.line.me/v2/bot/richmenu/alias', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ richMenuAliasId: aliasId, richMenuId }),
      });
      if (!res.ok) throw new Error(`LINE createRichMenuAlias failed: ${res.status} ${await res.text()}`);
    },
    async deleteRichMenu(richMenuId) {
      const res = await fetch(`https://api.line.me/v2/bot/richmenu/${richMenuId}`, {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE deleteRichMenu failed: ${res.status} ${await res.text()}`);
      }
    },
    async setDefaultRichMenu(richMenuId) {
      const res = await fetch(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`, {
        method: 'POST',
        headers: { Authorization: auth },
      });
      if (!res.ok) throw new Error(`LINE setDefaultRichMenu failed: ${res.status} ${await res.text()}`);
    },
    async clearDefaultRichMenu() {
      // 既存 default を解除。default 未設定でも LINE は 200 を返すので冪等。
      const res = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
        method: 'DELETE',
        headers: { Authorization: auth },
      });
      if (!res.ok && res.status !== 404) {
        throw new Error(`LINE clearDefaultRichMenu failed: ${res.status} ${await res.text()}`);
      }
    },
    async getCurrentDefaultRichMenuId() {
      const res = await fetch('https://api.line.me/v2/bot/user/all/richmenu', {
        method: 'GET',
        headers: { Authorization: auth },
      });
      // 設定なしは 404 が返る — null として返す。
      if (res.status === 404) return null;
      if (!res.ok) {
        throw new Error(`LINE getCurrentDefaultRichMenu failed: ${res.status} ${await res.text()}`);
      }
      const body = (await res.json()) as { richMenuId?: string };
      return body.richMenuId ?? null;
    },
    async linkRichMenuBulk(richMenuId, userIds) {
      // POST /v2/bot/richmenu/bulk/link  — 1 リクエスト最大 500 ユーザー
      const res = await fetch('https://api.line.me/v2/bot/richmenu/bulk/link', {
        method: 'POST',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ richMenuId, userIds }),
      });
      if (!res.ok) {
        throw new Error(`LINE linkRichMenuBulk failed: ${res.status} ${await res.text()}`);
      }
    },
  };
}

richMenuGroups.post('/api/rich-menu-groups/:groupId/publish', async (c) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group) return c.json({ success: false, error: 'not found' }, 404);
  if (group.publishing_at) return c.json({ success: false, error: 'already publishing' }, 409);

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  const locked = await acquirePublishLock(c.env.DB, groupId);
  if (!locked) return c.json({ success: false, error: 'failed to acquire publish lock' }, 409);

  try {
    const line = createLineClient(account.channel_access_token);
    const r2Adapter: R2Like = {
      async get(key) {
        const obj = await c.env.IMAGES.get(key);
        if (!obj) return null;
        return { body: obj.body as ReadableStream };
      },
    };
    const groupInput: GroupInput = {
      id: group.id,
      size: group.size,
      chatBarText: group.chat_bar_text,
      isDefaultForAll: group.is_default_for_all === 1,
      selected: group.selected === 1,
      pages: group.pages.map((p) => ({
        id: p.id,
        orderIndex: p.order_index,
        name: p.name,
        imageR2Key: p.image_r2_key,
        imageContentType: p.image_content_type,
        lineRichMenuId: p.line_richmenu_id,
        areas: p.areas.map((a) => ({
          bounds: { x: a.bounds_x, y: a.bounds_y, width: a.bounds_width, height: a.bounds_height },
          actionType: a.action_type,
          actionData: a.actionData,
        })),
      })),
    };
    const result = await publishRichMenuGroup(groupInput, line, r2Adapter);
    for (const r of result.pages) {
      await setPageRichMenuId(c.env.DB, r.pageId, r.newRichMenuId);
    }
    await markRichMenuGroupPublished(c.env.DB, groupId);
    return c.json({ success: true, data: result });
  } catch (e) {
    await releasePublishLock(c.env.DB, groupId);
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: message }, 500);
  }
});

// ----- Unpublish -----

// LINE 上の alias / richmenu / default を全削除して draft に戻す。
// 削除フローや、別 group を default にしたい時に使う。idempotent (既に消えてる
// alias / richmenu は 404 を許容)。
richMenuGroups.post('/api/rich-menu-groups/:groupId/unpublish', async (c) => {
  const groupId = c.req.param('groupId');
  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group) return c.json({ success: false, error: 'not found' }, 404);

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  const line = createLineClient(account.channel_access_token);
  const groupInput: GroupInput = {
    id: group.id,
    size: group.size,
    chatBarText: group.chat_bar_text,
    isDefaultForAll: group.is_default_for_all === 1,
    selected: group.selected === 1,
    pages: group.pages.map((p) => ({
      id: p.id,
      orderIndex: p.order_index,
      name: p.name,
      imageR2Key: p.image_r2_key,
      imageContentType: p.image_content_type,
      lineRichMenuId: p.line_richmenu_id,
      areas: [],
    })),
  };
  try {
    const result = await unpublishRichMenuGroup(groupInput, line);
    await markRichMenuGroupUnpublished(c.env.DB, groupId);
    return c.json({ success: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: message }, 500);
  }
});

// ----- Bulk apply by tag / set as account default -----

// 指定タグに紐づく友だち全員に、この group の default page の richmenu を割り当てる。
// LINE bulk link API (最大 500 ユーザー / リクエスト) を必要に応じて分割実行。
//
// body:
//   { mode?: 'bulk-link', tagId: string | null }
//     bulk-link (デフォルト): 該当 friends 全員に link。tagId=null は account 内全 follower。
//   { mode: 'set-default' }
//     LINE 公式アカウントの「全員のデフォルト」に設定。新規 follower にも自動で表示される。
//     同 account 内の他 group の is_default_for_all は 0 にリセット。
//
// 前提: group が published かつ default_page に line_richmenu_id がセット済み。
richMenuGroups.post('/api/rich-menu-groups/:groupId/apply-to-tag', async (c) => {
  const groupId = c.req.param('groupId');
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid JSON body' }, 400);
  }
  const r = (body as { tagId?: unknown; mode?: unknown }) ?? {};
  const mode = (r.mode as string | undefined) ?? 'bulk-link';
  if (mode !== 'bulk-link' && mode !== 'set-default') {
    return c.json({ success: false, error: "mode must be 'bulk-link' or 'set-default'" }, 400);
  }
  if (mode === 'bulk-link') {
    if (r.tagId !== null && r.tagId !== undefined && typeof r.tagId !== 'string') {
      return c.json({ success: false, error: 'tagId must be string or null' }, 400);
    }
  }
  const tagId = (r.tagId as string | null | undefined) ?? null;

  const group = await getRichMenuGroupWithPages(c.env.DB, groupId);
  if (!group) return c.json({ success: false, error: 'not found' }, 404);
  if (group.status !== 'published') {
    return c.json(
      { success: false, error: 'group must be published before applying to friends' },
      400,
    );
  }
  // default_page の line_richmenu_id を採用 (未設定なら order_index=0 の page)
  const targetPage =
    group.pages.find((p) => p.id === group.default_page_id) ??
    [...group.pages].sort((a, b) => a.order_index - b.order_index)[0];
  if (!targetPage?.line_richmenu_id) {
    return c.json(
      { success: false, error: 'no published rich menu found for default page' },
      400,
    );
  }

  const account = await getLineAccountById(c.env.DB, group.account_id);
  if (!account) return c.json({ success: false, error: 'line account not found' }, 500);

  // ---- mode: set-default (LINE 全員のデフォルトに設定) ----
  if (mode === 'set-default') {
    try {
      const line = createLineClient(account.channel_access_token);
      await line.setDefaultRichMenu(targetPage.line_richmenu_id);
      // 同 account 内の他 group の is_default_for_all をリセットして、自分だけ true に。
      const now = new Date().toISOString();
      await c.env.DB.batch([
        c.env.DB
          .prepare(
            `UPDATE rich_menu_groups SET is_default_for_all = 0, updated_at = ?
              WHERE account_id = ? AND id != ?`,
          )
          .bind(now, group.account_id, groupId),
        c.env.DB
          .prepare(
            `UPDATE rich_menu_groups SET is_default_for_all = 1, updated_at = ? WHERE id = ?`,
          )
          .bind(now, groupId),
      ]);
      return c.json({
        success: true,
        data: { mode: 'set-default', total: 0, chunks: 0, message: '全員のデフォルトに設定しました' },
      });
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      return c.json({ success: false, error: message }, 500);
    }
  }

  // ---- mode: bulk-link (タグ or 全 follower に link) ----
  const userIds = await getFollowingLineUserIdsByTag(
    c.env.DB,
    group.account_id,
    tagId,
  );
  if (userIds.length === 0) {
    return c.json({
      success: true,
      data: { chunks: 0, total: 0, message: 'no matching followers' },
    });
  }

  try {
    const line = createLineClient(account.channel_access_token);
    const result = await linkRichMenuBulkChunked(
      line,
      targetPage.line_richmenu_id,
      userIds,
    );
    return c.json({ success: true, data: result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return c.json({ success: false, error: message }, 500);
  }
});
