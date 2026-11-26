import { URL } from 'node:url';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { sqliteD1 } from './sqlite-d1.js';

export const TEST_SESSION = 'lhs_' + 'A'.repeat(43);
/** Synthetic SQLite-backed D1 fixture; no network or credentials. */
export function authDb() {
  const result = sqliteD1();
  result.sqlite.exec(readFileSync(new URL('../../../../packages/db/migrations/011_staff_members.sql', import.meta.url), 'utf8'));
  result.sqlite.exec(readFileSync(new URL('../../../../packages/db/migrations/074_security_hardening.sql', import.meta.url), 'utf8'));
  return result;
}
export function seedAuthStaff(sql: ReturnType<typeof authDb>['sqlite'], input = {id:'staff-1',name:'Staff One',role:'admin',key:'staff-key'}, token = TEST_SESSION) {
  const hash = (s: string) => createHash('sha256').update(s).digest('hex');
  sql.prepare('INSERT INTO staff_members (id,name,role,api_key,api_key_hash) VALUES (?,?,?,?,?)')
    .run(input.id,input.name,input.role,`hashed:${input.id}`,hash(input.key));
  const now = Math.floor(Date.now()/1000);
  sql.prepare(`INSERT INTO admin_sessions (id_hash,staff_id,credential_fp,role_at_issue,auth_method,created_at,last_seen_at,expires_at)
    VALUES (?,?,?,?,?,?,?,?)`).run(hash(token),input.id,hash(input.key),input.role,'api_key',now,now,now+604800);
}
