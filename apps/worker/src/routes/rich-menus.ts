import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import {
  getFriendById,
  getRichMenusLocal,
  getRichMenuLocalById,
  createRichMenuLocal,
  updateRichMenuLocal,
  deleteRichMenuLocal,
  getRichMenuRules,
  createRichMenuRule,
  deleteRichMenuRule,
  getRichMenuAliases,
  createRichMenuAliasLocal,
  deleteRichMenuAliasLocal,
  evaluateRichMenuForFriend,
} from '@line-crm/db';
import type { Env } from '../index.js';

const richMenus = new Hono<Env>();

// ─── LINE API pass-through endpoints ──────────────────────────────────────────

// GET /api/rich-menus — list all rich menus from LINE API
richMenus.get('/api/rich-menus', async (c) => {
  try {
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const result = await lineClient.getRichMenuList();
    return c.json({ success: true, data: result.richmenus ?? [] });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('GET /api/rich-menus error:', message);
    return c.json({ success: false, error: `Failed to fetch rich menus: ${message}` }, 500);
  }
});

// POST /api/rich-menus — create a rich menu via LINE API + save locally
richMenus.post('/api/rich-menus', async (c) => {
  try {
    const body = await c.req.json();
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    const result = await lineClient.createRichMenu(body);

    // Save to local DB
    const lineAccountId = (body as Record<string, string>).lineAccountId;
    await createRichMenuLocal(c.env.DB, {
      lineRichMenuId: result.richMenuId,
      name: body.name || result.richMenuId,
      chatBarText: body.chatBarText || 'メニュー',
      sizeWidth: body.size?.width || 2500,
      sizeHeight: body.size?.height || 1686,
      areasJson: JSON.stringify(body.areas || []),
      lineAccountId,
    });

    return c.json({ success: true, data: result }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus error:', message);
    return c.json({ success: false, error: `Failed to create rich menu: ${message}` }, 500);
  }
});

// DELETE /api/rich-menus/:id — delete a rich menu (LINE API + local DB)
richMenus.delete('/api/rich-menus/:id', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);

    // Try to delete from LINE API (may fail if already deleted)
    try {
      await lineClient.deleteRichMenu(richMenuId);
    } catch {
      // Ignore LINE API errors — menu may have been deleted externally
    }

    // Delete from local DB by line_rich_menu_id or local id
    const local = await c.env.DB
      .prepare('SELECT id FROM rich_menus WHERE line_rich_menu_id = ? OR id = ?')
      .bind(richMenuId, richMenuId)
      .first<{ id: string }>();
    if (local) {
      await deleteRichMenuLocal(c.env.DB, local.id);
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('DELETE /api/rich-menus/:id error:', message);
    return c.json({ success: false, error: `Failed to delete rich menu: ${message}` }, 500);
  }
});

// POST /api/rich-menus/:id/default — set rich menu as default for all users
richMenus.post('/api/rich-menus/:id/default', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    await lineClient.setDefaultRichMenu(richMenuId);

    // Update local DB: set this as default, unset others
    const local = await c.env.DB
      .prepare('SELECT id FROM rich_menus WHERE line_rich_menu_id = ?')
      .bind(richMenuId)
      .first<{ id: string }>();
    if (local) {
      await c.env.DB.prepare('UPDATE rich_menus SET is_default = 0 WHERE is_default = 1').run();
      await updateRichMenuLocal(c.env.DB, local.id, { isDefault: 1 });
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/:id/default error:', message);
    return c.json({ success: false, error: `Failed to set default rich menu: ${message}` }, 500);
  }
});

// POST /api/rich-menus/:id/image — upload rich menu image
richMenus.post('/api/rich-menus/:id/image', async (c) => {
  try {
    const richMenuId = c.req.param('id');
    const contentType = c.req.header('content-type') ?? '';

    let imageData: ArrayBuffer;
    let imageContentType: 'image/png' | 'image/jpeg' = 'image/png';

    if (contentType.includes('application/json')) {
      const body = await c.req.json<{ image: string; contentType?: string }>();
      if (!body.image) {
        return c.json({ success: false, error: 'image (base64) is required' }, 400);
      }
      const base64 = body.image.replace(/^data:image\/\w+;base64,/, '');
      const binaryString = atob(base64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }
      imageData = bytes.buffer;
      if (body.contentType === 'image/jpeg') imageContentType = 'image/jpeg';
    } else if (contentType.includes('image/')) {
      imageData = await c.req.arrayBuffer();
      imageContentType = contentType.includes('jpeg') || contentType.includes('jpg') ? 'image/jpeg' : 'image/png';
    } else {
      return c.json({ success: false, error: 'Content-Type must be application/json (with base64) or image/png or image/jpeg' }, 400);
    }

    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    await lineClient.uploadRichMenuImage(richMenuId, imageData, imageContentType);

    // Save image to R2 and update local DB
    try {
      const r2Key = `rich-menus/${richMenuId}.${imageContentType === 'image/jpeg' ? 'jpg' : 'png'}`;
      await c.env.IMAGES.put(r2Key, imageData, { httpMetadata: { contentType: imageContentType } });

      const local = await c.env.DB
        .prepare('SELECT id FROM rich_menus WHERE line_rich_menu_id = ?')
        .bind(richMenuId)
        .first<{ id: string }>();
      if (local) {
        const imageUrl = `/api/images/${r2Key}`;
        await updateRichMenuLocal(c.env.DB, local.id, { imageUrl });
      }
    } catch (err) {
      console.error('R2 upload error (non-fatal):', err);
    }

    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('POST /api/rich-menus/:id/image error:', message);
    return c.json({ success: false, error: `Failed to upload rich menu image: ${message}` }, 500);
  }
});

// ─── Local DB endpoints ──────────────────────────────────────────────────────

// GET /api/rich-menus-local — list menus from local DB
richMenus.get('/api/rich-menus-local', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const menus = await getRichMenusLocal(c.env.DB, lineAccountId);
    return c.json({ success: true, data: menus });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// PUT /api/rich-menus-local/:id — update local rich menu metadata
richMenus.put('/api/rich-menus-local/:id', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ name?: string; areasJson?: string; imageUrl?: string }>();
    await updateRichMenuLocal(c.env.DB, id, body);
    const updated = await getRichMenuLocalById(c.env.DB, id);
    return c.json({ success: true, data: updated });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── Friend link/unlink ──────────────────────────────────────────────────────

// POST /api/friends/:friendId/rich-menu
richMenus.post('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const body = await c.req.json<{ richMenuId: string }>();
    if (!body.richMenuId) {
      return c.json({ success: false, error: 'richMenuId is required' }, 400);
    }
    const friend = await getFriendById(c.env.DB, friendId);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    await lineClient.linkRichMenuToUser(friend.line_user_id, body.richMenuId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /api/friends/:friendId/rich-menu
richMenus.delete('/api/friends/:friendId/rich-menu', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const friend = await getFriendById(c.env.DB, friendId);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    await lineClient.unlinkRichMenuFromUser(friend.line_user_id);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── Rules CRUD ──────────────────────────────────────────────────────────────

// GET /api/rich-menu-rules
richMenus.get('/api/rich-menu-rules', async (c) => {
  try {
    const lineAccountId = c.req.query('lineAccountId');
    const rules = await getRichMenuRules(c.env.DB, lineAccountId);
    return c.json({ success: true, data: rules });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/rich-menu-rules
richMenus.post('/api/rich-menu-rules', async (c) => {
  try {
    const body = await c.req.json<{
      name: string;
      tagId: string;
      richMenuId: string;
      priority?: number;
      lineAccountId?: string;
    }>();
    if (!body.name || !body.tagId || !body.richMenuId) {
      return c.json({ success: false, error: 'name, tagId, richMenuId are required' }, 400);
    }
    const rule = await createRichMenuRule(c.env.DB, body);
    return c.json({ success: true, data: rule }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /api/rich-menu-rules/:id
richMenus.delete('/api/rich-menu-rules/:id', async (c) => {
  try {
    await deleteRichMenuRule(c.env.DB, c.req.param('id'));
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/rich-menu-rules/evaluate/:friendId — evaluate and apply menu for a friend
richMenus.post('/api/rich-menu-rules/evaluate/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    const lineAccountId = c.req.query('lineAccountId');
    const friend = await getFriendById(c.env.DB, friendId);
    if (!friend) return c.json({ success: false, error: 'Friend not found' }, 404);

    const lineRichMenuId = await evaluateRichMenuForFriend(c.env.DB, friendId, lineAccountId);
    if (lineRichMenuId) {
      const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
      await lineClient.linkRichMenuToUser(friend.line_user_id, lineRichMenuId);
      return c.json({ success: true, data: { richMenuId: lineRichMenuId, applied: true } });
    }
    return c.json({ success: true, data: { richMenuId: null, applied: false } });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// ─── Aliases CRUD ────────────────────────────────────────────────────────────

// GET /api/rich-menu-aliases
richMenus.get('/api/rich-menu-aliases', async (c) => {
  try {
    const aliases = await getRichMenuAliases(c.env.DB);
    return c.json({ success: true, data: aliases });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// POST /api/rich-menu-aliases
richMenus.post('/api/rich-menu-aliases', async (c) => {
  try {
    const body = await c.req.json<{ aliasId: string; richMenuId: string }>();
    if (!body.aliasId || !body.richMenuId) {
      return c.json({ success: false, error: 'aliasId and richMenuId are required' }, 400);
    }

    // Create alias on LINE API first
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    try {
      await lineClient.createRichMenuAlias(body.richMenuId, body.aliasId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      // If alias already exists, try updating instead
      if (msg.includes('409') || msg.includes('already')) {
        await lineClient.updateRichMenuAlias(body.aliasId, body.richMenuId);
      } else {
        throw err;
      }
    }

    // Save locally
    const alias = await createRichMenuAliasLocal(c.env.DB, body);
    return c.json({ success: true, data: alias }, 201);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

// DELETE /api/rich-menu-aliases/:aliasId
richMenus.delete('/api/rich-menu-aliases/:aliasId', async (c) => {
  try {
    const aliasId = c.req.param('aliasId');
    const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
    try { await lineClient.deleteRichMenuAlias(aliasId); } catch { /* ignore */ }
    await deleteRichMenuAliasLocal(c.env.DB, aliasId);
    return c.json({ success: true, data: null });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return c.json({ success: false, error: message }, 500);
  }
});

export { richMenus };
