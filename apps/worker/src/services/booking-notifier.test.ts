import { describe, expect, test } from 'vitest';
import { renderNotificationText, renderOwnerNotificationText } from './booking-notifier.js';

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
    expect(text).toContain('担当者からの返信をお待ちください');
  });
  test('承認', () => {
    const text = renderNotificationText('approved', ctx);
    expect(text).toContain('予約が確定しました');
    expect(text).toContain('変更・キャンセルはこのトークからご連絡ください');
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

describe('オンライン会議URL', () => {
  const online = { ...ctx, conferenceUrl: 'https://example.zoom.us/j/123456789' };

  test('確定通知に参加URLが載る', () => {
    const text = renderNotificationText('approved', online);
    expect(text).toContain('参加URL:');
    expect(text).toContain('https://example.zoom.us/j/123456789');
  });
  test('前日・当日リマインダにも載る', () => {
    expect(renderNotificationText('day_before', online)).toContain(
      'https://example.zoom.us/j/123456789',
    );
    expect(renderNotificationText('hours_before', online)).toContain(
      'https://example.zoom.us/j/123456789',
    );
  });
  test('対面予約（URLなし）では参加URL行を出さない', () => {
    expect(renderNotificationText('approved', ctx)).not.toContain('参加URL');
    expect(renderNotificationText('day_before', ctx)).not.toContain('参加URL');
  });
  test('リクエスト受付の時点ではURLを出さない（未発行のため）', () => {
    expect(renderNotificationText('requested', online)).not.toContain('参加URL');
  });
});

describe('renderOwnerNotificationText', () => {
  const ownerCtx = { ...ctx, customerName: '佐藤' };

  test('新規予約は相手の名前と日時が入る', () => {
    const text = renderOwnerNotificationText('owner_new_booking', ownerCtx);
    expect(text).toContain('【新規予約】');
    expect(text).toContain('佐藤');
    expect(text).toContain('カット');
    expect(text).toContain('2026-05-10 14:00');
  });
  test('新規予約に会議URLがあれば載る', () => {
    const text = renderOwnerNotificationText('owner_new_booking', {
      ...ownerCtx,
      conferenceUrl: 'https://meet.google.com/abc-defg-hij',
    });
    expect(text).toContain('https://meet.google.com/abc-defg-hij');
  });
  test('キャンセルは取消と分かる文面になる', () => {
    const text = renderOwnerNotificationText('owner_cancelled', ownerCtx);
    expect(text).toContain('【予約キャンセル】');
    expect(text).toContain('佐藤');
  });
});
