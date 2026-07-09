import { describe, expect, test } from 'vitest';
import { getBookingTemplates, renderNotificationText } from './booking-notifier.js';

const ctx = {
  menuName: 'カット',
  staffName: '山田',
  startsAtJst: '2026-05-10 14:00',
  hoursBefore: 2,
};

describe('renderNotificationText', () => {
  test('テンプレートのプレースホルダを置換する', () => {
    const text = renderNotificationText('requested', ctx, {
      requested: '内容:{menu} / 担当:{staff} / 日時:{datetime} / 残り:{hours}h / 再掲:{menu}',
    });
    expect(text).toBe('内容:カット / 担当:山田 / 日時:2026-05-10 14:00 / 残り:2h / 再掲:カット');
  });

  test('テンプレート未設定・空文字は既定文言にフォールバックする', () => {
    expect(renderNotificationText('approved', ctx, {})).toBe(renderNotificationText('approved', ctx));
    expect(renderNotificationText('approved', ctx, { approved: '' })).toBe(
      renderNotificationText('approved', ctx),
    );
  });

  test('受付', () => {
    const text = renderNotificationText('requested', ctx);
    expect(text).toContain('予約リクエストを受け付けました');
    expect(text).toContain('カット');
    expect(text).toContain('山田');
    expect(text).toContain('2026-05-10 14:00');
    expect(text).toContain('お店からの返信をお待ちください');
  });
  test('承認', () => {
    const text = renderNotificationText('approved', ctx);
    expect(text).toContain('予約が確定しました');
    expect(text).toContain('変更・キャンセルはお店に直接ご連絡ください');
  });
  test('拒否', () => {
    expect(renderNotificationText('rejected', ctx)).toContain('お取りできませんでした');
  });
  test('期限切れ', () => {
    expect(renderNotificationText('expired', ctx)).toContain('期限切れ');
  });
  test('前日リマインダ', () => {
    expect(renderNotificationText('day_before', ctx)).toContain('明日のご予約');
  });
  test('当日 N 時間前', () => {
    const t = renderNotificationText('hours_before', ctx);
    expect(t).toContain('本日のご予約まであと 2 時間');
  });
});

describe('getBookingTemplates', () => {
  function dbWithValue(value: string | null): D1Database {
    return {
      prepare: () => ({
        bind: () => ({
          first: async () => (value === null ? null : { value }),
        }),
      }),
    } as unknown as D1Database;
  }

  test('保存済みJSONから既知キーだけ返す', async () => {
    const db = dbWithValue(JSON.stringify({
      requested: '受付 {menu}',
      approved: '',
      unknown: 'ignored',
    }));
    await expect(getBookingTemplates(db, 'acc1')).resolves.toEqual({ requested: '受付 {menu}' });
  });

  test('JSON不正や読込エラーは空オブジェクトで返す', async () => {
    await expect(getBookingTemplates(dbWithValue('{bad'), 'acc1')).resolves.toEqual({});
    const failingDb = {
      prepare: () => {
        throw new Error('D1 unavailable');
      },
    } as unknown as D1Database;
    await expect(getBookingTemplates(failingDb, 'acc1')).resolves.toEqual({});
  });
});
