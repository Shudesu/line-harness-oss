import { describe, expect, it, vi } from 'vitest';
import {
  classifyWebhookFriendManagement,
  coexistenceAudienceCondition,
  markFriendAsHarnessManaged,
  type LineCoexistencePolicy,
} from './line-coexistence.js';

const policy: LineCoexistencePolicy = {
  line_account_id: 'account-1',
  harness_tag_id: 'tag-harness',
  lstep_tag_id: 'tag-lstep',
  cutover_at: '2026-08-23T00:00:00.000Z',
  is_active: 1,
};

function fakeDb(existingTagId: string | null = null) {
  const batches: Array<Array<{ sql: string; binds: unknown[] }>> = [];
  const runs: Array<{ sql: string; binds: unknown[] }> = [];

  function statement(sql: string) {
    const state = { sql, binds: [] as unknown[] };
    return {
      ...state,
      bind(...binds: unknown[]) {
        state.binds = binds;
        return this;
      },
      async first<T>(): Promise<T | null> {
        if (sql.includes('FROM line_coexistence_policies')) return policy as T;
        if (sql.includes('FROM friend_tags')) {
          return existingTagId ? ({ tag_id: existingTagId } as T) : null;
        }
        if (sql.includes('FROM line_accounts')) return { id: policy.line_account_id } as T;
        return null;
      },
      async run() {
        runs.push({ sql, binds: state.binds });
        return { meta: { changes: 1 } };
      },
      snapshot() {
        return { sql, binds: state.binds };
      },
    };
  }

  const db = {
    prepare: vi.fn((sql: string) => statement(sql)),
    batch: vi.fn(async (items: Array<ReturnType<typeof statement>>) => {
      batches.push(items.map((item) => item.snapshot()));
      return items.map(() => ({ meta: { changes: 1 } }));
    }),
  } as unknown as D1Database;

  return { db, batches, runs };
}

describe('LINE / L-Step coexistence classification', () => {
  it('classifies a new post-cutover follow as L Harness managed', async () => {
    const { db, batches } = fakeDb();
    const owner = await classifyWebhookFriendManagement(db, {
      friendId: 'friend-1',
      lineAccountId: 'account-1',
      origin: 'follow',
      eventTimestamp: Date.parse('2026-08-23T00:00:01.000Z'),
    });

    expect(owner).toBe('harness');
    expect(batches).toHaveLength(1);
    expect(batches[0][2].binds).toContain('tag-harness');
  });

  it('classifies an untagged message-only user as legacy L-Step managed', async () => {
    const { db, batches } = fakeDb();
    const owner = await classifyWebhookFriendManagement(db, {
      friendId: 'friend-1',
      lineAccountId: 'account-1',
      origin: 'message',
      eventTimestamp: Date.parse('2026-08-23T00:00:01.000Z'),
    });

    expect(owner).toBe('lstep');
    expect(batches[0][2].binds).toContain('tag-lstep');
  });

  it('preserves an explicit L-Step owner tag even on a later follow', async () => {
    const { db, batches, runs } = fakeDb('tag-lstep');
    const owner = await classifyWebhookFriendManagement(db, {
      friendId: 'friend-1',
      lineAccountId: 'account-1',
      origin: 'follow',
      eventTimestamp: Date.parse('2026-08-24T00:00:00.000Z'),
    });

    expect(owner).toBe('lstep');
    expect(batches).toHaveLength(0);
    expect(runs.some((run) => run.sql.includes('line_account_id IS NULL'))).toBe(true);
  });

  it('moves a legacy user to L Harness after verified LIFF/ref attribution', async () => {
    const { db, batches } = fakeDb('tag-lstep');
    const changed = await markFriendAsHarnessManaged(db, {
      friendId: 'friend-1',
      lineAccountId: 'account-1',
    });

    expect(changed).toBe(true);
    expect(batches[0][1].binds).toContain('tag-lstep');
    expect(batches[0][2].binds).toContain('tag-harness');
  });

  it('builds a mandatory include-Harness/exclude-L-Step broadcast condition', () => {
    expect(coexistenceAudienceCondition(policy, 'campaign-tag')).toEqual({
      operator: 'AND',
      rules: [
        { type: 'is_following', value: true },
        { type: 'tag_exists', value: 'tag-harness' },
        { type: 'tag_not_exists', value: 'tag-lstep' },
        { type: 'tag_exists', value: 'campaign-tag' },
      ],
    });
  });
});
