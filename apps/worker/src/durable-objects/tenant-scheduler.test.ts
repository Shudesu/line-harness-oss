import { describe, expect, test, vi, beforeEach } from 'vitest';

const scheduledMock = vi.hoisted(() => vi.fn(async (_event: { cron: string; scheduledTime: number }) => undefined));
vi.mock('../scheduled.js', () => ({ scheduled: scheduledMock }));

// cloudflare:workers は vitest.config.ts の alias で test-support/cloudflare-workers-stub.ts
// に差し替えられている (Workers ランタイム外では実体を解決できないため)。

import {
  runSchedulerTick,
  scheduledFromCron,
  isCronLive,
  CRON_LIVENESS_WINDOW_MS,
  LAST_CRON_TICK_KEY,
  LAST_SIX_HOUR_CRON_TICK_KEY,
  SIX_HOUR_SLOT_DONE_KEY,
  SIX_HOUR_CATCH_UP_GRACE_MS,
  sixHourSlot,
  SIX_HOUR_CRON_LIVENESS_WINDOW_MS,
  ensureAlarmArmed,
  ensureSchedulerArmed,
  isSixHourBoundary,
  SCHEDULER_TICK_INTERVAL_MS,
  SCHEDULER_INSTANCE_NAME,
  TenantScheduler,
  type AlarmStorage,
} from './tenant-scheduler.js';

/** getAlarm/setAlarm を最小実装したフェイクストレージ。呼び出し順序も記録する。 */
function fakeStorage(initialAlarm: number | null = null) {
  let alarm = initialAlarm;
  const calls: string[] = [];
  const storage: AlarmStorage & { calls: string[]; alarm: () => number | null } = {
    calls,
    alarm: () => alarm,
    async getAlarm() {
      calls.push('getAlarm');
      return alarm;
    },
    async setAlarm(time) {
      calls.push('setAlarm');
      alarm = typeof time === 'number' ? time : time.getTime();
    },
  };
  return storage;
}

beforeEach(() => {
  scheduledMock.mockClear();
});

describe('isSixHourBoundary', () => {
  test('UTC 0/6/12/18時ちょうどは境界', () => {
    expect(isSixHourBoundary(new Date('2026-08-23T00:00:00Z'))).toBe(true);
    expect(isSixHourBoundary(new Date('2026-08-23T06:00:00Z'))).toBe(true);
    expect(isSixHourBoundary(new Date('2026-08-23T12:00:00Z'))).toBe(true);
    expect(isSixHourBoundary(new Date('2026-08-23T18:00:00Z'))).toBe(true);
  });

  test('分がゼロでない、または6時間の倍数でない時刻は境界ではない', () => {
    expect(isSixHourBoundary(new Date('2026-08-23T00:01:00Z'))).toBe(false);
    expect(isSixHourBoundary(new Date('2026-08-23T03:00:00Z'))).toBe(false);
    expect(isSixHourBoundary(new Date('2026-08-23T07:00:00Z'))).toBe(false);
  });
});

describe('runSchedulerTick — 再アーム順序', () => {
  test('次のアラームを work より先にセットする', async () => {
    const storage = fakeStorage();
    const order: string[] = [];
    const runJobs = vi.fn(async () => {
      order.push('runJobs');
    });
    // storage.setAlarm 呼び出しも同じ order 配列に積む
    const originalSetAlarm = storage.setAlarm.bind(storage);
    storage.setAlarm = async (t) => {
      order.push('setAlarm');
      await originalSetAlarm(t);
    };

    const now = new Date('2026-08-23T10:30:00Z');
    await runSchedulerTick(storage, runJobs, now);

    expect(order).toEqual(['setAlarm', 'runJobs']);
    expect(storage.alarm()).toBe(now.getTime() + SCHEDULER_TICK_INTERVAL_MS);
  });

  test('通常 tick では分足 cron イベントで1回だけ runJobs を呼ぶ', async () => {
    const storage = fakeStorage();
    const runJobs = vi.fn(async () => {});
    const now = new Date('2026-08-23T10:31:00Z'); // 6時間境界ではない

    await runSchedulerTick(storage, runJobs, now);

    expect(runJobs).toHaveBeenCalledTimes(1);
    expect(runJobs).toHaveBeenCalledWith({ cron: '* * * * *', scheduledTime: now.getTime() });
  });

  test('6時間境界では分足・6時間足の両方のイベントで2回呼ぶ（Cron Trigger の実際の挙動を再現）', async () => {
    const storage = fakeStorage();
    const runJobs = vi.fn(async () => {});
    const now = new Date('2026-08-23T12:00:00Z'); // 6時間境界

    await runSchedulerTick(storage, runJobs, now);

    expect(runJobs).toHaveBeenCalledTimes(2);
    expect(runJobs).toHaveBeenNthCalledWith(1, { cron: '* * * * *', scheduledTime: now.getTime() });
    expect(runJobs).toHaveBeenNthCalledWith(2, { cron: '0 */6 * * *', scheduledTime: now.getTime() });
  });
});

describe('runSchedulerTick — work が例外を投げてもチェーンは生きる', () => {
  test('runJobs が throw しても runSchedulerTick 自体は reject せず、次のアラームは既にセット済みのまま残る', async () => {
    const storage = fakeStorage();
    const now = new Date('2026-08-23T10:32:00Z');
    const runJobs = vi.fn(async () => {
      throw new Error('boom');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(runSchedulerTick(storage, runJobs, now)).resolves.toBeUndefined();

    // 例外を投げた work の前にセットされた次アラームが消えていないこと。
    expect(storage.alarm()).toBe(now.getTime() + SCHEDULER_TICK_INTERVAL_MS);
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  test('6時間境界 1本目 (分足) が throw しても 2本目 (6時間足) は独立に呼ばれ、次アラームも生きている', async () => {
    // scheduled() 内部は個々のジョブを try/catch しているが、runJobs 自体が
    // 想定外の例外を投げるケース (例: D1 接続不可) をここでは検証する。
    // Cron でもトリガーごとに別の呼び出しなので、分足の失敗が6時間保守を
    // 巻き込まないのが本来の形。チェーンも死なない。
    const storage = fakeStorage();
    const now = new Date('2026-08-23T18:00:00Z'); // 6時間境界
    const runJobs = vi.fn(async () => {
      throw new Error('boom');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runSchedulerTick(storage, runJobs, now);

    expect(runJobs).toHaveBeenCalledTimes(2);
    expect(storage.alarm()).toBe(now.getTime() + SCHEDULER_TICK_INTERVAL_MS);
    consoleError.mockRestore();
  });
});

describe('ensureAlarmArmed — 自己修復', () => {
  test('アラーム未設定なら再アームし true を返す', async () => {
    const storage = fakeStorage(null);
    const now = new Date('2026-08-23T10:33:00Z');

    const armed = await ensureAlarmArmed(storage, now);

    expect(armed).toBe(true);
    expect(storage.alarm()).toBe(now.getTime() + SCHEDULER_TICK_INTERVAL_MS);
  });

  test('アラームが既に設定済みなら何もせず false を返す', async () => {
    const existing = 1_700_000_000_000;
    const storage = fakeStorage(existing);

    const armed = await ensureAlarmArmed(storage);

    expect(armed).toBe(false);
    expect(storage.alarm()).toBe(existing); // 変更されていない
    expect(storage.calls).toEqual(['getAlarm']); // setAlarm は呼ばれていない
  });
});

describe('ensureSchedulerArmed — webhook から叩かれる薄いラッパー', () => {
  function fakeNamespace(stub: { ensureArmed: ReturnType<typeof vi.fn> }) {
    const idFromNameCalls: string[] = [];
    return {
      idFromName: vi.fn((name: string) => {
        idFromNameCalls.push(name);
        return { name } as unknown as DurableObjectId;
      }),
      get: vi.fn(() => stub),
      idFromNameCalls,
    };
  }

  test('TENANT_SCHEDULER バインディングが無ければ何もせず解決する', async () => {
    await expect(ensureSchedulerArmed({})).resolves.toBeUndefined();
  });

  test('固定名でインスタンスを解決し ensureArmed() を呼ぶ', async () => {
    const stub = { ensureArmed: vi.fn(async () => {}) };
    const ns = fakeNamespace(stub);

    await ensureSchedulerArmed({ TENANT_SCHEDULER: ns as never });

    expect(ns.idFromNameCalls).toEqual([SCHEDULER_INSTANCE_NAME]);
    expect(stub.ensureArmed).toHaveBeenCalledTimes(1);
  });

  test('DO 呼び出しが失敗しても例外を外に投げない（webhook 応答を止めない）', async () => {
    const stub = { ensureArmed: vi.fn(async () => { throw new Error('do unavailable'); }) };
    const ns = fakeNamespace(stub);
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(ensureSchedulerArmed({ TENANT_SCHEDULER: ns as never })).resolves.toBeUndefined();

    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });
});

describe('TenantScheduler クラス — DO ランタイムへの配線', () => {
  function fakeCtx(storage: AlarmStorage) {
    let resolveReady: () => void;
    const ready = new Promise<void>((res) => {
      resolveReady = res;
    });
    return {
      storage,
      waitUntil: vi.fn(),
      async blockConcurrencyWhile<T>(cb: () => Promise<T>): Promise<T> {
        const result = await cb();
        resolveReady();
        return result;
      },
      ready,
    };
  }

  test('コンストラクタで初回アクセス時に自己修復する', async () => {
    const storage = fakeStorage(null);
    const ctx = fakeCtx(storage);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const scheduler = new TenantScheduler(ctx as never, {} as never);
    await ctx.ready;

    expect(storage.alarm()).not.toBeNull();
  });

  // alarm() は now を引数に取らず runSchedulerTick の既定値 (new Date()) を使うため、
  // 実時刻のまま走らせると UTC 0/6/12/18 時ちょうどに CI が回ったときだけ
  // isSixHourBoundary() が真になり scheduled() が 2 回呼ばれて落ちる。
  // Date だけを固定して分岐を決め打ちする (タイマーは実物のまま = await を壊さない)。
  function withFixedNow<T>(iso: string, run: () => Promise<T>): Promise<T> {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(new Date(iso));
    return run().finally(() => {
      vi.useRealTimers();
    });
  }

  test('alarm() は次アラームを先にセットしてから既存の scheduled() を呼ぶ', async () => {
    // 6時間境界ではない時刻に固定する (境界の挙動は次のテストで確認する)。
    await withFixedNow('2026-08-23T10:30:00Z', async () => {
      const storage = fakeStorage(1_700_000_000_000); // コンストラクタの自己修復をスキップさせる
      const ctx = fakeCtx(storage);
      const env = { DB: {} } as never;
      const scheduler = new TenantScheduler(ctx as never, env);
      await ctx.ready;

      const beforeAlarm = storage.alarm();
      await scheduler.alarm();

      expect(storage.alarm()).not.toBe(beforeAlarm); // 再アームされている
      expect(scheduledMock).toHaveBeenCalledTimes(1);
      const [eventArg, envArg] = scheduledMock.mock.calls[0] as unknown as [
        { cron: string },
        unknown,
      ];
      expect(eventArg.cron).toBe('* * * * *');
      expect(envArg).toBe(env);
    });
  });

  test('alarm() は6時間境界では分足と6h足の2イベントで scheduled() を呼ぶ', async () => {
    // Cloudflare Cron Triggers が両パターンにマッチする分の挙動 (トリガーごとに1回) の再現。
    await withFixedNow('2026-08-23T12:00:00Z', async () => {
      const storage = fakeStorage(1_700_000_000_000);
      const ctx = fakeCtx(storage);
      const env = { DB: {} } as never;
      const scheduler = new TenantScheduler(ctx as never, env);
      await ctx.ready;

      await scheduler.alarm();

      expect(scheduledMock).toHaveBeenCalledTimes(2);
      const crons = scheduledMock.mock.calls.map(
        (call) => (call as unknown as [{ cron: string }])[0].cron,
      );
      expect(crons).toEqual(['* * * * *', '0 */6 * * *']);
    });
  });

  test('ensureArmed() は公開 RPC メソッドとして自己修復ロジックに委譲する', async () => {
    const storage = fakeStorage(null);
    const ctx = fakeCtx(storage);
    const scheduler = new TenantScheduler(ctx as never, {} as never);
    await ctx.ready; // コンストラクタが既にアーム済み

    const armedAtStart = storage.alarm();
    await scheduler.ensureArmed();

    // 既にアーム済みなので ensureArmed() 単体では変化しない（冪等）。
    expect(storage.alarm()).toBe(armedAtStart);
  });
});

describe('実行担当の一本化 — Cron が生きている間は Cron だけ、止まったら DO alarm が代行', () => {
  const minute = Date.UTC(2026, 10, 16, 12, 0);
  const event = { cron: '* * * * *', scheduledTime: minute } as ScheduledEvent;

  function kvStorage() {
    const base = fakeStorage(null);
    const kv = new Map<string, unknown>();
    return Object.assign(base, {
      async get<T>(key: string) { return kv.get(key) as T | undefined; },
      async put(key: string | Record<string, unknown>, value?: unknown) {
        if (typeof key === 'string') kv.set(key, value);
        else for (const [k, v] of Object.entries(key)) kv.set(k, v);
      },
    });
  }
  function fakeCtx(storage: ReturnType<typeof kvStorage>) {
    let ready: Promise<void> = Promise.resolve();
    return {
      storage,
      blockConcurrencyWhile(fn: () => Promise<void>) { ready = fn(); return ready; },
      get ready() { return ready; },
      waitUntil() {},
    };
  }

  test('isCronLive: 窓の内側だけ true、記録なし・未来の値は false', () => {
    expect(isCronLive(null, minute)).toBe(false);
    expect(isCronLive(undefined, minute)).toBe(false);
    expect(isCronLive(minute - 60_000, minute)).toBe(true);
    expect(isCronLive(minute - CRON_LIVENESS_WINDOW_MS + 1, minute)).toBe(true);
    expect(isCronLive(minute - CRON_LIVENESS_WINDOW_MS, minute)).toBe(false);
    expect(isCronLive(minute + 1, minute)).toBe(false);
  });

  test('Cron と alarm が同じ分に鳴っても、ジョブは Cron からの1回だけ (6時間境界は Cron の2本ぶん)', async () => {
    const storage = kvStorage();
    const ctx = fakeCtx(storage);
    const scheduler = new TenantScheduler(ctx as never, {} as never);
    await ctx.ready;
    const env = { TENANT_SCHEDULER: { idFromName: vi.fn(() => 'id'), get: vi.fn(() => scheduler) } };

    // 12:00 UTC は6時間境界。Cron は分足と6時間足の2回呼ぶ。
    await scheduledFromCron(event, env as never, {} as ExecutionContext);
    await scheduledFromCron({ ...event, cron: '0 */6 * * *' } as ScheduledEvent, env as never, {} as ExecutionContext);
    expect(env.TENANT_SCHEDULER.idFromName).toHaveBeenCalledWith(SCHEDULER_INSTANCE_NAME);
    expect(storage.alarm()).not.toBeNull(); // Cron 経由でも alarm は自己修復される

    // 同じ分の alarm はジョブを実行しない (再アームだけ)
    await runSchedulerTick(storage, scheduledMock, new Date(Date.now()), async () => ({ minute: await storage.get<number>(LAST_CRON_TICK_KEY), sixHour: await storage.get<number>(LAST_SIX_HOUR_CRON_TICK_KEY) }));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['* * * * *', '0 */6 * * *']);
    expect(storage.calls.at(-1)).toBe('setAlarm'); // 再アームは続ける
  });

  test('Cron の記録が途絶えたら alarm が従来どおりジョブを実行する (6時間境界も含む)', async () => {
    const storage = kvStorage();
    await storage.put(LAST_CRON_TICK_KEY, minute - CRON_LIVENESS_WINDOW_MS - 1);
    await runSchedulerTick(storage, scheduledMock, new Date(minute), async () => ({ minute: await storage.get<number>(LAST_CRON_TICK_KEY), sixHour: await storage.get<number>(LAST_SIX_HOUR_CRON_TICK_KEY) }));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['* * * * *', '0 */6 * * *']);
  });

  test('5分足 Cron だけの構成でも、6時間保守は alarm が担う (分足ジョブだけ Cron に任せる)', async () => {
    const storage = kvStorage();
    await storage.put(LAST_CRON_TICK_KEY, minute - 30_000); // */5 の Cron は生きている
    await runSchedulerTick(storage, scheduledMock, new Date(minute), async () => ({
      minute: await storage.get<number>(LAST_CRON_TICK_KEY),
      sixHour: await storage.get<number>(LAST_SIX_HOUR_CRON_TICK_KEY),
    }));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['0 */6 * * *']);
  });

  test('6時間足 Cron が前回の境界で来ていれば、境界の alarm は6時間保守を重ねない', async () => {
    const storage = kvStorage();
    await storage.put(LAST_SIX_HOUR_CRON_TICK_KEY, minute - 6 * 60 * 60_000);
    expect(isCronLive(minute - 6 * 60 * 60_000, minute, SIX_HOUR_CRON_LIVENESS_WINDOW_MS)).toBe(true);
    await runSchedulerTick(storage, scheduledMock, new Date(minute), async () => ({
      minute: null,
      sixHour: await storage.get<number>(LAST_SIX_HOUR_CRON_TICK_KEY),
    }));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['* * * * *']);
  });

  function live(storage: ReturnType<typeof kvStorage>) {
    return async () => ({
      minute: await storage.get<number>(LAST_CRON_TICK_KEY),
      sixHour: await storage.get<number>(LAST_SIX_HOUR_CRON_TICK_KEY),
      sixHourSlotDone: await storage.get<number>(SIX_HOUR_SLOT_DONE_KEY),
    });
  }
  const mark = (storage: ReturnType<typeof kvStorage>) => (slot: number) => storage.put(SIX_HOUR_SLOT_DONE_KEY, slot);

  test('6時間足 Cron が 06:00 を最後に止まっても、12:10 以降の alarm で12時の保守を1回だけ取り戻す', async () => {
    const storage = kvStorage();
    const six = Date.UTC(2026, 10, 16, 6, 0);
    await storage.put({ [LAST_SIX_HOUR_CRON_TICK_KEY]: six, [SIX_HOUR_SLOT_DONE_KEY]: sixHourSlot(six) });
    const twelve = Date.UTC(2026, 10, 16, 12, 0);
    const sixHourCalls = () => scheduledMock.mock.calls.filter(([e]) => e.cron === '0 */6 * * *').length;
    // 12:00 時点では 06:00 の記録がまだ有効なので Cron に任せる
    await runSchedulerTick(storage, scheduledMock, new Date(twelve), live(storage), mark(storage));
    expect(sixHourCalls()).toBe(0);
    // 猶予後 (Cron の記録も失効) に取り戻す
    await runSchedulerTick(storage, scheduledMock, new Date(twelve + SIX_HOUR_CATCH_UP_GRACE_MS + 60_000), live(storage), mark(storage));
    expect(sixHourCalls()).toBe(1);
    // 同じスロットでは繰り返さない
    await runSchedulerTick(storage, scheduledMock, new Date(twelve + SIX_HOUR_CATCH_UP_GRACE_MS + 120_000), live(storage), mark(storage));
    expect(sixHourCalls()).toBe(1);
  });

  test('alarm が境界の分を逃しても (DO だけの環境)、猶予後に6時間保守を取り戻す', async () => {
    const storage = kvStorage();
    const twelve = Date.UTC(2026, 10, 16, 12, 0);
    await storage.put(SIX_HOUR_SLOT_DONE_KEY, sixHourSlot(twelve) - 1); // 06時台は実行済み
    await runSchedulerTick(storage, scheduledMock, new Date(twelve + 60_000), live(storage), mark(storage));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['* * * * *']);
    await runSchedulerTick(storage, scheduledMock, new Date(twelve + SIX_HOUR_CATCH_UP_GRACE_MS), live(storage), mark(storage));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['* * * * *', '* * * * *', '0 */6 * * *']);
  });

  test('記録の無い初回 tick がスロット途中なら、6時間保守を余分に走らせない', async () => {
    const storage = kvStorage();
    await runSchedulerTick(storage, scheduledMock, new Date(Date.UTC(2026, 10, 16, 13, 30)), live(storage), mark(storage));
    expect(scheduledMock.mock.calls.map(([e]) => e.cron)).toEqual(['* * * * *']);
  });

  test('Cron の記録が読めなくても alarm はジョブを止めない (安全側)', async () => {
    const storage = fakeStorage();
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    await runSchedulerTick(storage, scheduledMock, new Date(minute + 60_000), async () => { throw new Error('storage down'); });
    expect(scheduledMock).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });

  test('DO バインディングが無い環境では従来どおり Cron がジョブを実行する', async () => {
    await scheduledFromCron(event, {} as never, {} as ExecutionContext);
    expect(scheduledMock).toHaveBeenCalledTimes(1);
    expect(scheduledMock.mock.calls[0][0]).toBe(event);
  });

  test('DO への記録に失敗しても Cron のジョブは止めない', async () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const env = { TENANT_SCHEDULER: { idFromName: vi.fn(), get: () => ({ noteCronTick: async () => { throw new Error('RPC failed'); } }) } };
    await scheduledFromCron(event, env as never, {} as ExecutionContext);
    expect(scheduledMock).toHaveBeenCalledTimes(1);
    consoleError.mockRestore();
  });
});
