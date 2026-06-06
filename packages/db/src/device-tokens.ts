/**
 * iOS/Android アプリのプッシュ通知用デバイストークン管理 (migration 061)。
 * APNs/FCM 配信時に staff_id 単位でトークンを引いて送る。
 */

import { jstNow } from './utils.js';

export type DevicePlatform = 'ios' | 'android';
export type DeviceEnvironment = 'production' | 'sandbox';

export interface DeviceToken {
  id: string;
  staff_id: string;
  token: string;
  platform: DevicePlatform;
  bundle_id: string;
  environment: DeviceEnvironment;
  device_name: string | null;
  is_active: number;
  last_seen_at: string;
  created_at: string;
}

export async function registerDeviceToken(
  db: D1Database,
  input: {
    staffId: string;
    token: string;
    platform: DevicePlatform;
    bundleId: string;
    environment: DeviceEnvironment;
    deviceName?: string | null;
  },
): Promise<DeviceToken> {
  const id = crypto.randomUUID();
  const now = jstNow();
  // UPSERT: 同じ token が来たら staff_id 等を最新化（再ログイン・再起動時）
  await db
    .prepare(
      `INSERT INTO device_tokens
         (id, staff_id, token, platform, bundle_id, environment, device_name, is_active, last_seen_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       ON CONFLICT(token) DO UPDATE SET
         staff_id = excluded.staff_id,
         platform = excluded.platform,
         bundle_id = excluded.bundle_id,
         environment = excluded.environment,
         device_name = excluded.device_name,
         is_active = 1,
         last_seen_at = excluded.last_seen_at`,
    )
    .bind(
      id,
      input.staffId,
      input.token,
      input.platform,
      input.bundleId,
      input.environment,
      input.deviceName ?? null,
      now,
      now,
    )
    .run();
  return (await db
    .prepare(`SELECT * FROM device_tokens WHERE token = ?`)
    .bind(input.token)
    .first<DeviceToken>())!;
}

export async function deleteDeviceToken(db: D1Database, token: string): Promise<void> {
  await db.prepare(`DELETE FROM device_tokens WHERE token = ?`).bind(token).run();
}

export async function deactivateDeviceToken(db: D1Database, token: string): Promise<void> {
  await db
    .prepare(`UPDATE device_tokens SET is_active = 0 WHERE token = ?`)
    .bind(token)
    .run();
}

export async function getDeviceTokensForStaff(
  db: D1Database,
  staffId: string,
): Promise<DeviceToken[]> {
  const r = await db
    .prepare(
      `SELECT * FROM device_tokens WHERE staff_id = ? AND is_active = 1 ORDER BY last_seen_at DESC`,
    )
    .bind(staffId)
    .all<DeviceToken>();
  return r.results;
}

export async function getAllDeviceTokens(
  db: D1Database,
  opts: { platform?: DevicePlatform } = {},
): Promise<DeviceToken[]> {
  if (opts.platform) {
    const r = await db
      .prepare(`SELECT * FROM device_tokens WHERE platform = ? AND is_active = 1`)
      .bind(opts.platform)
      .all<DeviceToken>();
    return r.results;
  }
  const r = await db
    .prepare(`SELECT * FROM device_tokens WHERE is_active = 1`)
    .all<DeviceToken>();
  return r.results;
}

export async function touchDeviceTokenUsage(db: D1Database, token: string): Promise<void> {
  const now = jstNow();
  await db
    .prepare(`UPDATE device_tokens SET last_seen_at = ? WHERE token = ?`)
    .bind(now, token)
    .run();
}
