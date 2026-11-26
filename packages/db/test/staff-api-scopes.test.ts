import { afterEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { getStaffByApiKey, parseStaffApiScopes, hashApiKey } from '../src/staff';

const databases: Database.Database[] = [];
afterEach(() => databases.splice(0).forEach(db => db.close()));
function oldSchema() {
  const sql = new Database(':memory:'); databases.push(sql);
  sql.exec(readFileSync(new URL('../migrations/011_staff_members.sql', import.meta.url), 'utf8'));
  sql.prepare('INSERT INTO staff_members (id, name, role, api_key) VALUES (?, ?, ?, ?)').run('old', 'Old staff', 'staff', 'old-key');
  return sql;
}

describe('staff scope migration and lookup cost', () => {
  it('preserves existing keys and roles when adding nullable scopes', () => {
    const sql = oldSchema();
    sql.exec(readFileSync(new URL('../migrations/074_security_hardening.sql', import.meta.url), 'utf8'));
    expect(sql.prepare('SELECT role, api_key, api_scopes FROM staff_members WHERE id = ?').get('old')).toEqual({ role: 'staff', api_key: 'old-key', api_scopes: null });
    expect(parseStaffApiScopes(null)).toBeNull();
    for (const invalid of ['null', 'false', '{}', '["unknown"]', 'invalid']) expect(parseStaffApiScopes(invalid)).toEqual([]);
  });

  it.each([100, 10_000, 100_000])('uses one indexed authentication lookup with %i unrelated staff', async count => {
    const sql = oldSchema();
    sql.exec(readFileSync(new URL('../migrations/074_security_hardening.sql', import.meta.url), 'utf8'));
    sql.prepare('UPDATE staff_members SET api_key_hash = ?, api_key = ? WHERE id = ?').run(await hashApiKey('old-key'), 'hashed:old', 'old');
    sql.prepare('UPDATE staff_members SET api_scopes = ? WHERE id = ?').run('["messages:read"]', 'old');
    const insert = sql.prepare('INSERT INTO staff_members (id, name, role, api_key) VALUES (?, ?, ?, ?)');
    sql.transaction(() => { for (let i = 0; i < count; i++) insert.run(`id-${i}`, 'Unrelated', 'staff', `key-${i}`); })();
    const queries: string[] = [];
    const db = { prepare(query: string) {
      queries.push(query);
      return { bind(token: string) {
        return { async first() { return sql.prepare(query).get(token) ?? null; } };
      } };
    } } as unknown as D1Database;
    expect((await getStaffByApiKey(db, 'old-key'))?.api_scopes).toBe('["messages:read"]');
    expect(queries).toHaveLength(1);
    const plan = sql.prepare(`EXPLAIN QUERY PLAN ${queries[0]}`).all(await hashApiKey('old-key')) as { detail: string }[];
    expect(plan.some(row => /SEARCH staff_members USING INDEX .*api_key/.test(row.detail))).toBe(true);
    expect(plan.some(row => /SCAN staff_members/.test(row.detail))).toBe(false);
    // Negative control: disabling indexes must invalidate the same plan check.
    const unindexed = sql.prepare(`EXPLAIN QUERY PLAN ${queries[0].replace('FROM staff_members', 'FROM staff_members NOT INDEXED')}`).all(await hashApiKey('old-key')) as { detail: string }[];
    expect(unindexed.some(row => /SCAN staff_members/.test(row.detail))).toBe(true);
  });
});
