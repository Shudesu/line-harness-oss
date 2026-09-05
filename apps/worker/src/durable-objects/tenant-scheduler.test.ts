import { describe, expect, test, vi, beforeEach } from 'vitest';

const scheduledMock = vi.hoisted(() => vi.fn(async () => undefined));
vi.mock('../scheduled.js', () => ({ scheduled: scheduledMock }));

// cloudflare:workers は vitest.config.ts の alias で test-support/cloudflare-workers-stub.ts
// に差し替えられている (Workers ランタイム外では実体を解決できないため)。

import {
  runSchedulerTick,
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

  test('6時間境界 1本目 (分足) が throw しても 2本目 (6時間足) は呼ばれない — ただし次アラームは既に生きている', async () => {
    // scheduled() 内部は個々のジョブを try/catch しているが、runJobs 自体が
    // 想定外の例外を投げるケース (例: D1 接続不可) をここでは検証する。
    // 重要なのは「チェーンが死なない」ことであって、この tick 内で2本目まで
    // 必ず走ることではない — 次 tick で再試行される。
    const storage = fakeStorage();
    const now = new Date('2026-08-23T18:00:00Z'); // 6時間境界
    const runJobs = vi.fn(async () => {
      throw new Error('boom');
    });
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await runSchedulerTick(storage, runJobs, now);

    expect(runJobs).toHaveBeenCalledTimes(1);
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

  test('alarm() は次アラームを先にセットしてから既存の scheduled() を呼ぶ', async () => {
    const storage = fakeStorage(1_700_000_000_000); // コンストラクタの自己修復をスキップさせる
    const ctx = fakeCtx(storage);
    const env = { DB: {} } as never;
    const scheduler = new TenantScheduler(ctx as never, env);
    await ctx.ready;

    const beforeAlarm = storage.alarm();
    await scheduler.alarm();

    expect(storage.alarm()).not.toBe(beforeAlarm); // 再アームされている
    expect(scheduledMock).toHaveBeenCalledTimes(1);
    const [eventArg, envArg] = scheduledMock.mock.calls[0] as unknown as [{ cron: string }, unknown];
    expect(eventArg.cron).toBe('* * * * *');
    expect(envArg).toBe(env);
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
