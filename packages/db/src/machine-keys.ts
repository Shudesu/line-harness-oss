import { hashApiKey } from './staff';
export const MACHINE_SCOPES = ['read', 'write', 'send', 'admin'] as const;
export type MachineScope = (typeof MACHINE_SCOPES)[number];
export interface MachineKey {
  id: string;
  name: string;
  key_hash: string;
  key_last4: string;
  scopes: string;
  created_by_staff_id: string | null;
  created_at: number;
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
}
export function parseMachineScopes(value: unknown): MachineScope[] | null {
  try {
    const raw = typeof value === 'string' ? JSON.parse(value) : value;
    return Array.isArray(raw) &&
      raw.length > 0 &&
      raw.every((s) => MACHINE_SCOPES.includes(s))
      ? ([...new Set(raw)] as MachineScope[])
      : null;
  } catch {
    return null;
  }
}
export function publicMachineKey(row: MachineKey) {
  const { key_hash, ...rest } = row;
  return { ...rest, scopes: parseMachineScopes(row.scopes) ?? [] };
}
export async function createMachineKey(
  db: D1Database,
  input: {
    name: string;
    scopes: MachineScope[];
    createdBy: string | null;
    expiresAt: number | null;
  },
  now = Math.floor(Date.now() / 1000),
) {
  const scopes = parseMachineScopes(input.scopes);
  if (
    !scopes ||
    !input.name.trim() ||
    input.name.length > 100 ||
    (input.expiresAt !== null &&
      (!Number.isSafeInteger(input.expiresAt) || input.expiresAt <= now))
  )
    throw new Error('Invalid machine key');
  const token =
    'lhk_' +
    btoa(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(32))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const row: MachineKey = {
    id: crypto.randomUUID(),
    name: input.name.trim(),
    key_hash: await hashApiKey(token),
    key_last4: token.slice(-4),
    scopes: JSON.stringify(scopes),
    created_by_staff_id: input.createdBy,
    created_at: now,
    last_used_at: null,
    expires_at: input.expiresAt,
    revoked_at: null,
  };
  await db
    .prepare(
      'INSERT INTO machine_keys(id,name,key_hash,key_last4,scopes,created_by_staff_id,created_at,expires_at) VALUES(?,?,?,?,?,?,?,?)',
    )
    .bind(
      row.id,
      row.name,
      row.key_hash,
      row.key_last4,
      row.scopes,
      row.created_by_staff_id,
      now,
      row.expires_at,
    )
    .run();
  return { key: publicMachineKey(row), token };
}
export async function authenticateMachineKey(
  db: D1Database,
  token: string,
  now = Math.floor(Date.now() / 1000),
): Promise<MachineKey | null> {
  if (!/^lhk_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const row = await db
    .prepare(
      'SELECT * FROM machine_keys WHERE key_hash=? AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at>?)',
    )
    .bind(await hashApiKey(token), now)
    .first<MachineKey>();
  if (!row || !parseMachineScopes(row.scopes)) return null;
  if (row.last_used_at === null || row.last_used_at <= now - 300) {
    try {
      await db
        .prepare(
          'UPDATE machine_keys SET last_used_at=? WHERE id=? AND (last_used_at IS NULL OR last_used_at<=?) AND revoked_at IS NULL',
        )
        .bind(now, row.id, now - 300)
        .run();
    } catch {
      /* metadata only */
    }
  }
  return row;
}
export async function listMachineKeys(db: D1Database, limit = 50, offset = 0) {
  const result = await db
    .prepare(
      'SELECT * FROM machine_keys ORDER BY created_at DESC,id LIMIT ? OFFSET ?',
    )
    .bind(
      Math.max(1, Math.min(100, Math.floor(limit))),
      Math.max(0, Math.min(10000, Math.floor(offset))),
    )
    .all<MachineKey>();
  return result.results.map(publicMachineKey);
}
export async function revokeMachineKey(
  db: D1Database,
  id: string,
  now = Math.floor(Date.now() / 1000),
) {
  await db
    .prepare(
      'UPDATE machine_keys SET revoked_at=? WHERE id=? AND revoked_at IS NULL',
    )
    .bind(now, id)
    .run();
}
