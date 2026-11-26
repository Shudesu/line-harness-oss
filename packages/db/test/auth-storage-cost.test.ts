import { it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync } from 'node:fs';
import { getStaffByNormalizedEmail } from '../src/staff';
import {
  createWebauthnChallenge,
  getWebauthnChallenge,
  consumeWebauthnChallenge,
  purgeWebauthnChallenges,
} from '../src/passkeys';
import {
  createMagicLink,
  consumeMagicLink,
  purgeMagicLinks,
} from '../src/magic-links';
it.each([100, 10_000, 100_000])(
  'keeps identity/challenge/token access indexed with %i unrelated records',
  async (count) => {
    const sql = new Database(':memory:');
    sql.exec(
      readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'),
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
    const plans = () =>
      calls
        .map((call) =>
          (
            sql.prepare('EXPLAIN QUERY PLAN ' + call.q).all(...call.args) as {
              detail: string;
            }[]
          )
            .map((row) => row.detail)
            .join(' '),
        )
        .join('\n');
    try {
      const staff = sql.prepare(
        "INSERT INTO staff_members(id,name,role,api_key,email,is_active) VALUES(?,'Other','staff',?,?,1)",
      );
      const challenge = sql.prepare(
        "INSERT INTO admin_webauthn_challenges(id,challenge_hash,purpose,context_hash,expires_at) VALUES(?,'h','login','c',9999999999)",
      );
      const magic = sql.prepare(
        "INSERT INTO admin_magic_links(token_hash,staff_id,email,credential_fp,created_at,expires_at) VALUES(?,'s','e','f',0,9999999999)",
      );
      sql.transaction(() => {
        for (let i = 0; i < count; i++) {
          staff.run('s' + i, 'k' + i, 'u' + i + '@example.com');
          challenge.run('c' + i);
          magic.run('m' + i);
        }
      })();
      calls.length = 0;
      expect(
        await getStaffByNormalizedEmail(db, 'absent@example.com'),
      ).toHaveLength(0);
      expect(plans()).toContain('idx_staff_email_normalized');
      const id = await createWebauthnChallenge(
        db,
        'random',
        'login',
        null,
        'ctx',
      );
      calls.length = 0;
      expect(await getWebauthnChallenge(db, id, 'login', 'ctx')).not.toBeNull();
      expect(plans()).toContain('SEARCH admin_webauthn_challenges');
      expect(await consumeWebauthnChallenge(db, id)).toBe(true);
      expect(await consumeWebauthnChallenge(db, id)).toBe(false);
      const token = await createMagicLink(db, {
        staffId: 's',
        email: 'person@example.com',
        credentialFp: 'a'.repeat(64),
      });
      calls.length = 0;
      expect(await consumeMagicLink(db, token)).not.toBeNull();
      expect(plans()).toContain('SEARCH admin_magic_links');
      expect(await consumeMagicLink(db, token)).toBeNull();
      calls.length = 0;
      await purgeWebauthnChallenges(db, 1);
      await purgeMagicLinks(db, 1);
      expect(plans()).toContain('idx_webauthn_challenge_expiry');
      expect(plans()).toContain('idx_magic_link_expiry');
      expect(plans()).not.toMatch(
        /SCAN admin_(webauthn_challenges|magic_links)/,
      );
      sql.exec(
        'DROP INDEX idx_webauthn_challenge_expiry; DROP INDEX idx_magic_link_expiry',
      );
      expect(plans()).toMatch(/SCAN admin_(webauthn_challenges|magic_links)/);
    } finally {
      sql.close();
    }
  },
);
