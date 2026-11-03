import { jstNow } from './utils.js';

export interface StaffMember {
  id: string;
  name: string;
  email: string | null;
  role: 'owner' | 'admin' | 'staff';
  api_key: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface CreateStaffInput {
  name: string;
  email?: string | null;
  role: 'owner' | 'admin' | 'staff';
}

export interface UpdateStaffInput {
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

/**
 * Staff can replace their generated key with a password of their own. The
 * password is never stored: api_key holds `pw:` + SHA-256(password), so the
 * existing UNIQUE api_key column keeps working for lookup and the owner's
 * "regenerate key" resets it back to a random key.
 */
export const STAFF_PASSWORD_PREFIX = 'pw:';

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest)).map(b => b.toString(16).padStart(2, '0')).join('');
}

export async function staffPasswordKey(password: string): Promise<string> {
  return `${STAFF_PASSWORD_PREFIX}${await sha256Hex(password)}`;
}

export async function getStaffByApiKey(
  db: D1Database,
  apiKey: string,
): Promise<StaffMember | null> {
  // A stored password hash is not itself a credential.
  if (apiKey.startsWith(STAFF_PASSWORD_PREFIX)) return null;
  const byKey = await db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(apiKey)
    .first<StaffMember>();
  if (byKey) return byKey;
  return db
    .prepare('SELECT * FROM staff_members WHERE api_key = ? AND is_active = 1')
    .bind(await staffPasswordKey(apiKey))
    .first<StaffMember>();
}

/** Returns false when another staff member already uses the same password. */
export async function setStaffPassword(
  db: D1Database,
  id: string,
  password: string,
): Promise<boolean> {
  const key = await staffPasswordKey(password);
  const taken = await db
    .prepare('SELECT id FROM staff_members WHERE api_key = ? AND id != ?')
    .bind(key, id)
    .first<{ id: string }>();
  if (taken) return false;
  const result = await db
    .prepare('UPDATE staff_members SET api_key = ?, updated_at = ? WHERE id = ?')
    .bind(key, jstNow(), id)
    .run();
  if (result.meta.changes === 0) {
    throw new Error(`Staff member not found: ${id}`);
  }
  return true;
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
): Promise<StaffMember> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const apiKey = generateApiKey();

  await db
    .prepare(
      `INSERT INTO staff_members (id, name, email, role, api_key, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
    )
    .bind(id, input.name, input.email ?? null, input.role, apiKey, now, now)
    .run();

  return (await db
    .prepare('SELECT * FROM staff_members WHERE id = ?')
    .bind(id)
    .first<StaffMember>())!;
}

export async function updateStaffMember(
  db: D1Database,
  id: string,
  input: UpdateStaffInput,
): Promise<StaffMember | null> {
  const now = jstNow();
  const sets: string[] = ['updated_at = ?'];
  const values: (string | number | null)[] = [now];

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
    .prepare('UPDATE staff_members SET api_key = ?, updated_at = ? WHERE id = ?')
    .bind(newKey, now, id)
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
