import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { buildMessage, evaluateCondition, isSupportedConditionType, SUPPORTED_CONDITION_TYPES, processStepDeliveries, expandVariables } from './step-delivery.js';
import type { LineClient } from '@line-crm/line-sdk';

/**
 * Regression coverage for OSS issue #120 — scenario step
 * conditionType/conditionValue must be evaluated at delivery time, and
 * unknown / malformed conditions must fail safe (skip step) rather than
 * silently treat them as "always pass" (which would over-deliver).
 */

interface FakeTables {
  friendTags?: Set<string>; // "friendId|tagId" entries
  friendMetadata?: Record<string, Record<string, unknown>>; // friendId → metadata
}

function mockDb(tables: FakeTables): D1Database {
  return {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => ({
        first: async <T = unknown>(): Promise<T | null> => {
          if (sql.includes('FROM friend_tags')) {
            const [friendId, tagId] = args as [string, string];
            return (tables.friendTags?.has(`${friendId}|${tagId}`) ? ({ 1: 1 } as unknown as T) : null);
          }
          if (sql.includes('FROM friends')) {
            const [friendId] = args as [string];
            const meta = tables.friendMetadata?.[friendId];
            if (meta === undefined) return null;
            return { metadata: JSON.stringify(meta) } as unknown as T;
          }
          return null;
        },
        all: async () => ({ results: [] }),
        run: async () => ({ meta: { changes: 0 } }),
      }),
    }),
  } as unknown as D1Database;
}

describe('isSupportedConditionType', () => {
  it('accepts each value in SUPPORTED_CONDITION_TYPES', () => {
    for (const t of SUPPORTED_CONDITION_TYPES) {
      expect(isSupportedConditionType(t)).toBe(true);
    }
  });

  it.each(['tag_not_has', 'TAG_EXISTS', '', null, undefined, 42])(
    'rejects unsupported value %j',
    (val) => {
      expect(isSupportedConditionType(val)).toBe(false);
    },
  );
});

describe('evaluateCondition', () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it('returns true when condition_type is null (no condition set)', async () => {
    const db = mockDb({});
    expect(await evaluateCondition(db, 'f1', { condition_type: null, condition_value: null })).toBe(true);
    expect(errorSpy).not.toHaveBeenCalled();
  });

  it('returns false (skip) when condition_type is set but condition_value is empty', async () => {
    // Fail-safe for malformed stored rows: a configured condition without a value
    // would otherwise bind '' into SQL and produce over-delivery (OSS #120 pattern).
    const db = mockDb({});
    expect(await evaluateCondition(db, 'f1', { condition_type: 'tag_exists', condition_value: '' })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  it('returns false (skip) when condition_type is set but condition_value is null', async () => {
    const db = mockDb({});
    expect(await evaluateCondition(db, 'f1', { condition_type: 'tag_not_exists', condition_value: null })).toBe(false);
    expect(errorSpy).toHaveBeenCalled();
  });

  describe('tag_exists', () => {
    it('returns true when the friend has the tag', async () => {
      const db = mockDb({ friendTags: new Set(['f1|tag-A']) });
      expect(await evaluateCondition(db, 'f1', { condition_type: 'tag_exists', condition_value: 'tag-A' })).toBe(true);
    });
    it('returns false when the friend does not have the tag', async () => {
      const db = mockDb({ friendTags: new Set() });
      expect(await evaluateCondition(db, 'f1', { condition_type: 'tag_exists', condition_value: 'tag-A' })).toBe(false);
    });
  });

  describe('tag_not_exists', () => {
    it('returns true when the friend does not have the tag', async () => {
      const db = mockDb({ friendTags: new Set() });
      expect(await evaluateCondition(db, 'f1', { condition_type: 'tag_not_exists', condition_value: 'tag-A' })).toBe(true);
    });
    it('returns false when the friend has the excluded tag', async () => {
      const db = mockDb({ friendTags: new Set(['f1|tag-A']) });
      expect(await evaluateCondition(db, 'f1', { condition_type: 'tag_not_exists', condition_value: 'tag-A' })).toBe(false);
    });
  });

  describe('metadata_equals', () => {
    it('returns true when the metadata matches', async () => {
      const db = mockDb({ friendMetadata: { f1: { purchased: 'true' } } });
      expect(
        await evaluateCondition(db, 'f1', {
          condition_type: 'metadata_equals',
          condition_value: JSON.stringify({ key: 'purchased', value: 'true' }),
        }),
      ).toBe(true);
    });
    it('returns false when the metadata key is absent', async () => {
      const db = mockDb({ friendMetadata: { f1: {} } });
      expect(
        await evaluateCondition(db, 'f1', {
          condition_type: 'metadata_equals',
          condition_value: JSON.stringify({ key: 'purchased', value: 'true' }),
        }),
      ).toBe(false);
    });
  });

  describe('metadata_not_equals', () => {
    it('returns false when the metadata equals the excluded value', async () => {
      const db = mockDb({ friendMetadata: { f1: { tier: 'gold' } } });
      expect(
        await evaluateCondition(db, 'f1', {
          condition_type: 'metadata_not_equals',
          condition_value: JSON.stringify({ key: 'tier', value: 'gold' }),
        }),
      ).toBe(false);
    });
    it('returns true when the metadata differs from the excluded value', async () => {
      const db = mockDb({ friendMetadata: { f1: { tier: 'silver' } } });
      expect(
        await evaluateCondition(db, 'f1', {
          condition_type: 'metadata_not_equals',
          condition_value: JSON.stringify({ key: 'tier', value: 'gold' }),
        }),
      ).toBe(true);
    });
  });

  describe('fail-safe semantics (OSS #120 regression)', () => {
    it('unknown condition_type → false (skip), NOT true (deliver)', async () => {
      // OSS issue #120: user passed condition_type='tag_not_has' (typo for tag_not_exists);
      // pre-fix behaviour was to fall through to default and return true → over-deliver to every
      // friend regardless of the configured filter. Lock in fail-safe = skip.
      const db = mockDb({ friendTags: new Set(['f1|tag-A']) });
      const result = await evaluateCondition(db, 'f1', {
        condition_type: 'tag_not_has',
        condition_value: 'tag-A',
      });
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('malformed condition_value JSON for metadata_equals → false (skip)', async () => {
      const db = mockDb({ friendMetadata: { f1: { tier: 'gold' } } });
      const result = await evaluateCondition(db, 'f1', {
        condition_type: 'metadata_equals',
        condition_value: '{this is not json',
      });
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('condition_value missing "key" → false (skip)', async () => {
      const db = mockDb({ friendMetadata: { f1: { tier: 'gold' } } });
      const result = await evaluateCondition(db, 'f1', {
        condition_type: 'metadata_equals',
        condition_value: JSON.stringify({ value: 'gold' }),
      });
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('condition_value missing "value" key → false (skip; would otherwise match undefined keys)', async () => {
      // Pre-existing rows could have {"key":"tier"} (no "value"). Without the explicit
      // 'value' in parsed check, metadata_equals compares actual === undefined and would
      // pass for every friend who lacks the key — recreating the OSS #120 over-delivery.
      const db = mockDb({ friendMetadata: { f1: {} } });
      const result = await evaluateCondition(db, 'f1', {
        condition_type: 'metadata_equals',
        condition_value: JSON.stringify({ key: 'tier' }),
      });
      expect(result).toBe(false);
      expect(errorSpy).toHaveBeenCalled();
    });

    it('friend metadata stored as invalid JSON → treated as empty map (does not throw)', async () => {
      const db = {
        prepare: () => ({
          bind: () => ({
            first: async () => ({ metadata: '{not json' }),
          }),
        }),
      } as unknown as D1Database;
      const result = await evaluateCondition(db, 'f1', {
        condition_type: 'metadata_equals',
        condition_value: JSON.stringify({ key: 'tier', value: 'gold' }),
      });
      // metadata defaults to {} → key is absent → not equal → returns false
      expect(result).toBe(false);
    });
  });
});

/**
 * Regression coverage for the condition-false jump path.
 *
 * Pre-fix, a failed condition with next_step_on_false set advanced
 * current_step_order to currentStep.step_order — so the next tick's
 * `find(step_order > current)` delivered the sequentially-next step and the
 * configured jump target was silently ignored (only its timing was used).
 * The bug is invisible when the jump target happens to BE the next step,
 * which is why it survived since the initial release.
 */
describe('condition-false jump (next_step_on_false)', () => {
  interface AdvanceCall {
    nextStepOrder: number;
    nextDeliveryAt: string | null;
    id: string;
  }

  /**
   * Fake D1 driving processStepDeliveries through the condition-false path:
   * one due friend_scenario at current_step_order=1, whose next step (order 2)
   * has a tag_exists condition the friend does NOT satisfy.
   */
  function deliveryMockDb(opts: { nextStepOnFalse: number | null; steps?: number[] }): {
    db: D1Database;
    advances: AdvanceCall[];
    completes: string[];
  } {
    const advances: AdvanceCall[] = [];
    const completes: string[] = [];
    const stepOrders = opts.steps ?? [1, 2, 3, 4];
    const stepRows = stepOrders.map((order) => ({
      id: `step-${order}`,
      scenario_id: 'sc1',
      step_order: order,
      message_type: 'text',
      message_content: `msg ${order}`,
      template_id: null,
      delay_minutes: 10,
      offset_days: null,
      offset_minutes: null,
      delivery_time: null,
      condition_type: order === 2 ? 'tag_exists' : null,
      condition_value: order === 2 ? 'tag-X' : null,
      next_step_on_false: order === 2 ? opts.nextStepOnFalse : null,
      on_reach_tag_id: null,
    }));

    const db = {
      prepare: (sql: string) => {
        const stmt = (args: unknown[]) => ({
          first: async () => {
            if (sql.includes('FROM friends')) {
              return {
                id: 'f1',
                line_user_id: 'U1',
                display_name: 'Test',
                is_following: 1,
                user_id: null,
                metadata: null,
                line_account_id: null,
              };
            }
            if (sql.includes('delivery_mode FROM scenarios')) {
              return { delivery_mode: 'relative' };
            }
            if (sql.includes('FROM friend_tags')) {
              return null; // friend does NOT have tag-X → condition fails
            }
            return null;
          },
          all: async () => {
            if (sql.includes('FROM friend_scenarios')) {
              return {
                results: [
                  {
                    id: 'fs1',
                    friend_id: 'f1',
                    scenario_id: 'sc1',
                    current_step_order: 1,
                    status: 'active',
                    next_delivery_at: '2026-01-01T00:00:00+09:00',
                    started_at: '2026-01-01T00:00:00+09:00',
                  },
                ],
              };
            }
            if (sql.includes('FROM scenario_steps')) {
              return { results: stepRows };
            }
            return { results: [] };
          },
          run: async () => {
            if (sql.includes("SET status = 'delivering'")) {
              return { meta: { changes: 1 } }; // claim succeeds
            }
            if (sql.includes('SET current_step_order')) {
              advances.push({
                nextStepOrder: args[0] as number,
                nextDeliveryAt: args[1] as string | null,
                id: args[3] as string,
              });
              return { meta: { changes: 1 } };
            }
            if (sql.includes("SET status = 'completed'")) {
              completes.push(args[1] as string);
              return { meta: { changes: 1 } };
            }
            return { meta: { changes: 1 } };
          },
        });
        return {
          bind: (...args: unknown[]) => stmt(args),
          ...stmt([]),
        };
      },
    } as unknown as D1Database;

    return { db, advances, completes };
  }

  function mockLineClient(): { client: LineClient; push: ReturnType<typeof vi.fn> } {
    const push = vi.fn(async () => ({}));
    return { client: { pushMessage: push } as unknown as LineClient, push };
  }

  it('failed condition with next_step_on_false=4 advances so the JUMP TARGET (4) is delivered next, not step 3', async () => {
    const { db, advances } = deliveryMockDb({ nextStepOnFalse: 4 });
    const { client, push } = mockLineClient();

    await processStepDeliveries(db, client);

    expect(push).not.toHaveBeenCalled(); // condition failed → nothing pushed
    expect(advances).toHaveLength(1);
    expect(advances[0].id).toBe('fs1');
    // find(step_order > current) must select step 4 next → current must be 3.
    // Pre-fix this was 2 (currentStep.step_order) → step 3 was wrongly delivered.
    expect(advances[0].nextStepOrder).toBe(3);
  });

  it('jump target works with non-contiguous step orders (1,2,5,9 → jump to 9)', async () => {
    const { db, advances } = deliveryMockDb({ nextStepOnFalse: 9, steps: [1, 2, 5, 9] });
    const { client } = mockLineClient();

    await processStepDeliveries(db, client);

    expect(advances).toHaveLength(1);
    // current=8 → first step_order > 8 is 9 (the jump target); 5 is skipped.
    expect(advances[0].nextStepOrder).toBe(8);
  });

  it('failed condition WITHOUT jump target keeps sequential advance (next tick delivers step 3)', async () => {
    const { db, advances } = deliveryMockDb({ nextStepOnFalse: null });
    const { client } = mockLineClient();

    await processStepDeliveries(db, client);

    expect(advances).toHaveLength(1);
    // Unchanged behaviour: advance to currentStep.step_order (2) → next is 3.
    expect(advances[0].nextStepOrder).toBe(2);
  });

  it('jump target pointing at a missing step_order falls back to sequential advance', async () => {
    const { db, advances } = deliveryMockDb({ nextStepOnFalse: 99 });
    const { client } = mockLineClient();

    await processStepDeliveries(db, client);

    expect(advances).toHaveLength(1);
    expect(advances[0].nextStepOrder).toBe(2); // no step 99 → sequential path
  });
});

/**
 * Regression coverage for the comma-cleanup scope bug.
 *
 * The ",," / "[," / ",]" cleanup in expandVariables exists to repair Flex
 * JSON broken by conditional-block removal ({{#if_ref}} / {{#if_metadata.KEY}}
 * inside arrays). Pre-fix it ran on EVERY message type, silently rewriting
 * plain-text bodies that legitimately contain those sequences.
 */
describe('expandVariables comma cleanup scope', () => {
  const friend = { id: 'f1', display_name: 'Test', user_id: null };

  describe('text messages are never rewritten', () => {
    it('preserves ",," in a text body', () => {
      const body = '価格は 1,, 2,, 3 のように表記します';
      expect(expandVariables(body, friend, undefined, 'text')).toBe(body);
    });

    it('preserves "[," and ",]" in a text body', () => {
      const body = '記法メモ: [, は開き、 ,] は閉じ';
      expect(expandVariables(body, friend, undefined, 'text')).toBe(body);
    });

    it('preserves ",," when messageType is omitted (safe default)', () => {
      const body = 'A,, B';
      expect(expandVariables(body, friend)).toBe(body);
    });

    it('still expands {{name}} in text without touching commas', () => {
      const out = expandVariables('{{name}}様, , こんにちは', friend, undefined, 'text');
      expect(out).toBe('Test様, , こんにちは');
    });
  });

  describe('flex messages keep the JSON repair (existing behaviour)', () => {
    it('repairs "[," left by a removed {{#if_ref}} block so the JSON parses', () => {
      // Simulates a Flex contents array whose first element was a conditional
      // block removed for a friend without ref_code: [{{#if_ref}}{...}{{/if_ref}},{...}]
      const template = '{"contents":[{{#if_ref}}{"type":"text","text":"ref: {{ref}}"}{{/if_ref}},{"type":"text","text":"hello"}]}';
      const out = expandVariables(template, { ...friend, ref_code: null }, undefined, 'flex');
      expect(out).toBe('{"contents":[{"type":"text","text":"hello"}]}');
      expect(() => JSON.parse(out)).not.toThrow();
    });

    it('repairs ",]" when the removed block was the last array element', () => {
      const template = '{"contents":[{"type":"text","text":"hello"},{{#if_metadata.plan}}{"type":"text","text":"{{metadata.plan}}"}{{/if_metadata.plan}}]}';
      const out = expandVariables(template, { ...friend, metadata: {} }, undefined, 'flex');
      expect(out).toBe('{"contents":[{"type":"text","text":"hello"}]}');
      expect(() => JSON.parse(out)).not.toThrow();
    });
  });
});

/**
 * Crash recovery wiring — a claim (active→delivering) whose worker died
 * mid-delivery must be reset back to 'active' at the start of every cron
 * run, BEFORE the due query (which only sees 'active' rows). Regression:
 * recoverStuckDeliveries existed but was never called, stranding
 * enrollments in 'delivering' forever.
 */
describe('processStepDeliveries crash recovery', () => {
  it("resets stuck 'delivering' enrollments before querying due rows", async () => {
    const executed: string[] = [];
    const db = {
      prepare: (sql: string) => {
        const stmt = {
          bind: () => stmt,
          first: async () => null,
          all: async () => {
            executed.push(sql);
            return { results: [] };
          },
          run: async () => {
            executed.push(sql);
            return { meta: { changes: 1 } };
          },
        };
        return stmt;
      },
    } as unknown as D1Database;
    const push = vi.fn(async () => ({}));
    const client = { pushMessage: push } as unknown as LineClient;

    await processStepDeliveries(db, client);

    const recoveryIdx = executed.findIndex(
      (sql) => sql.includes("SET status = 'active'") && sql.includes("status = 'delivering'"),
    );
    const dueQueryIdx = executed.findIndex((sql) => sql.includes('FROM friend_scenarios'));
    expect(recoveryIdx).toBeGreaterThanOrEqual(0); // recovery ran
    expect(dueQueryIdx).toBeGreaterThanOrEqual(0);
    expect(recoveryIdx).toBeLessThan(dueQueryIdx); // and ran first
  });
});

describe('buildMessage flex compatibility', () => {
  it('accepts a complete LINE Flex message without nesting the wrapper in contents', () => {
    const message = buildMessage('flex', JSON.stringify({
      type: 'flex',
      altText: '会員連携のご案内',
      contents: {
        type: 'bubble',
        body: {
          type: 'box',
          layout: 'vertical',
          contents: [{ type: 'text', text: 'LINEと会員を連携する' }],
        },
      },
    }));

    expect(message).toMatchObject({
      type: 'flex',
      altText: '会員連携のご案内',
      contents: { type: 'bubble' },
    });
    expect((message as { contents: { type: string } }).contents.type).not.toBe('flex');
  });
});
