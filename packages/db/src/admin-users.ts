export interface AdminUser {
  id: string;
  email: string;
  password_hash: string;
  created_at: string;
}

export async function getAdminUserByEmail(
  db: D1Database,
  email: string,
): Promise<AdminUser | null> {
  return db
    .prepare('SELECT * FROM admin_users WHERE lower(email) = lower(?)')
    .bind(email)
    .first<AdminUser>();
}
