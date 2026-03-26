import { jstNow } from './utils.js';

// ============================================================
// User Profiles & Documents
// ============================================================

export interface UserProfileRow {
  id: string;
  friend_id: string;
  real_name: string;
  real_name_kana: string | null;
  phone: string | null;
  qualification_type: string | null;
  date_of_birth: string | null;
  gender: string | null;
  allergies_medical: string | null;
  experience_years: string | null;
  bacterial_test_status: string | null;
  health_notes: string | null;
  terms_agreed_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface UserDocumentRow {
  id: string;
  friend_id: string;
  doc_type: string;
  r2_key: string;
  file_name: string | null;
  status: string;
  created_at: string;
}

export interface FavoriteNurseryRow {
  id: string;
  friend_id: string;
  nursery_name: string;
  created_at: string;
}

// --- Profile ---

export async function getProfileByFriendId(
  db: D1Database,
  friendId: string,
): Promise<UserProfileRow | null> {
  return db
    .prepare('SELECT * FROM user_profiles WHERE friend_id = ?')
    .bind(friendId)
    .first<UserProfileRow>();
}

export async function createProfile(
  db: D1Database,
  input: {
    friendId: string;
    realName: string;
    realNameKana?: string;
    phone?: string;
    qualificationType?: string;
    dateOfBirth?: string;
    gender?: string;
    allergiesMedical?: string;
    experienceYears?: string;
    bacterialTestStatus?: string;
    healthNotes?: string;
    termsAgreedAt?: string;
  },
): Promise<UserProfileRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO user_profiles (id, friend_id, real_name, real_name_kana, phone, qualification_type, date_of_birth, gender, allergies_medical, experience_years, bacterial_test_status, health_notes, terms_agreed_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.friendId,
      input.realName,
      input.realNameKana ?? null,
      input.phone ?? null,
      input.qualificationType ?? null,
      input.dateOfBirth ?? null,
      input.gender ?? null,
      input.allergiesMedical ?? null,
      input.experienceYears ?? null,
      input.bacterialTestStatus ?? null,
      input.healthNotes ?? null,
      input.termsAgreedAt ?? null,
      now,
      now,
    )
    .run();
  return (await db.prepare('SELECT * FROM user_profiles WHERE id = ?').bind(id).first<UserProfileRow>())!;
}

export async function updateProfile(
  db: D1Database,
  friendId: string,
  input: {
    realName?: string;
    realNameKana?: string;
    phone?: string;
    qualificationType?: string;
    dateOfBirth?: string;
    gender?: string;
    allergiesMedical?: string;
    experienceYears?: string;
    bacterialTestStatus?: string;
    healthNotes?: string;
    termsAgreedAt?: string;
  },
): Promise<UserProfileRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (input.realName !== undefined) { sets.push('real_name = ?'); binds.push(input.realName); }
  if (input.realNameKana !== undefined) { sets.push('real_name_kana = ?'); binds.push(input.realNameKana); }
  if (input.phone !== undefined) { sets.push('phone = ?'); binds.push(input.phone); }
  if (input.qualificationType !== undefined) { sets.push('qualification_type = ?'); binds.push(input.qualificationType); }
  if (input.dateOfBirth !== undefined) { sets.push('date_of_birth = ?'); binds.push(input.dateOfBirth); }
  if (input.gender !== undefined) { sets.push('gender = ?'); binds.push(input.gender); }
  if (input.allergiesMedical !== undefined) { sets.push('allergies_medical = ?'); binds.push(input.allergiesMedical); }
  if (input.experienceYears !== undefined) { sets.push('experience_years = ?'); binds.push(input.experienceYears); }
  if (input.bacterialTestStatus !== undefined) { sets.push('bacterial_test_status = ?'); binds.push(input.bacterialTestStatus); }
  if (input.healthNotes !== undefined) { sets.push('health_notes = ?'); binds.push(input.healthNotes); }
  if (input.termsAgreedAt !== undefined) { sets.push('terms_agreed_at = ?'); binds.push(input.termsAgreedAt); }

  if (sets.length === 0) return getProfileByFriendId(db, friendId);

  sets.push('updated_at = ?');
  binds.push(jstNow());
  binds.push(friendId);

  await db.prepare(`UPDATE user_profiles SET ${sets.join(', ')} WHERE friend_id = ?`).bind(...binds).run();
  return getProfileByFriendId(db, friendId);
}

// --- Documents ---

export async function getDocumentsByFriendId(
  db: D1Database,
  friendId: string,
): Promise<UserDocumentRow[]> {
  const result = await db
    .prepare('SELECT * FROM user_documents WHERE friend_id = ? ORDER BY created_at DESC')
    .bind(friendId)
    .all<UserDocumentRow>();
  return result.results;
}

export async function createDocument(
  db: D1Database,
  input: {
    friendId: string;
    docType: string;
    r2Key: string;
    fileName?: string;
  },
): Promise<UserDocumentRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT INTO user_documents (id, friend_id, doc_type, r2_key, file_name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
    )
    .bind(id, input.friendId, input.docType, input.r2Key, input.fileName ?? null, jstNow())
    .run();
  return (await db.prepare('SELECT * FROM user_documents WHERE id = ?').bind(id).first<UserDocumentRow>())!;
}

export async function updateDocumentStatus(
  db: D1Database,
  docId: string,
  status: 'pending' | 'verified' | 'rejected',
): Promise<UserDocumentRow | null> {
  await db
    .prepare('UPDATE user_documents SET status = ? WHERE id = ?')
    .bind(status, docId)
    .run();
  return db.prepare('SELECT * FROM user_documents WHERE id = ?').bind(docId).first<UserDocumentRow>();
}

export async function getAllPendingDocuments(
  db: D1Database,
): Promise<(UserDocumentRow & { display_name: string; real_name: string | null })[]> {
  const result = await db
    .prepare(
      `SELECT ud.*, f.display_name, up.real_name
       FROM user_documents ud
       JOIN friends f ON f.id = ud.friend_id
       LEFT JOIN user_profiles up ON up.friend_id = ud.friend_id
       ORDER BY CASE ud.status WHEN 'pending' THEN 0 WHEN 'verified' THEN 1 ELSE 2 END, ud.created_at DESC`,
    )
    .all<UserDocumentRow & { display_name: string; real_name: string | null }>();
  return result.results;
}

// --- Favorites ---

export async function getFavoritesByFriendId(
  db: D1Database,
  friendId: string,
): Promise<FavoriteNurseryRow[]> {
  const result = await db
    .prepare('SELECT * FROM favorite_nurseries WHERE friend_id = ? ORDER BY created_at DESC')
    .bind(friendId)
    .all<FavoriteNurseryRow>();
  return result.results;
}

export async function addFavoriteNursery(
  db: D1Database,
  friendId: string,
  nurseryName: string,
): Promise<FavoriteNurseryRow> {
  const id = crypto.randomUUID();
  await db
    .prepare(
      `INSERT OR IGNORE INTO favorite_nurseries (id, friend_id, nursery_name, created_at)
       VALUES (?, ?, ?, ?)`,
    )
    .bind(id, friendId, nurseryName, jstNow())
    .run();
  return (await db
    .prepare('SELECT * FROM favorite_nurseries WHERE friend_id = ? AND nursery_name = ?')
    .bind(friendId, nurseryName)
    .first<FavoriteNurseryRow>())!;
}

export async function removeFavoriteNursery(
  db: D1Database,
  friendId: string,
  nurseryName: string,
): Promise<void> {
  await db
    .prepare('DELETE FROM favorite_nurseries WHERE friend_id = ? AND nursery_name = ?')
    .bind(friendId, nurseryName)
    .run();
}
