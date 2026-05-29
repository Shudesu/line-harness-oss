import { jstNow } from './utils.js';

export interface ExternalCustomerProfile {
  id: string;
  source: string;
  external_id: string | null;
  name: string | null;
  phone: string | null;
  email: string | null;
  metadata: string;
  created_at: string;
  updated_at: string;
}

export interface FriendExternalCustomerLink {
  id: string;
  friend_id: string;
  external_customer_id: string;
  link_method: 'manual' | 'phone' | 'email' | 'import';
  confidence: number;
  created_at: string;
}

export interface CustomerNote {
  id: string;
  friend_id: string | null;
  external_customer_id: string | null;
  note: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface UpsertExternalCustomerInput {
  source: string;
  externalId?: string | null;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  metadata?: Record<string, unknown> | string | null;
}

export interface SearchExternalCustomersOptions {
  query?: string | null;
  source?: string | null;
  limit?: number;
}

const externalCustomerSchemaReady = new WeakSet<D1Database>();

function nullableText(value?: string | null): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizePhone(value?: string | null): string | null {
  const normalized = nullableText(value)?.replace(/[^\d+]/g, '');
  return normalized || null;
}

export function normalizeEmail(value?: string | null): string | null {
  return nullableText(value)?.toLowerCase() ?? null;
}

function metadataText(value?: Record<string, unknown> | string | null): string {
  if (!value) return '{}';
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || '{}';
  }
  return JSON.stringify(value);
}

export async function ensureExternalCustomerSchema(db: D1Database): Promise<void> {
  if (externalCustomerSchemaReady.has(db)) return;
  await db.batch([
    db.prepare(
      `CREATE TABLE IF NOT EXISTS external_customer_profiles (
        id TEXT PRIMARY KEY,
        source TEXT NOT NULL,
        external_id TEXT,
        name TEXT,
        phone TEXT,
        email TEXT,
        metadata TEXT NOT NULL DEFAULT '{}',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_external_customer_profiles_source_external
       ON external_customer_profiles(source, external_id)
       WHERE external_id IS NOT NULL`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_external_customer_profiles_phone ON external_customer_profiles(phone)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_external_customer_profiles_email ON external_customer_profiles(email)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_external_customer_profiles_name ON external_customer_profiles(name)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS friend_external_customer_links (
        id TEXT PRIMARY KEY,
        friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE,
        external_customer_id TEXT NOT NULL REFERENCES external_customer_profiles(id) ON DELETE CASCADE,
        link_method TEXT NOT NULL CHECK (link_method IN ('manual', 'phone', 'email', 'import')),
        confidence INTEGER NOT NULL DEFAULT 100,
        created_at TEXT NOT NULL,
        UNIQUE(friend_id, external_customer_id)
      )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_friend_external_customer_links_friend ON friend_external_customer_links(friend_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_friend_external_customer_links_customer ON friend_external_customer_links(external_customer_id)`),
    db.prepare(
      `CREATE TABLE IF NOT EXISTS customer_notes (
        id TEXT PRIMARY KEY,
        friend_id TEXT REFERENCES friends(id) ON DELETE CASCADE,
        external_customer_id TEXT REFERENCES external_customer_profiles(id) ON DELETE CASCADE,
        note TEXT NOT NULL,
        created_by TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_notes_friend ON customer_notes(friend_id)`),
    db.prepare(`CREATE INDEX IF NOT EXISTS idx_customer_notes_external_customer ON customer_notes(external_customer_id)`),
  ]);
  externalCustomerSchemaReady.add(db);
}

export function resetExternalCustomerSchemaCacheForTest(db?: D1Database): void {
  if (!db) return;
  externalCustomerSchemaReady.delete(db);
}

export async function upsertExternalCustomerProfile(
  db: D1Database,
  input: UpsertExternalCustomerInput,
): Promise<ExternalCustomerProfile> {
  await ensureExternalCustomerSchema(db);
  const source = nullableText(input.source);
  if (!source) throw new Error('source is required');

  const externalId = nullableText(input.externalId);
  const phone = normalizePhone(input.phone);
  const email = normalizeEmail(input.email);
  const name = nullableText(input.name);
  const metadata = metadataText(input.metadata);
  const now = jstNow();

  if (externalId) {
    const existing = await db
      .prepare(`SELECT * FROM external_customer_profiles WHERE source = ? AND external_id = ?`)
      .bind(source, externalId)
      .first<ExternalCustomerProfile>();

    if (existing) {
      await db
        .prepare(
          `UPDATE external_customer_profiles
           SET name = COALESCE(?, name),
               phone = COALESCE(?, phone),
               email = COALESCE(?, email),
               metadata = ?,
               updated_at = ?
           WHERE id = ?`,
        )
        .bind(name, phone, email, metadata, now, existing.id)
        .run();
      return (await getExternalCustomerProfileById(db, existing.id))!;
    }
  }

  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO external_customer_profiles
       (id, source, external_id, name, phone, email, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, source, externalId, name, phone, email, metadata, now, now)
    .run();

  return (await getExternalCustomerProfileById(db, id))!;
}

export async function getExternalCustomerProfileById(
  db: D1Database,
  id: string,
): Promise<ExternalCustomerProfile | null> {
  await ensureExternalCustomerSchema(db);
  return db
    .prepare(`SELECT * FROM external_customer_profiles WHERE id = ?`)
    .bind(id)
    .first<ExternalCustomerProfile>();
}

export async function searchExternalCustomerProfiles(
  db: D1Database,
  options: SearchExternalCustomersOptions = {},
): Promise<ExternalCustomerProfile[]> {
  await ensureExternalCustomerSchema(db);
  const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
  const conditions: string[] = [];
  const binds: unknown[] = [];
  const source = nullableText(options.source);
  const query = nullableText(options.query);

  if (source) {
    conditions.push('source = ?');
    binds.push(source);
  }

  if (query) {
    const phone = normalizePhone(query);
    const email = normalizeEmail(query);
    conditions.push('(name LIKE ? OR phone LIKE ? OR email LIKE ?)');
    binds.push(`%${query}%`, phone ? `%${phone}%` : `%${query}%`, email ? `%${email}%` : `%${query}%`);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
  const result = await db
    .prepare(
      `SELECT * FROM external_customer_profiles
       ${where}
       ORDER BY updated_at DESC
       LIMIT ?`,
    )
    .bind(...binds, limit)
    .all<ExternalCustomerProfile>();
  return result.results ?? [];
}

export async function linkFriendToExternalCustomer(
  db: D1Database,
  input: {
    friendId: string;
    externalCustomerId: string;
    linkMethod?: FriendExternalCustomerLink['link_method'];
    confidence?: number;
  },
): Promise<FriendExternalCustomerLink> {
  await ensureExternalCustomerSchema(db);
  const existing = await db
    .prepare(
      `SELECT * FROM friend_external_customer_links
       WHERE friend_id = ? AND external_customer_id = ?`,
    )
    .bind(input.friendId, input.externalCustomerId)
    .first<FriendExternalCustomerLink>();
  if (existing) return existing;

  const id = crypto.randomUUID();
  const confidence = Math.min(Math.max(Math.floor(input.confidence ?? 100), 0), 100);
  await db
    .prepare(
      `INSERT INTO friend_external_customer_links
       (id, friend_id, external_customer_id, link_method, confidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.friendId, input.externalCustomerId, input.linkMethod ?? 'manual', confidence, jstNow())
    .run();

  return (await db
    .prepare(`SELECT * FROM friend_external_customer_links WHERE id = ?`)
    .bind(id)
    .first<FriendExternalCustomerLink>())!;
}

export async function listExternalCustomerLinksForFriend(
  db: D1Database,
  friendId: string,
): Promise<Array<FriendExternalCustomerLink & { customer: ExternalCustomerProfile }>> {
  await ensureExternalCustomerSchema(db);
  const result = await db
    .prepare(
      `SELECT
         l.*,
         c.source AS customer_source,
         c.external_id AS customer_external_id,
         c.name AS customer_name,
         c.phone AS customer_phone,
         c.email AS customer_email,
         c.metadata AS customer_metadata,
         c.created_at AS customer_created_at,
         c.updated_at AS customer_updated_at
       FROM friend_external_customer_links l
       INNER JOIN external_customer_profiles c ON c.id = l.external_customer_id
       WHERE l.friend_id = ?
       ORDER BY l.created_at DESC`,
    )
    .bind(friendId)
    .all<FriendExternalCustomerLink & {
      customer_source: string;
      customer_external_id: string | null;
      customer_name: string | null;
      customer_phone: string | null;
      customer_email: string | null;
      customer_metadata: string;
      customer_created_at: string;
      customer_updated_at: string;
    }>();

  return (result.results ?? []).map((row) => ({
    id: row.id,
    friend_id: row.friend_id,
    external_customer_id: row.external_customer_id,
    link_method: row.link_method,
    confidence: row.confidence,
    created_at: row.created_at,
    customer: {
      id: row.external_customer_id,
      source: row.customer_source,
      external_id: row.customer_external_id,
      name: row.customer_name,
      phone: row.customer_phone,
      email: row.customer_email,
      metadata: row.customer_metadata,
      created_at: row.customer_created_at,
      updated_at: row.customer_updated_at,
    },
  }));
}

export async function unlinkFriendFromExternalCustomer(
  db: D1Database,
  friendId: string,
  externalCustomerId: string,
): Promise<void> {
  await ensureExternalCustomerSchema(db);
  await db
    .prepare(
      `DELETE FROM friend_external_customer_links
       WHERE friend_id = ? AND external_customer_id = ?`,
    )
    .bind(friendId, externalCustomerId)
    .run();
}
