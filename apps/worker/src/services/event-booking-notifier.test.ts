import { describe, expect, test } from 'vitest';
import { renderEventNotificationMessage, renderEventNotificationText } from './event-booking-notifier.js';

const baseCtx = {
  eventName: 'AAA説明会',
  startsAtJst: '2026-06-01 10:00',
  venueName: '渋谷ベース',
  venueUrl: 'https://maps.example/x',
};

describe('renderEventNotificationText', () => {
  test('受付（承認待ち）', () => {
    const text = renderEventNotificationText('received_pending', baseCtx);
    expect(text).toContain('イベント申し込み予約を受け付けました');
    expect(text).toContain('AAA説明会');
    expect(text).toContain('2026-06-01 10:00');
    expect(text).toContain('運営の承認をお待ちください');
    expect(text).toContain('渋谷ベース');
    expect(text).not.toContain('https://');
  });

  test('受付（即時確定）', () => {
    const text = renderEventNotificationText('received_confirmed', baseCtx);
    expect(text).toContain('予約が確定しました');
    expect(text).toContain('変更・キャンセルは予約履歴画面');
  });

  test('後追い承認確定', () => {
    const text = renderEventNotificationText('confirmed', baseCtx);
    expect(text).toContain('予約が確定しました');
  });

  test('拒否は固定文面（reason は含まない）', () => {
    const text = renderEventNotificationText('rejected', baseCtx);
    expect(text).toContain('既に定員に達してしまっていますので');
    expect(text).toContain('お受けできませんでした');
    expect(text).not.toContain('reason');
  });

  test('運営キャンセル', () => {
    const text = renderEventNotificationText('cancelled_by_admin', baseCtx);
    expect(text).toContain('運営側でイベント予約をキャンセル');
    expect(text).toContain('LINE にてご連絡');
  });

  test('前日リマインダ', () => {
    const text = renderEventNotificationText('reminder_day_before', baseCtx);
    expect(text).toContain('明日イベントが開催');
  });

  test('開始 N 時間前リマインダ', () => {
    const text = renderEventNotificationText('reminder_hours_before', {
      ...baseCtx,
      hoursBefore: 2,
    });
    expect(text).toContain('まもなくイベント開始');
    expect(text).toContain('あと 2 時間');
  });

  test('venue が無くてもクラッシュしない', () => {
    const text = renderEventNotificationText('received_pending', {
      eventName: 'X',
      startsAtJst: '2026-06-01 10:00',
    });
    expect(text).toContain('X');
    expect(text).not.toContain('会場:');
  });

  test('venue_url があっても URL 行は出ない', () => {
    const text = renderEventNotificationText('confirmed', {
      eventName: 'X',
      startsAtJst: '2026-06-01 10:00',
      venueName: '渋谷',
      venueUrl: 'https://maps.example/x',
    });
    expect(text).toContain('会場: 渋谷');
    expect(text).not.toContain('https://');
  });

  test('受付と確定は liffId があれば Flex ボタン付きになる', () => {
    const msg = renderEventNotificationMessage('received_pending', {
      ...baseCtx,
      liffId: '2009763432-eexiWWGf',
    });
    expect(msg.type).toBe('flex');
    if (msg.type !== 'flex') throw new Error('expected flex');
    expect(msg.altText).toBe('イベント申し込み予約を受け付けました');
    const json = JSON.stringify(msg.contents);
    expect(json).toContain('イベント一覧を開く');
    expect(json).toContain('予約履歴を見る');
    expect(json).toContain('page=events');
    expect(json).toContain('page=event-me');
    expect(json).not.toContain('https://maps.example/x');
  });

  test('確定 Flex は青テーマになる', () => {
    const msg = renderEventNotificationMessage('confirmed', {
      ...baseCtx,
      liffId: '2009763432-eexiWWGf',
    });
    expect(msg.type).toBe('flex');
    if (msg.type !== 'flex') throw new Error('expected flex');
    const json = JSON.stringify(msg.contents);
    expect(json).toContain('#2563EB');
    expect(json).toContain('#FFFFFF');
    expect(json).toContain('イベント予約が確定しました');
    expect(json).toContain('イベント一覧を開く');
    expect(json).toContain('予約履歴を見る');
  });

  test('liffId がなければ従来のテキスト通知にフォールバックする', () => {
    const msg = renderEventNotificationMessage('received_pending', baseCtx);
    expect(msg.type).toBe('text');
    if (msg.type !== 'text') throw new Error('expected text');
    expect(msg.text).toContain('イベント申し込み予約を受け付けました');
  });
});
