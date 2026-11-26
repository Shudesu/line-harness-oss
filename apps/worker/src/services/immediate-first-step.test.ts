import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * pushImmediateFirstStep — the single implementation behind every instant
 * first-message entry point (tag_added attach, click campaigns, follow
 * webhook, referral routes). These tests pin the per-mode semantics that the
 * three original call sites relied on before they were unified:
 *
 * - 'once': claim protocol with the cron (exactly-once), cooldown hit
 *   advances WITHOUT pushing, send failure releases the claim, skipCooldown
 *   preserves the follow-webhook's always-reply semantics
 * - 'every-click': cooldown FIRST (before enrolling); a row that still owes
 *   step 1 is claimed (fencing the cron), re-clicks on an advanced row push
 *   again without touching it
 * - reply option: webhook follow sends via the free reply token and logs
 *   delivery_type='reply' (derived — no separate option)
 */

const dbMocks = vi.hoisted(() => ({
  getScenarioById: vi.fn(),
  getFriendById: vi.fn(),
  computeNextDeliveryAt: vi.fn(),
  resolveStepContent: vi.fn(),
  advanceFriendScenario: vi.fn(),
  completeFriendScenario: vi.fn(),
  claimFriendScenarioForDelivery: vi.fn(),
  enrollFriendInScenario: vi.fn(),
  getLineAccountByChannelId: vi.fn(),
  getLineAccountById: vi.fn(),
  // 既定は env をそのまま返す（＝従来挙動）。テナントに有効なアカウントが1本
  // しか無いときだけ line_accounts を正とする実装の、単体テスト側のスタブ。
  // 既定は「1本に決まらない」= null（＝従来どおり env / 既存の解決に委ねる）。
  resolveDefaultLineAccount: vi.fn(async () => null),
  addTagToFriend: vi.fn(),
  jstNow: vi.fn(),
  toJstString: vi.fn(),
}));
vi.mock('@line-crm/db', () => dbMocks);

const lineClientMock = vi.hoisted(() => ({
  pushMessage: vi.fn(),
  replyMessage: vi.fn(),
}));
vi.mock('@line-crm/line-sdk', () => ({
  LineClient: vi.fn().mockImplementation(() => lineClientMock),
}));

const stepDeliveryMocks = vi.hoisted(() => ({
  evaluateCondition: vi.fn(async (_db: unknown, _friendId: string, _step: { id: string }) => true),
}));
vi.mock('./step-delivery.js', () => ({
  buildMessage: vi.fn((type: string, content: string) => ({ type, text: content })),
  expandVariables: vi.fn((content: string) => content),
  resolveMetadata: vi.fn(async () => ({})),
  messageToLogPayload: vi.fn((msg: { type: string; text: string }) => ({
    messageType: msg.type,
    content: msg.text,
  })),
  evaluateCondition: stepDeliveryMocks.evaluateCondition,
}));

// Cron-parity decoration (shared decorateForFriendPush pipeline).
// Identity by default; the decoration suite overrides per-test.
const autoTrackMocks = vi.hoisted(() => ({
  decorateForFriendPush: vi.fn(),
}));
vi.mock('./auto-track.js', () => autoTrackMocks);

import { pushImmediateFirstStep } from './immediate-first-step.js';

const STEP1 = { id: 'step-1', step_order: 1, delay_minutes: 0, on_reach_tag_id: null };
const STEP2 = { id: 'step-2', step_order: 2, delay_minutes: 60 };

interface DbCall {
  sql: string;
  args: unknown[];
}

/**
 * Raw-SQL stub: records every prepare/bind and routes SELECTs by table.
 * `cooldownHit` backs the messages_log probe; `enrollmentLookup` backs the
 * friend_scenarios fallback lookup.
 */
function makeDb(opts: { cooldownHit?: boolean; enrollmentLookup?: { id: string; current_step_order: number } | null } = {}) {
  const calls: DbCall[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...args: unknown[]) => {
        calls.push({ sql, args });
        return {
          first: async () => {
            if (sql.includes('FROM messages_log')) return opts.cooldownHit ? { 1: 1 } : null;
            if (sql.includes('FROM friend_scenarios')) return opts.enrollmentLookup ?? null;
            return null;
          },
          run: async () => ({ meta: { changes: 1 } }),
        };
      },
    }),
  } as unknown as D1Database;
  return { db, calls };
}

const ctx = { defaultAccessToken: 'default-token', workerUrl: 'https://worker.example.com' };

function insertedLog(calls: DbCall[]): DbCall | undefined {
  return calls.find((c) => c.sql.includes('INSERT INTO messages_log'));
}

function claimReleased(calls: DbCall[]): boolean {
  return calls.some((c) => c.sql.includes(`status = 'active'`) && c.sql.includes(`status = 'delivering'`));
}

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.jstNow.mockReturnValue('2026-07-19T12:00:00.000+09:00');
  dbMocks.toJstString.mockImplementation((d: Date) => d.toISOString());
  // delay-0 steps schedule at "now"; later steps at now + delay.
  dbMocks.computeNextDeliveryAt.mockImplementation(
    (_scenario: unknown, step: { delay_minutes: number }, args: { now: Date }) =>
      new Date(args.now.getTime() + (step.delay_minutes ?? 0) * 60_000),
  );
  dbMocks.getScenarioById.mockResolvedValue({
    id: 'scn-1',
    is_active: 1,
    delivery_mode: 'relative',
    steps: [STEP1, STEP2],
  });
  dbMocks.getFriendById.mockResolvedValue({
    id: 'friend-1',
    line_user_id: 'U-1',
    line_account_id: null,
    user_id: null,
    metadata: '{}',
  });
  dbMocks.resolveStepContent.mockResolvedValue({
    messageType: 'text',
    messageContent: 'welcome!',
    templateIdAtSend: null,
  });
  dbMocks.claimFriendScenarioForDelivery.mockResolvedValue(true);
  dbMocks.enrollFriendInScenario.mockResolvedValue({ id: 'fs-1', current_step_order: 0 });
  lineClientMock.pushMessage.mockResolvedValue({});
  lineClientMock.replyMessage.mockResolvedValue({});
  autoTrackMocks.decorateForFriendPush.mockImplementation(
    async (_db: unknown, messageType: string, content: string) => ({ messageType, content }),
  );
});

describe("mode 'once' (default) — claim protocol with the cron", () => {
  it('claims, pushes step 1, logs, and advances to step 2', async () => {
    const { db, calls } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });

    expect(sent).toBe(true);
    expect(dbMocks.claimFriendScenarioForDelivery).toHaveBeenCalledWith(db, 'fs-1', 0);
    expect(lineClientMock.pushMessage).toHaveBeenCalledWith('U-1', [{ type: 'text', text: 'welcome!' }]);
    const log = insertedLog(calls);
    expect(log).toBeDefined();
    // delivery_type bind slot (7th value) stays NULL when not specified.
    expect(log!.args[5]).toBe(null);
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
    expect(dbMocks.completeFriendScenario).not.toHaveBeenCalled();
  });

  it('backs off without pushing when the cron already claimed the enrollment', async () => {
    dbMocks.claimFriendScenarioForDelivery.mockResolvedValue(false);
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
  });

  it('advances WITHOUT pushing on a cooldown hit (racing sender already delivered step 1)', async () => {
    const { db } = makeDb({ cooldownHit: true });
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
  });

  it('releases the claim when the push API fails so the cron retries on schedule', async () => {
    lineClientMock.pushMessage.mockRejectedValue(new Error('LINE 500'));
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { db, calls } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(claimReleased(calls)).toBe(true);
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
    expect(insertedLog(calls)).toBeUndefined();
    errorSpy.mockRestore();
  });

  it('never sends for a paused scenario (is_active = 0) — same gate as the cron', async () => {
    dbMocks.getScenarioById.mockResolvedValue({
      id: 'scn-1',
      is_active: 0,
      delivery_mode: 'relative',
      steps: [STEP1, STEP2],
    });
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(dbMocks.claimFriendScenarioForDelivery).not.toHaveBeenCalled();
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
  });

  it('skipCooldown bypasses the duplicate probe so a re-follow within 60s still gets its welcome', async () => {
    const { db } = makeDb({ cooldownHit: true });
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
      skipCooldown: true,
    });
    expect(sent).toBe(true);
    expect(lineClientMock.pushMessage).toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
  });

  it('advances (best effort) in the outer catch when the send succeeded but logging threw — cron must not re-send', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const calls: Array<{ sql: string }> = [];
    const db = {
      prepare: (sql: string) => ({
        bind: () => {
          calls.push({ sql });
          return {
            first: async () => null,
            run: async () => {
              if (sql.includes('INSERT INTO messages_log')) throw new Error('D1 transient');
              return { meta: { changes: 1 } };
            },
          };
        },
      }),
    } as unknown as D1Database;
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(true); // the message DID go out
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
    // The claim must not be left held once the enrollment is advanced.
    expect(calls.some((c) => c.sql.includes(`status = 'delivering'`) && c.sql.includes(`status = 'active'`))).toBe(false);
    errorSpy.mockRestore();
  });

  it('returns before claiming when step 1 is not immediate (delay > 0)', async () => {
    dbMocks.getScenarioById.mockResolvedValue({
      id: 'scn-1',
      is_active: 1,
      delivery_mode: 'relative',
      steps: [{ ...STEP1, delay_minutes: 30 }],
    });
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(dbMocks.claimFriendScenarioForDelivery).not.toHaveBeenCalled();
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
  });

  it('schedules step 2 at JST wall time WITHOUT double-applying the +9h offset', async () => {
    // computeNextDeliveryAt operates in the shifted frame (inputs are
    // Date.now()+9h), so serialization must relabel — not re-shift. A
    // double shift schedules step 2 nine hours late (regression guard).
    vi.useFakeTimers();
    try {
      vi.setSystemTime(new Date('2026-07-19T03:00:00.000Z')); // 12:00 JST
      const { db } = makeDb();
      await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
        enrollment: { id: 'fs-1', current_step_order: 0 },
      });
      // STEP2 delay is 60 min → 13:00 JST.
      expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(
        db,
        'fs-1',
        1,
        '2026-07-19T13:00:00.000+09:00',
      );
    } finally {
      vi.useRealTimers();
    }
  });

  it('completes the enrollment when the scenario has a single step', async () => {
    dbMocks.getScenarioById.mockResolvedValue({
      id: 'scn-1',
      is_active: 1,
      delivery_mode: 'relative',
      steps: [STEP1],
    });
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(true);
    expect(dbMocks.completeFriendScenario).toHaveBeenCalledWith(db, 'fs-1');
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
  });
});

describe("mode 'every-click' — click-campaign re-delivery", () => {
  const everyClick = { mode: 'every-click' as const, targetLineUserId: 'U-token' };

  it('checks the cooldown BEFORE enrolling and skips entirely on a hit', async () => {
    const { db } = makeDb({ cooldownHit: true });
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, everyClick);
    expect(sent).toBe(false);
    // No fresh step-0 row may be left behind for the cron.
    expect(dbMocks.enrollFriendInScenario).not.toHaveBeenCalled();
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
  });

  it('enrolls, claims the fresh row (fencing the cron), pushes to targetLineUserId, and advances it', async () => {
    const { db, calls } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, everyClick);
    expect(sent).toBe(true);
    expect(dbMocks.enrollFriendInScenario).toHaveBeenCalledWith(db, 'friend-1', 'scn-1');
    // The fresh enrollment's next_delivery_at is already due, so the cron
    // could race the push — the claim fences it out.
    expect(dbMocks.claimFriendScenarioForDelivery).toHaveBeenCalledWith(db, 'fs-1', 0);
    // Push target is the id_token-derived LINE user id, not friend.line_user_id.
    expect(lineClientMock.pushMessage).toHaveBeenCalledWith('U-token', [{ type: 'text', text: 'welcome!' }]);
    expect(insertedLog(calls)).toBeDefined();
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
  });

  it('skips the push when the claim fails — a concurrent deliverer (cron / follow webhook) owns step 1', async () => {
    dbMocks.claimFriendScenarioForDelivery.mockResolvedValue(false);
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, everyClick);
    expect(sent).toBe(false);
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
  });

  it('re-click (already enrolled and advanced): pushes again but leaves the enrollment alone', async () => {
    dbMocks.enrollFriendInScenario.mockResolvedValue(null); // INSERT OR IGNORE no-op
    const { db } = makeDb({ enrollmentLookup: { id: 'fs-1', current_step_order: 1 } });
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, everyClick);
    expect(sent).toBe(true);
    expect(lineClientMock.pushMessage).toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
    expect(dbMocks.completeFriendScenario).not.toHaveBeenCalled();
    expect(dbMocks.claimFriendScenarioForDelivery).not.toHaveBeenCalled();
  });

  it('repairs a stale behind row: re-click with an active step-0 enrollment advances it', async () => {
    dbMocks.enrollFriendInScenario.mockResolvedValue(null);
    const { db } = makeDb({ enrollmentLookup: { id: 'fs-stale', current_step_order: 0 } });
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, everyClick);
    expect(sent).toBe(true);
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-stale', 1, expect.any(String));
  });

  it('resolves the account token from accountChannelId before friend.line_account_id', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({ channel_access_token: 'acct-token' });
    const { LineClient } = await import('@line-crm/line-sdk');
    const { db } = makeDb();
    await pushImmediateFirstStep(
      db,
      'friend-1',
      'scn-1',
      { ...ctx, accountChannelId: 'CH-1' },
      everyClick,
    );
    expect(dbMocks.getLineAccountByChannelId).toHaveBeenCalledWith(db, 'CH-1');
    expect(vi.mocked(LineClient)).toHaveBeenCalledWith('acct-token');
    expect(dbMocks.getLineAccountById).not.toHaveBeenCalled();
  });
});

describe('reply option — webhook follow sends via the free reply token', () => {
  it('sends with replyMessage, never constructs a push client, and logs delivery_type=reply', async () => {
    const { LineClient } = await import('@line-crm/line-sdk');
    const replyClient = { replyMessage: vi.fn().mockResolvedValue({}) };
    const { db, calls } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
      reply: { client: replyClient, replyToken: 'rt-1' },
    });
    expect(sent).toBe(true);
    expect(replyClient.replyMessage).toHaveBeenCalledWith('rt-1', [{ type: 'text', text: 'welcome!' }]);
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    expect(vi.mocked(LineClient)).not.toHaveBeenCalled();
    const log = insertedLog(calls);
    expect(log!.args[5]).toBe('reply');
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
  });

  it('releases the claim when the reply fails (token consumed) so the cron pushes on schedule', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const replyClient = { replyMessage: vi.fn().mockRejectedValue(new Error('Invalid reply token')) };
    const { db, calls } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
      reply: { client: replyClient, replyToken: 'rt-used' },
    });
    expect(sent).toBe(false);
    expect(claimReleased(calls)).toBe(true);
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
    errorSpy.mockRestore();
  });
});

describe('decoration — cron parity via the shared decorateForFriendPush pipeline', () => {
  it('pipes expanded content through decorateForFriendPush and sends/logs the decorated output', async () => {
    autoTrackMocks.decorateForFriendPush.mockResolvedValue({
      messageType: 'flex',
      content: 'tracked!&f=friend-1',
    });
    const { db, calls } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });

    expect(sent).toBe(true);
    // Same helper + argument shape as processStepDeliveries.
    expect(autoTrackMocks.decorateForFriendPush).toHaveBeenCalledWith(
      db,
      'text',
      'welcome!',
      ctx.workerUrl,
      { lineAccountId: null, friendId: 'friend-1' },
    );
    // What LINE receives AND what messages_log records is the decorated
    // message, mirroring the cron.
    expect(lineClientMock.pushMessage).toHaveBeenCalledWith('U-1', [
      { type: 'flex', text: 'tracked!&f=friend-1' },
    ]);
    const log = insertedLog(calls);
    expect(log!.args[2]).toBe('flex');
    expect(log!.args[3]).toBe('tracked!&f=friend-1');
  });

  it('owns tracked links by the friend’s line_account_id when it is wired', async () => {
    dbMocks.getFriendById.mockResolvedValue({
      id: 'friend-1',
      line_user_id: 'U-1',
      line_account_id: 'acct-7',
      user_id: null,
      metadata: '{}',
    });
    const { db } = makeDb();
    await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(autoTrackMocks.decorateForFriendPush).toHaveBeenCalledWith(
      db,
      'text',
      'welcome!',
      ctx.workerUrl,
      { lineAccountId: 'acct-7', friendId: 'friend-1' },
    );
  });

  it('falls back to the caller-resolved account as link owner when friend.line_account_id is not yet wired (LIFF-before-webhook)', async () => {
    dbMocks.getLineAccountByChannelId.mockResolvedValue({
      id: 'acct-9',
      channel_access_token: 'tok-9',
    });
    const { db } = makeDb();
    await pushImmediateFirstStep(
      db,
      'friend-1',
      'scn-1',
      { ...ctx, accountChannelId: 'CH-9' },
      { enrollment: { id: 'fs-1', current_step_order: 0 } },
    );
    expect(dbMocks.getLineAccountByChannelId).toHaveBeenCalledWith(db, 'CH-9');
    expect(autoTrackMocks.decorateForFriendPush).toHaveBeenCalledWith(
      db,
      'text',
      'welcome!',
      ctx.workerUrl,
      { lineAccountId: 'acct-9', friendId: 'friend-1' },
    );
  });

  it('passes workerUrl through even when unset — the helper is the single no-op gate', async () => {
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(
      db,
      'friend-1',
      'scn-1',
      { defaultAccessToken: 'default-token' },
      { enrollment: { id: 'fs-1', current_step_order: 0 } },
    );
    expect(sent).toBe(true);
    expect(autoTrackMocks.decorateForFriendPush).toHaveBeenCalledWith(
      db,
      'text',
      'welcome!',
      undefined,
      { lineAccountId: null, friendId: 'friend-1' },
    );
    expect(lineClientMock.pushMessage).toHaveBeenCalledWith('U-1', [{ type: 'text', text: 'welcome!' }]);
  });

  it('decorates the reply-token path too — follow-webhook welcomes carry tracked links', async () => {
    autoTrackMocks.decorateForFriendPush.mockResolvedValue({
      messageType: 'text',
      content: 'welcome!&f=friend-1',
    });
    const replyClient = { replyMessage: vi.fn().mockResolvedValue({}) };
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
      reply: { client: replyClient, replyToken: 'rt-1' },
    });
    expect(sent).toBe(true);
    expect(replyClient.replyMessage).toHaveBeenCalledWith('rt-1', [
      { type: 'text', text: 'welcome!&f=friend-1' },
    ]);
  });
});

describe('on_reach_tag', () => {
  it('attaches the reach tag after advancing', async () => {
    dbMocks.getScenarioById.mockResolvedValue({
      id: 'scn-1',
      is_active: 1,
      delivery_mode: 'relative',
      steps: [{ ...STEP1, on_reach_tag_id: 'tag-9' }, STEP2],
    });
    const { db } = makeDb();
    await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(dbMocks.addTagToFriend).toHaveBeenCalledWith(db, 'friend-1', 'tag-9');
  });
});

describe('step conditions — cron parity on the instant path', () => {
  const COND_STEP1 = {
    id: 'step-1',
    step_order: 1,
    delay_minutes: 0,
    on_reach_tag_id: null,
    condition_type: 'tag_exists',
    condition_value: 'tag-answered',
  };
  const COND_STEP2 = {
    id: 'step-2',
    step_order: 2,
    delay_minutes: 0,
    on_reach_tag_id: null,
    condition_type: 'tag_not_exists',
    condition_value: 'tag-answered',
  };

  beforeEach(() => {
    dbMocks.getScenarioById.mockResolvedValue({
      id: 'scn-1',
      is_active: 1,
      delivery_mode: 'relative',
      steps: [COND_STEP1, COND_STEP2],
    });
  });

  it("delivers step 1 when its condition passes (evaluated via the cron's evaluateCondition)", async () => {
    stepDeliveryMocks.evaluateCondition.mockImplementation(
      async (_db: unknown, _friendId: string, step: { id: string }) => step.id === 'step-1',
    );
    dbMocks.resolveStepContent.mockResolvedValue({
      messageType: 'text',
      messageContent: 'reward!',
      templateIdAtSend: null,
    });
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(true);
    expect(lineClientMock.pushMessage).toHaveBeenCalledWith('U-1', [{ type: 'text', text: 'reward!' }]);
    // advanced to step 1's order, next scheduled from step 2
    expect(dbMocks.advanceFriendScenario).toHaveBeenCalledWith(db, 'fs-1', 1, expect.any(String));
  });

  it('skips a failing step 1 and instantly delivers the next immediate step whose condition passes', async () => {
    stepDeliveryMocks.evaluateCondition.mockImplementation(
      async (_db: unknown, _friendId: string, step: { id: string }) => step.id === 'step-2',
    );
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(true);
    // delivered step 2 and completed (no step after it)
    expect(dbMocks.completeFriendScenario).toHaveBeenCalledWith(db, 'fs-1');
  });

  it('does not walk past a non-immediate step: a failing delay-0 step 1 followed by a delayed step leaves the row to the cron', async () => {
    dbMocks.getScenarioById.mockResolvedValue({
      id: 'scn-1',
      is_active: 1,
      delivery_mode: 'relative',
      steps: [COND_STEP1, { ...STEP2, condition_type: null, condition_value: null }],
    });
    stepDeliveryMocks.evaluateCondition.mockResolvedValue(false);
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    // untouched: no claim, no advance — the cron owns the skip
    expect(dbMocks.claimFriendScenarioForDelivery).not.toHaveBeenCalled();
    expect(dbMocks.advanceFriendScenario).not.toHaveBeenCalled();
  });

  it('sends nothing and touches nothing when every immediate step fails its condition', async () => {
    stepDeliveryMocks.evaluateCondition.mockResolvedValue(false);
    const { db } = makeDb();
    const sent = await pushImmediateFirstStep(db, 'friend-1', 'scn-1', ctx, {
      enrollment: { id: 'fs-1', current_step_order: 0 },
    });
    expect(sent).toBe(false);
    expect(lineClientMock.pushMessage).not.toHaveBeenCalled();
    expect(dbMocks.claimFriendScenarioForDelivery).not.toHaveBeenCalled();
  });
});
