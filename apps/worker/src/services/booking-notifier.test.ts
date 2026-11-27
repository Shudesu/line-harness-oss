import { describe, expect, test } from 'vitest';
import { renderNotificationText } from './booking-notifier.js';

const ctx = {
  menuName: 'カット',
  staffName: '山田',
  startsAtJst: '2026-05-10 14:00',
  hoursBefore: 2,
};

describe('renderNotificationText', () => {
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
    expect(renderNotificationText('day_before', ctx)).toContain('ご予約のお知らせ');
  });
  test('当日 N 時間前', () => {
    const t = renderNotificationText('hours_before', ctx);
    expect(t).toContain('ご予約の開始前のお知らせ');
  });
  test.each([
    ['day_before', '明日'], ['hours_before', 'あと 2 時間'],
  ] as const)('遅れて当日17時に処理した %s 通知は18時開始の日時で案内する', (kind, misleading) => {
    const text = renderNotificationText(kind, { ...ctx, startsAtJst: '2026-08-10 18:00' });
    expect(text).toContain('日時: 2026-08-10 18:00');
    expect(text).toContain('メニュー: カット');
    expect(text).toContain('担当: 山田');
    expect(text).not.toContain(misleading);
  });

});
