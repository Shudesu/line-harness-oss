/**
 * iOS/Android アプリからのデバイストークン登録/削除エンドポイント。
 *
 * 認証: 認証必須 (auth.ts ミドルウェアで Bearer 検証済)。
 *   staff の api_key で認証されるので、c.get('staff') から staff_id が取れる。
 */

import { Hono } from 'hono';
import {
  registerDeviceToken,
  deleteDeviceToken,
  getDeviceTokensForStaff,
} from '@line-crm/db';
import type { Env } from '../index.js';

export const deviceTokens = new Hono<Env>();

deviceTokens.post('/api/device-tokens', async (c) => {
  const staff = c.get('staff');
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  let body: {
    token?: string;
    platform?: 'ios' | 'android';
    bundle_id?: string;
    environment?: 'production' | 'sandbox';
    device_name?: string;
  };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: 'invalid json' }, 400);
  }
  if (!body.token || !body.platform || !body.bundle_id || !body.environment) {
    return c.json(
      { success: false, error: 'token / platform / bundle_id / environment は必須' },
      400,
    );
  }
  if (!['ios', 'android'].includes(body.platform)) {
    return c.json({ success: false, error: 'platform は ios または android' }, 400);
  }
  if (!['production', 'sandbox'].includes(body.environment)) {
    return c.json({ success: false, error: 'environment は production または sandbox' }, 400);
  }
  try {
    const dt = await registerDeviceToken(c.env.DB, {
      staffId: staff.id,
      token: body.token,
      platform: body.platform,
      bundleId: body.bundle_id,
      environment: body.environment,
      deviceName: body.device_name ?? null,
    });
    return c.json({ success: true, data: dt }, 201);
  } catch (err) {
    console.error('[device-tokens] register error:', err);
    return c.json({ success: false, error: 'internal error' }, 500);
  }
});

deviceTokens.delete('/api/device-tokens/:token', async (c) => {
  // Round2 セキュリティ agent 指摘: 認証なし削除は DoS (他 staff の通知止め攻撃) 経路。
  // 認証必須 + 自分の token のみ削除可とする。
  const staff = c.get('staff');
  if (!staff) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }
  const token = c.req.param('token');
  // staff 所有の token か検証
  const ownedTokens = await getDeviceTokensForStaff(c.env.DB, staff.id);
  const owned = ownedTokens.some((t) => t.token === token);
  if (!owned) {
    // 「ある/ない」を漏らさないため 404
    return c.json({ success: false, error: 'Not found' }, 404);
  }
  await deleteDeviceToken(c.env.DB, token);
  return c.json({ success: true });
});

deviceTokens.get('/api/device-tokens/mine', async (c) => {
  const staff = c.get('staff');
  if (!staff) return c.json({ success: false, error: 'Unauthorized' }, 401);
  const list = await getDeviceTokensForStaff(c.env.DB, staff.id);
  return c.json({ success: true, data: list });
});
