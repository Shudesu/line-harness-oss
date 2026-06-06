import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

type Role = 'owner' | 'admin' | 'staff' | 'viewer';

export function requireRole(...allowed: Role[]) {
  return async (c: Context<Env>, next: Next): Promise<Response | void> => {
    const staff = c.get('staff');
    if (!staff || !allowed.includes(staff.role)) {
      return c.json(
        { success: false, error: `この操作には${allowed[0]}権限が必要です` },
        403,
      );
    }
    return next();
  };
}

/**
 * L-TRACK 互換: viewer (閲覧専用) のための書込操作禁止ミドルウェア (グローバル適用版)。
 * HTTP method が GET/HEAD/OPTIONS 以外で role=viewer なら 403。
 * authMiddleware の直後に app.use('*', blockViewerWrites) で挿す想定。
 *
 * これで顧問先・代理店に viewer ロールでアカウントを発行しても、
 * 誤って何かを変更/削除する事故を構造的に防げる。
 */
export async function blockViewerWrites(
  c: Context<Env>,
  next: Next,
): Promise<Response | void> {
  const method = c.req.method.toUpperCase();
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
    return next();
  }
  const staff = c.get('staff');
  if (staff && staff.role === 'viewer') {
    return c.json(
      {
        success: false,
        error: '閲覧専用アカウントのため書込操作はできません (viewer role)',
      },
      403,
    );
  }
  return next();
}
