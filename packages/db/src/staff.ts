import { jstNow } from './utils.js';

export type StaffApiScope = 'messages:read' | 'messages:send';

export function isStaffApiScopes(value: unknown): value is StaffApiScope[] | null {
  return value === null || (Array.isArray(value) && value.every(
    (scope) => scope === 'messages:read' || scope === 'messages:send',
  ));
}

/** NULL is a legacy staff key; invalid stored restrictions deny all access. */
export function parseStaffApiScopes(value: string | null | undefined): StaffApiScope[] | null {
  if (value == null) return null;
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) && isStaffApiScopes(parsed) ? parsed : [];
  } catch { return []; }
}

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  /** @deprecated Storage placeholder after migration; never expose to clients. */
  api_key: string;
  api_key_hash?: string | null;
  api_key_last4?: string | null;
  api_key_created_at?: string | null;
  api_scopes?: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStaffInput {
  apiScopes?: StaffApiScope[] | null;
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff';
}

export interface UpdateStaffInput {
  apiScopes?: StaffApiScope[] | null;
  name?: string;
  email?: string | null;
  role?: 'owner' | 'admin' | 'staff';
  is_active?: number;
}

function generateApiKey(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes).map(b => b.toString(16).padStart(2, '0')).join('');
  return `lh_${hex}`;
}

export async function hashApiKey(key: string): Promise<string> {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)));
  return Array.from(digest, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** A late write from the pre-migration Worker may replace plaintext without
 * updating the digest. Treat that stored plaintext as the latest credential. */
export async function staffCredentialFingerprint(staff: StaffMember): Promise<string | null> {
  if (staff.api_key === `hashed:${staff.id}`) return staff.api_key_hash ?? null;
  if (!staff.api_key || staff.api_key.startsWith('hashed:')) return null;
  return hashApiKey(staff.api_key);
}

/** Indexed digest lookup, with compare-and-swap upgrade of legacy credentials.
 * Never accept a storage placeholder or fall back on a schema/storage error. */
export async function getStaffByApiKey(db: D1Database, apiKey: string): Promise<StaffMember | null> {
  if (!apiKey || apiKey.length > 4096 || apiKey.startsWith('hashed:')) return null;
  const digest = await hashApiKey(apiKey);
  const found = await db.prepare('SELECT * FROM staff_members WHERE api_key_hash = ? AND is_active = 1')
    .bind(digest).first<StaffMember>();
  if (found && found.api_key === `hashed:${found.id}`) return found;
  const legacy = await db.prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey).first<StaffMember>();
  if (!legacy) return null;
  return db.prepare(`UPDATE staff_members SET api_key_hash = ?, api_key_last4 = ?, api_key = ?
    WHERE id = ? AND api_key = ? AND api_key_hash IS ? AND is_active = 1 RETURNING *`)
    .bind(digest, apiKey.slice(-4), `hashed:${legacy.id}`, legacy.id, apiKey, legacy.api_key_hash ?? null).first<StaffMember>();
}

/** One bounded scan of the pending-only index; no COUNT/full-table sweep. */
export async function backfillStaffApiKeyHashes(db: D1Database, options: { limit?: number } = {}): Promise<number> {
  const requested = Number.isFinite(options.limit) ? options.limit! : 25;
  const limit = Math.max(1, Math.min(25, Math.floor(requested)));
  const rows = await db.prepare("SELECT id, api_key, api_key_hash FROM staff_members INDEXED BY idx_staff_members_plaintext WHERE api_key NOT GLOB 'hashed:*' ORDER BY id LIMIT ?")
    .bind(limit).all<Pick<StaffMember, 'id' | 'api_key' | 'api_key_hash'>>();
  let migrated = 0;
  for (const row of rows.results) {
    const digest = await hashApiKey(row.api_key);
    const result = await db.prepare(
      'UPDATE staff_members SET api_key_hash = ?, api_key_last4 = ?, api_key = ? WHERE id = ? AND api_key = ? AND api_key_hash IS ?',
    ).bind(digest, row.api_key.slice(-4), `hashed:${row.id}`, row.id, row.api_key, row.api_key_hash ?? null).run();
    migrated += result.meta.changes;
  }
  return migrated;
}

export async function getStaffMembers(db: D1Database): Promise<StaffMember[]> {
  const result = await db
    .prepare('SELECT * FROM staff_members ORDER BY created_at ASC')
    .all<StaffMember>();
  return result.results;
}

export async function getStaffById(
  db: D1Database,
  id: string,
): Promise<StaffMember | null> {
  return db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>();
}

export async function createStaffMember(
  db: D1Database,
  input: CreateStaffInput,
): Promise<{ member: StaffMember; apiKey: string }> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();

  await db
    .prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, api_key_hash, api_key_last4, api_key_created_at, api_scopes, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.name, input.email ?? null, input.role, `hashed:${id}`, await hashApiKey(apiKey), apiKey.slice(-4), now, input.apiScopes == null ? null : JSON.stringify(input.apiScopes), now, now)
    .run();

  const member = (await getStaffById(db, id))!;
  return { member, apiKey };
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

  if (input.apiScopes !== undefined) { sets.push('api_scopes = ?'); values.push(input.apiScopes === null ? null : JSON.stringify(input.apiScopes)); }
  if (input.name !== undefined) { sets.push('name = ?'); values.push(input.name); }
  if (input.email !== undefined) { sets.push('email = ?'); values.push(input.email ?? null); }
  if (input.role !== undefined) { sets.push('role = ?'); values.push(input.role); }
  if (input.is_active !== undefined) { sets.push('is_active = ?'); values.push(input.is_active); }

  values.push(id);
  await db
    .prepare(`UPDATE staff_members SET ${sets.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return db.prepare('SELECT * FROM staff_members WHERE id = ?').bind(id).first<StaffMember>();
}

export async function deleteStaffMember(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM staff_members WHERE id = ?').bind(id).run();
}

export async function regenerateStaffApiKey(db: D1Database, id: string): Promise<string> {
  const newKey = generateApiKey();
  const now = jstNow();
  const result = await db
    .prepare('UPDATE staff_members SET api_key = ?, api_key_hash = ?, api_key_last4 = ?, api_key_created_at = ?, updated_at = ? WHERE id = ?')
    .bind(`hashed:${id}`, await hashApiKey(newKey), newKey.slice(-4), now, now, id)
    .run();
  if (result.meta.changes === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return newKey;
}

export async function countStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ?')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}

export async function countActiveStaffByRole(db: D1Database, role: string): Promise<number> {
  const result = await db
    .prepare('SELECT COUNT(*) as count FROM staff_members WHERE role = ? AND is_active = 1')
    .bind(role)
    .first<{ count: number }>();
  return result?.count ?? 0;
}
