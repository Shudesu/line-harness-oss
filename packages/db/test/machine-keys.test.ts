import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import {
  createMachineKey,
  authenticateMachineKey,
  listMachineKeys,
} from '../src/machine-keys';
it.each([100, 10_000, 100_000])(
  'uses bounded indexed machine key access with %i unrelated keys',
  async (count) => {
    const sql = new Database(':memory:');
    sql.exec(readFileSync(new URL('../migrations/011_staff_members.sql', import.meta.url), 'utf8'));
    sql.exec(
      readFileSync(
        new URL('../migrations/079_admin_security_keys_passkeys.sql', import.meta.url),
        'utf8',
      ),
    );
    const calls: { q: string; args: unknown[] }[] = [];
    const db = {
      prepare(q: string) {
        const call = { q, args: [] as unknown[] };
        calls.push(call);
        return {
          bind(...args: unknown[]) {
            call.args = args;
            return this;
          },
          async first() {
            return sql.prepare(q).get(...call.args) ?? null;
          },
          async all() {
            return { results: sql.prepare(q).all(...call.args) };
          },
          async run() {
            return {
              meta: { changes: sql.prepare(q).run(...call.args).changes },
            };
          },
        };
      },
    } as unknown as D1Database;
    try {
      const key = await createMachineKey(
        db,
        { name: 'MCP', scopes: ['read'], createdBy: null, expiresAt: null },
        1000,
      );
      const insert = sql.prepare(
        'INSERT INTO machine_keys(id,name,key_hash,key_last4,scopes,created_at) VALUES(?,?,?,?,?,0)',
      );
      sql.transaction(() => {
        for (let i = 0; i < count; i++)
          insert.run('other-' + i, 'other', 'hash-' + i, '1234', '["read"]');
      })();
      calls.length = 0;
      expect(await authenticateMachineKey(db, key.token, 1001)).not.toBeNull();
      expect(calls).toHaveLength(2);
      const lookup = sql
        .prepare('EXPLAIN QUERY PLAN ' + calls[0].q)
        .all(...calls[0].args) as { detail: string }[];
      expect(
        lookup.some((r) => /SEARCH machine_keys USING INDEX/.test(r.detail)),
      ).toBe(true);
      calls.length = 0;
      await authenticateMachineKey(db, key.token, 1299);
      expect(calls).toHaveLength(1);
      calls.length = 0;
      const list = await listMachineKeys(db, 1000);
      expect(list).toHaveLength(100);
      expect(JSON.stringify(list)).not.toContain('key_hash');
      const plan = sql
        .prepare('EXPLAIN QUERY PLAN ' + calls[0].q)
        .all(...calls[0].args) as { detail: string }[];
      expect(
        plan.some((r) => r.detail.includes('idx_machine_keys_created')),
      ).toBe(true);
      sql.exec('DROP INDEX idx_machine_keys_created');
      const bad = sql
        .prepare('EXPLAIN QUERY PLAN ' + calls[0].q)
        .all(...calls[0].args) as { detail: string }[];
      expect(bad.some((r) => r.detail.includes('TEMP B-TREE'))).toBe(true);
    } finally {
      sql.close();
    }
  },
);
