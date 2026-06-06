import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { getFriendById, getLineAccountById } from '@line-crm/db';
import type { Env } from '../index.js';
import { defaultLineAccessToken } from '../services/line-bindings.js';

const richMenus = new Hono<Env>();

function normalizeAccessToken(value?: string | null): string {
  return value?.trim() ?? '';
}

function isLineUnauthorizedError(message: string): boolean {
  return message.includes('LINE API error: 401') || message.includes('Authentication failed');
}

function richMenuError(message: string, operation: string) {
  if (isLineUnauthorizedError(message)) {
    return {
      error: `${operation}: LINEアクセストークンが無効です。選択中のLINEアカウントに保存された Channel access token を更新してください。Cloudflare Secrets Store の LINE_CHANNEL_ACCESS_TOKEN ではなく、画面上で選択中の line_accounts のトークンが使われています。`,
      status: 401,
    };
  }
  return { error: `${operation}: ${message}`, status: 500 };
}

/** Resolve LINE access token — uses accountId query param if provided, otherwise default */
async function resolveLineClient(c: { env: Env['Bindings']; req: { query(key: string): string | undefined } }): Promise<LineClient> {
  const accountId = c.req.query('accountId');
  if (accountId) {
    const account = await getLineAccountById(c.env.DB, accountId);
    if (!account) throw new Error('Selected LINE account was not found');
    const token = normalizeAccessToken(account.channel_access_token);
    if (!token) throw new Error('Selected LINE account channel access token is not configured');
    return new LineClient(token);
  }
  return new LineClient(await defaultLineAccessToken(c.env));
}

// GET /api/rich-menus — list all rich menus from LINE API
richMenus.get('/api/rich-menus', async (c) => {
  try {
    const lineClient = await resolveLineClient(c);
    const result = await lineClient.getRichMenuList();
    return c.json({ success: true, data: result.richmenus ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/rich-menus error:', message);
    const mapped = richMenuError(message, 'Failed to fetch rich menus');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// POST /api/rich-menus — create a rich menu via LINE API
richMenus.post('/api/rich-menus', async (c) => {
  try {
    const body = await c.req.json();
    const lineClient = await resolveLineClient(c);
    const result = await lineClient.createRichMenu(body);
    return c.json({ success: true, data: result }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus error:', message);
    const mapped = richMenuError(message, 'Failed to create rich menu');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// DELETE /api/rich-menus/:id — delete a rich menu
richMenus.delete('/api/rich-menus/:id', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = await resolveLineClient(c);
    await lineClient.deleteRichMenu(richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/rich-menus/:id error:', message);
    const mapped = richMenuError(message, 'Failed to delete rich menu');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// POST /api/rich-menus/:id/default — set rich menu as default for all users
richMenus.post('/api/rich-menus/:id/default', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = await resolveLineClient(c);
    await lineClient.setDefaultRichMenu(richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/:id/default error:', message);
    const mapped = richMenuError(message, 'Failed to set default rich menu');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// POST /api/rich-menus/aliases — create or update a rich menu alias.
// Required for richmenuswitch tab-style rich menus.
richMenus.post('/api/rich-menus/aliases', async (c) => {
  try {
    const body = await c.req.json<{ richMenuAliasId?: string; richMenuId?: string; upsert?: boolean }>();
    const richMenuAliasId = body.richMenuAliasId?.trim();
    const richMenuId = body.richMenuId?.trim();
    if (!richMenuAliasId || !richMenuId) {
      return c.json({ success: false, error: 'richMenuAliasId and richMenuId are required' }, 400);
    }
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(richMenuAliasId)) {
      return c.json({ success: false, error: 'richMenuAliasId must be 1-32 chars: letters, numbers, _ or -' }, 400);
    }

    const lineClient = await resolveLineClient(c);
    try {
      await lineClient.createRichMenuAlias(richMenuAliasId, richMenuId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!body.upsert || !message.includes('400')) throw err;
      await lineClient.updateRichMenuAlias(richMenuAliasId, richMenuId);
    }
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/aliases error:', message);
    const mapped = richMenuError(message, 'Failed to save rich menu alias');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// DELETE /api/rich-menus/aliases/:aliasId — delete a rich menu alias.
richMenus.delete('/api/rich-menus/aliases/:aliasId', async (c) => {
  try {
    const aliasId = c.req.param('aliasId');
    const lineClient = await resolveLineClient(c);
    await lineClient.deleteRichMenuAlias(aliasId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/rich-menus/aliases/:aliasId error:', message);
    const mapped = richMenuError(message, 'Failed to delete rich menu alias');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// POST /api/friends/:friendId/rich-menu — link rich menu to a specific friend
richMenus.post('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ richMenuId: string }>();

    if (!body.richMenuId) {
      return c.json({ success: false, error: 'richMenuId is required' }, 400);
    }

    const db = c.env.DB;
    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accessToken = await defaultLineAccessToken(c.env);
    const friendAccountId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccountId) {
      const account = await getLineAccountById(db, friendAccountId);
      if (account) accessToken = normalizeAccessToken(account.channel_access_token);
    }
    const lineClient = new LineClient(accessToken);
    await lineClient.linkRichMenuToUser(friend.line_user_id, body.richMenuId);

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/friends/:friendId/rich-menu error:', message);
    const mapped = richMenuError(message, 'Failed to link rich menu to friend');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

// DELETE /api/friends/:friendId/rich-menu — unlink rich menu from a specific friend
richMenus.delete('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const db = c.env.DB;

    const friend = await getFriendById(db, friendId);
    if (!friend) {
      return c.json({ success: false, error: 'Friend not found' }, 404);
    }

    let accessToken = await defaultLineAccessToken(c.env);
    const friendAccId = (friend as unknown as Record<string, string | null>).line_account_id;
    if (friendAccId) {
      const account = await getLineAccountById(c.env.DB, friendAccId);
      if (account) accessToken = normalizeAccessToken(account.channel_access_token);
    }
    const lineClient = new LineClient(accessToken);
    await lineClient.unlinkRichMenuFromUser(friend.line_user_id);

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/friends/:friendId/rich-menu error:', message);
    const mapped = richMenuError(message, 'Failed to unlink rich menu from friend');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});

export { richMenus };

// POST /api/rich-menus/:id/image — upload rich menu image (accepts base64 body or binary)
richMenus.post('/api/rich-menus/:id/image', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';

    let imageData: ArrayBuffer;
    let imageContentType: 'image/png' | 'image/jpeg' = 'image/png';

    if (contentType.includes('application/json')) {
      // Accept base64 encoded image in JSON body
      const body = await c.req.json<{ image: string; contentType?: string }>();
      if (!body.image) {
        return c.json({ success: false, error: 'image (base64) is required' }, 400);
      }
      // Strip data URI prefix if present
      const base64 = body.image.replace(/^data:image\/\w+;base64,/, '');
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      imageData = bytes.buffer;
      if (body.contentType === 'image/jpeg') imageContentType = 'image/jpeg';
    } else if (contentType.includes('image/')) {
      // Accept raw binary upload
      imageData = await c.req.arrayBuffer();
      imageContentType = contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' : 'image/png';
    } else {
      return c.json({ success: false, error: 'Content-Type must be application/json (with base64) or image/png or image/jpeg' }, 400);
    }

    const lineClient = await resolveLineClient(c);
    await lineClient.uploadRichMenuImage(richMenuId, imageData, imageContentType);

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/:id/image error:', message);
    const mapped = richMenuError(message, 'Failed to upload rich menu image');
    return c.json({ success: false, error: mapped.error }, mapped.status as 401 | 500);
  }
});
