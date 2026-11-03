import { describe, expect, test, beforeEach } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  createStaffMember,
  getStaffByApiKey,
  regenerateStaffApiKey,
  setStaffPassword,
  staffPasswordKey,
} from '../src/staff.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const MIGRATION = join(__dirname, '..', 'migrations', '011_staff_members.sql');

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const stmt = sqlite.prepare(query);
          return {
            async run() {
              const info = stmt.run(...params);
              return { results: [], success: true, meta: { changes: info.changes } };
            },
            async first<T>() {
              return (stmt.get(...params) as T) ?? null;
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

let db: D1Database;
beforeEach(() => {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(MIGRATION, 'utf8'));
  db = asD1(sqlite);
});

describe('staff self-set password', () => {
  test('the new password logs in and the old key stops working', async () => {
    const member = await createStaffMember(db, { name: 'A', role: 'staff' });
    const oldKey = member.api_key;
    expect(await setStaffPassword(db, member.id, 'my-own-password')).toBe(true);

    expect((await getStaffByApiKey(db, 'my-own-password'))?.id).toBe(member.id);
    expect(await getStaffByApiKey(db, oldKey)).toBeNull();
  });

  test('the stored hash itself is not accepted as a credential', async () => {
    const member = await createStaffMember(db, { name: 'A', role: 'staff' });
    await setStaffPassword(db, member.id, 'my-own-password');
    expect(await getStaffByApiKey(db, await staffPasswordKey('my-own-password'))).toBeNull();
  });

  test('two staff cannot share the same password', async () => {
    const a = await createStaffMember(db, { name: 'A', role: 'staff' });
    const b = await createStaffMember(db, { name: 'B', role: 'staff' });
    expect(await setStaffPassword(db, a.id, 'shared-password')).toBe(true);
    expect(await setStaffPassword(db, b.id, 'shared-password')).toBe(false);
    expect((await getStaffByApiKey(db, 'shared-password'))?.id).toBe(a.id);
  });

  test('regenerating the key resets a self-set password', async () => {
    const member = await createStaffMember(db, { name: 'A', role: 'staff' });
    await setStaffPassword(db, member.id, 'my-own-password');
    const newKey = await regenerateStaffApiKey(db, member.id);
    expect(await getStaffByApiKey(db, 'my-own-password')).toBeNull();
    expect((await getStaffByApiKey(db, newKey))?.id).toBe(member.id);
  });
});
