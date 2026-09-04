import { describe, expect, test } from 'vitest';
import {
  renderNotificationText,
  renderStaffNotificationText,
  resolveStaffRecipients,
} from './booking-notifier.js';

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
    expect(renderNotificationText('day_before', ctx)).toContain('明日のご予約');
  });
  test('当日 N 時間前', () => {
    const t = renderNotificationText('hours_before', ctx);
    expect(t).toContain('本日のご予約まであと 2 時間');
  });
});

describe('renderStaffNotificationText', () => {
  const ctx = {
    menuName: 'カット',
    staffName: '山田',
    startsAtJst: '2026-05-10 14:00',
    hoursBefore: 0,
    customerName: '佐藤 花子',
  };

  test('顧客名・メニュー・担当・日時が入る', () => {
    const text = renderStaffNotificationText(ctx);
    expect(text).toContain('新しい予約リクエスト');
    expect(text).toContain('佐藤 花子');
    expect(text).toContain('カット');
    expect(text).toContain('山田');
    expect(text).toContain('2026-05-10 14:00');
  });

  test('24 時間で期限切れになることを明示する', () => {
    // 承認制の放置事故を防ぐのが主目的なので、この一文は落とさない
    expect(renderStaffNotificationText(ctx)).toContain('24 時間');
  });

  test('adminUrl を渡すと導線が付く', () => {
    const text = renderStaffNotificationText({ ...ctx, adminUrl: 'https://admin.example.com' });
    expect(text).toContain('https://admin.example.com');
  });
});

describe('resolveStaffRecipients', () => {
  test('指名スタッフ + アカウント共通を結合する', () => {
    expect(resolveStaffRecipients('f1', '["f2","f3"]')).toEqual(['f1', 'f2', 'f3']);
  });

  test('重複を除き、指名スタッフを先頭に保つ', () => {
    expect(resolveStaffRecipients('f1', '["f2","f1"]')).toEqual(['f1', 'f2']);
  });

  test('宛先未設定なら空 — 既定で通知しない', () => {
    expect(resolveStaffRecipients(null, null)).toEqual([]);
    expect(resolveStaffRecipients(undefined, '[]')).toEqual([]);
  });

  test('設定が壊れていても例外にしない（予約自体は成功させる）', () => {
    expect(resolveStaffRecipients('f1', 'not json')).toEqual(['f1']);
    expect(resolveStaffRecipients(null, '{"a":1}')).toEqual([]);
    expect(resolveStaffRecipients(null, '["ok", 42, null]')).toEqual(['ok']);
  });
});
