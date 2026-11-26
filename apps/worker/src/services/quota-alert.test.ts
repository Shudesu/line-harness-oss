import { describe, expect, test, vi, beforeEach } from 'vitest';
import { monthStartJst } from './quota.js';

const createNotification = vi.fn();
const hasNotificationSince = vi.fn();
const getActiveNotificationRulesByEvent = vi.fn();
const getActiveOutgoingWebhooksByEvent = vi.fn();

vi.mock('@line-crm/db', () => ({
  createNotification: (...args: unknown[]) => createNotification(...args),
  hasNotificationSince: (...args: unknown[]) => hasNotificationSince(...args),
  getActiveNotificationRulesByEvent: (...args: unknown[]) =>
    getActiveNotificationRulesByEvent(...args),
  getActiveOutgoingWebhooksByEvent: (...args: unknown[]) =>
    getActiveOutgoingWebhooksByEvent(...args),
  // 実実装と同形式 (JST +09:00 サフィックス) — dedup の since 形式検証に使う。
  toJstString: (date: Date) =>
    new Date(date.getTime() + 9 * 3600_000).toISOString().slice(0, -1) + '+09:00',
}));

const fireOutgoingWebhooks = vi.fn();
vi.mock('./event-bus.js', () => ({
  fireOutgoingWebhooks: (...args: unknown[]) => fireOutgoingWebhooks(...args),
}));

const { getLinePlanQuotaShortfall, notifyQuotaAlert, countDeliverableAudience, allTargetGuardAudience } =
  await import('./quota-alert.js');

function client(quota: { type: string; value?: number }, totalUsage: number) {
  return {
    getMessageQuota: async () => quota,
    getMessageQuotaConsumption: async () => ({ totalUsage }),
  };
}

const db = {} as D1Database;

describe('getLinePlanQuotaShortfall', () => {
  test('上限なしプラン (type=none) は常に null', async () => {
    expect(await getLinePlanQuotaShortfall(client({ type: 'none' }, 99999), 500)).toBeNull();
  });

  test('残量が配信対象以上なら null', async () => {
    expect(await getLinePlanQuotaShortfall(client({ type: 'limited', value: 1000 }, 400), 600)).toBeNull();
  });

  test('残量が配信対象未満なら不足情報を返す', async () => {
    const shortfall = await getLinePlanQuotaShortfall(client({ type: 'limited', value: 1000 }, 700), 500);
    expect(shortfall).toEqual({ limit: 1000, consumption: 700, remaining: 300, audience: 500 });
  });

  test('残り0は audience=0 でも不足扱い (全一括送信が失敗する状態)', async () => {
    const shortfall = await getLinePlanQuotaShortfall(client({ type: 'limited', value: 200 }, 200), 0);
    expect(shortfall).toMatchObject({ remaining: 0 });
  });

  test('消費が上限を超過していても remaining は 0 で clamp される', async () => {
    const shortfall = await getLinePlanQuotaShortfall(client({ type: 'limited', value: 200 }, 350), 10);
    expect(shortfall).toMatchObject({ remaining: 0, consumption: 350 });
  });

  test('lazy audience: 上限なしプランでは audience 関数を評価しない', async () => {
    const audienceFn = vi.fn(async () => 500);
    expect(await getLinePlanQuotaShortfall(client({ type: 'none' }, 0), audienceFn)).toBeNull();
    expect(audienceFn).not.toHaveBeenCalled();
  });

  test('lazy audience: 上限ありプランでは評価して比較する', async () => {
    const audienceFn = vi.fn(async () => 500);
    const shortfall = await getLinePlanQuotaShortfall(
      client({ type: 'limited', value: 1000 }, 900),
      audienceFn,
    );
    expect(audienceFn).toHaveBeenCalledTimes(1);
    expect(shortfall).toMatchObject({ remaining: 100, audience: 500 });
  });

  test('クォータ API の失敗は fail-open (null)', async () => {
    const broken = {
      getMessageQuota: async () => {
        throw new Error('401');
      },
      getMessageQuotaConsumption: async () => ({ totalUsage: 0 }),
    };
    expect(await getLinePlanQuotaShortfall(broken, 500)).toBeNull();
  });
});

describe('countDeliverableAudience', () => {
  function dbWithSql() {
    const captured: { sql?: string; binds?: unknown[] } = {};
    const stub = {
      prepare(sql: string) {
        captured.sql = sql;
        return {
          bind(...binds: unknown[]) {
            captured.binds = binds;
            return { first: async () => ({ count: 42 }) };
          },
        };
      },
    } as unknown as D1Database;
    return { stub, captured };
  }

  test('includeLegacyNullRows=true は NULL 行込みで数える', async () => {
    const { stub, captured } = dbWithSql();
    expect(await countDeliverableAudience(stub, 'acc-1', true)).toBe(42);
    expect(captured.sql).toContain('line_account_id = ? OR line_account_id IS NULL');
  });

  test('includeLegacyNullRows=false は厳密一致で数える', async () => {
    const { stub, captured } = dbWithSql();
    await countDeliverableAudience(stub, 'acc-1', false);
    expect(captured.sql).toContain('line_account_id = ?');
    expect(captured.sql).not.toContain('IS NULL');
  });
});

describe('allTargetGuardAudience', () => {
  function dbCapture(counts: { accounts?: number; friends?: number } = {}) {
    const sqls: string[] = [];
    const stub = {
      prepare(sql: string) {
        sqls.push(sql);
        const exec = {
          bind: (..._binds: unknown[]) => exec,
          first: async () => ({
            count: sql.includes('line_accounts') ? counts.accounts ?? 1 : counts.friends ?? 0,
          }),
        };
        return exec;
      },
    } as unknown as D1Database;
    return { stub, sqls };
  }

  test('knownSingleInstall を渡すと line_accounts の COUNT を省略する', async () => {
    const { stub, sqls } = dbCapture({ friends: 7 });
    await expect(allTargetGuardAudience(stub, 'acc-1', true)()).resolves.toBe(7);
    expect(sqls.some((s) => s.includes('line_accounts'))).toBe(false);
    expect(sqls[0]).toContain('line_account_id = ? OR line_account_id IS NULL');
  });

  test('knownSingleInstall 省略時は isSingleAccountInstall で判定する (マルチアカは厳密一致)', async () => {
    const { stub, sqls } = dbCapture({ accounts: 2, friends: 5 });
    await expect(allTargetGuardAudience(stub, 'acc-1')()).resolves.toBe(5);
    expect(sqls.some((s) => s.includes('line_accounts'))).toBe(true);
    const friendsSql = sqls.find((s) => s.includes('FROM friends'))!;
    expect(friendsSql).not.toContain('IS NULL');
  });

  test('accountId null は NULL 行込みの全件 (単一アカウント運用の本体)', async () => {
    const { stub, sqls } = dbCapture({ friends: 3 });
    await expect(allTargetGuardAudience(stub, null)()).resolves.toBe(3);
    expect(sqls).toHaveLength(1);
    expect(sqls[0]).not.toContain('line_account_id');
  });
});

describe('notifyQuotaAlert', () => {
  const shortfall = { limit: 1000, consumption: 900, remaining: 100, audience: 500 };

  beforeEach(() => {
    createNotification.mockReset().mockResolvedValue({});
    hasNotificationSince.mockReset().mockResolvedValue(false);
    getActiveNotificationRulesByEvent.mockReset().mockResolvedValue([]);
    getActiveOutgoingWebhooksByEvent.mockReset().mockResolvedValue([{ id: 'wh-1' }]);
    // fireOutgoingWebhooks は 2xx で受理された配信数を返す (webhook 行の sent/failed 判定に使う)
    fireOutgoingWebhooks.mockReset().mockResolvedValue(1);
  });

  test('health-check は同月に通知済みなら何もしない (月次 dedup)', async () => {
    hasNotificationSince.mockResolvedValue(true);

    const sent = await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      shortfall,
      source: 'health-check',
    });

    expect(sent).toBe(false);
    expect(hasNotificationSince).toHaveBeenCalledWith(db, {
      eventType: 'quota_alert',
      lineAccountId: 'acc-1',
      since: monthStartJst(),
    });
    expect(createNotification).not.toHaveBeenCalled();
    expect(fireOutgoingWebhooks).not.toHaveBeenCalled();
  });

  test('pre-send は月次 dedup の対象外 (配信中止は毎回通知する)', async () => {
    hasNotificationSince.mockResolvedValue(true);

    const sent = await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      shortfall,
      source: 'pre-send',
      broadcastId: 'bc-1',
      broadcastTitle: '9月キャンペーン',
    });

    expect(sent).toBe(true);
    expect(hasNotificationSince).not.toHaveBeenCalled();
    expect(createNotification).toHaveBeenCalled();
    expect(fireOutgoingWebhooks).toHaveBeenCalled();
  });

  test('ルール未設定でも dashboard 行を必ず残し webhook を発火する', async () => {
    const sent = await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      accountName: 'L Harness ①',
      shortfall,
      source: 'health-check',
    });

    expect(sent).toBe(true);
    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][1]).toMatchObject({
      eventType: 'quota_alert',
      channel: 'dashboard',
      status: 'sent',
      lineAccountId: 'acc-1',
    });
    expect(createNotification.mock.calls[0][1].title).toContain('L Harness ①');
    expect(fireOutgoingWebhooks).toHaveBeenCalledWith(
      db,
      'quota_alert',
      expect.objectContaining({
        eventData: expect.objectContaining({ lineAccountId: 'acc-1', remaining: 100 }),
      }),
      [{ id: 'wh-1' }], // 取得済み購読者リストを渡して二重クエリを避ける
    );
  });

  test('webhook が1件も届かなかったら webhook 行は failed で記録する', async () => {
    fireOutgoingWebhooks.mockResolvedValue(0); // エンドポイント down / 非2xx
    getActiveNotificationRulesByEvent.mockResolvedValue([
      { id: 'rule-1', channels: '["webhook"]', line_account_id: null },
    ]);

    await notifyQuotaAlert(db, { lineAccountId: 'acc-1', shortfall, source: 'pre-send' });

    const rows = createNotification.mock.calls.map((c) => c[1]);
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ['dashboard', 'sent'],
      ['webhook', 'failed'],
    ]);
  });

  test('有効ルールのチャネルを記録する (未実装チャネルは pending)', async () => {
    getActiveNotificationRulesByEvent.mockResolvedValue([
      { id: 'rule-1', channels: '["webhook","email"]', line_account_id: null },
    ]);

    await notifyQuotaAlert(db, { lineAccountId: 'acc-1', shortfall, source: 'pre-send' });

    const rows = createNotification.mock.calls.map((c) => c[1]);
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ['dashboard', 'sent'],
      ['webhook', 'sent'],
      ['email', 'pending'],
    ]);
    expect(rows[1].ruleId).toBe('rule-1');
  });

  test('webhook 購読者ゼロなら webhook 行は failed で記録し発火もしない', async () => {
    getActiveOutgoingWebhooksByEvent.mockResolvedValue([]);
    getActiveNotificationRulesByEvent.mockResolvedValue([
      { id: 'rule-1', channels: '["webhook"]', line_account_id: null },
    ]);

    await notifyQuotaAlert(db, { lineAccountId: 'acc-1', shortfall, source: 'health-check' });

    const rows = createNotification.mock.calls.map((c) => c[1]);
    expect(rows.map((r) => [r.channel, r.status])).toEqual([
      ['dashboard', 'sent'],
      ['webhook', 'failed'],
    ]);
    expect(fireOutgoingWebhooks).not.toHaveBeenCalled();
  });

  test('別アカウント限定のルールは無視する', async () => {
    getActiveNotificationRulesByEvent.mockResolvedValue([
      { id: 'rule-1', channels: '["webhook"]', line_account_id: 'acc-OTHER' },
    ]);

    await notifyQuotaAlert(db, { lineAccountId: 'acc-1', shortfall, source: 'health-check' });

    expect(createNotification).toHaveBeenCalledTimes(1);
    expect(createNotification.mock.calls[0][1].channel).toBe('dashboard');
  });

  test('pre-send 由来は broadcast 情報を本文と metadata に含める', async () => {
    await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      shortfall,
      source: 'pre-send',
      broadcastId: 'bc-1',
      broadcastTitle: '9月キャンペーン',
    });

    const row = createNotification.mock.calls[0][1];
    expect(row.body).toContain('9月キャンペーン');
    expect(JSON.parse(row.metadata)).toMatchObject({ broadcastId: 'bc-1', source: 'pre-send' });
  });

  test('proxy-pre-send は1時間以内の同種 (proxy-*) 通知があれば何もしない (時間 dedup)', async () => {
    hasNotificationSince.mockResolvedValue(true);

    const sent = await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      shortfall,
      source: 'proxy-pre-send',
    });

    expect(sent).toBe(false);
    // since は「約1時間前」(created_at と同じ +09:00 付き JST 形式)。
    // sourcePrefix で proxy-* の既通知だけを重複と見なす — 直前の cron 警告
    // (health-check) が実失敗の通知を握りつぶさないように。
    const arg = hasNotificationSince.mock.calls[0][1] as { since: string; sourcePrefix?: string };
    expect(arg.sourcePrefix).toBe('proxy-');
    expect(arg.since).toContain('+09:00');
    expect(Math.abs(Date.now() - 3600_000 - new Date(arg.since).getTime())).toBeLessThan(10_000);
    expect(createNotification).not.toHaveBeenCalled();
  });

  test('proxy-upstream-429 も時間 dedup、タイトルは「失敗」を伝える', async () => {
    const sent = await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      accountName: 'Main',
      shortfall,
      source: 'proxy-upstream-429',
    });

    expect(sent).toBe(true);
    expect(hasNotificationSince).toHaveBeenCalled();
    const row = createNotification.mock.calls[0][1];
    expect(row.title).toContain('失敗');
    expect(row.title).toContain('Main');
    expect(JSON.parse(row.metadata)).toMatchObject({ source: 'proxy-upstream-429' });
  });

  test('limit=0 の合成 shortfall は数字を出さず超過の事実だけ伝える', async () => {
    await notifyQuotaAlert(db, {
      lineAccountId: 'acc-1',
      shortfall: { limit: 0, consumption: 0, remaining: 0, audience: 500 },
      source: 'proxy-upstream-429',
    });

    const row = createNotification.mock.calls[0][1];
    expect(row.body).toContain('取得できませんでした');
    expect(row.body).not.toContain('上限0通');
  });

  test('通知処理の失敗は握りつぶして false を返す (best-effort)', async () => {
    createNotification.mockRejectedValue(new Error('D1 down'));

    await expect(
      notifyQuotaAlert(db, { lineAccountId: 'acc-1', shortfall, source: 'health-check' }),
    ).resolves.toBe(false);
  });
});
