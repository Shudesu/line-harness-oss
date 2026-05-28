import { describe, expect, it } from 'vitest';
import { aonisaiProviderConfig } from './aonisai/config.js';
import { getReservationEmailTemplate } from './email-templates.js';
import { genericProviderConfig } from './generic/config.js';
import type { ReservationEmailTemplateInput } from './email-types.js';

const reservation = {
  id: 'res_123',
  customerName: '山田 太郎',
  customerPhone: '09012345678',
  customerEmail: 'taro@example.com',
  reservationDate: '2026-06-14',
  dateLabel: '2026年6月14日',
  startTimeLabel: '12:00',
  timeLabel: '12:00-13:00',
  peopleLabel: '大人2名 / 小学生1名',
  adultCount: 2,
  childCount: 1,
  infantCount: 0,
  underThreeCount: 0,
};

const urls = {
  detailUrl: 'https://example.com/book/detail?token=detail',
  cancelUrl: 'https://example.com/book/cancel?token=cancel',
  lineClaimUrl: 'https://liff.line.me/claim',
  manageUrl: 'https://admin.example.com/reservation-ops',
};

function input(provider = genericProviderConfig): ReservationEmailTemplateInput {
  return { provider, reservation, urls };
}

describe('reservation email templates', () => {
  it('falls back to the generic email template for unknown provider ids', () => {
    const rendered = getReservationEmailTemplate('unknown').confirmation(input());

    expect(rendered.subject).toContain('【予約受付】');
    expect(rendered.html).toContain(genericProviderConfig.name);
    expect(rendered.html).toContain(genericProviderConfig.colors.primary);
    expect(rendered.text).toContain('予約番号: res_123');
  });

  it('renders required reservation details and URLs in generic confirmation email', () => {
    const rendered = getReservationEmailTemplate('generic').confirmation(input());

    expect(rendered.html).toContain('山田 太郎');
    expect(rendered.html).toContain('2026年6月14日');
    expect(rendered.html).toContain('12:00-13:00');
    expect(rendered.html).toContain('大人2名 / 小学生1名');
    expect(rendered.html).toContain(urls.detailUrl);
    expect(rendered.html).toContain(urls.cancelUrl);
    expect(rendered.html).toContain(urls.lineClaimUrl);
    expect(rendered.html).toContain(urls.manageUrl);
    expect(rendered.text).toContain(urls.detailUrl);
    expect(rendered.text).toContain(urls.cancelUrl);
    expect(rendered.text).toContain(urls.lineClaimUrl);
  });

  it('uses provider colors, hero image, contact footer, address and phone', () => {
    const provider = {
      ...genericProviderConfig,
      address: '東京都テスト区1-2-3',
      phone: '0312345678',
      colors: {
        ...genericProviderConfig.colors,
        primary: '#112233',
        background: '#fefefe',
        text: '#010203',
      },
      assets: {
        ...genericProviderConfig.assets,
        heroImageUrl: 'https://example.com/hero.webp',
      },
      email: {
        ...genericProviderConfig.email,
        footerText: 'テスト予約センター',
      },
    };
    const rendered = getReservationEmailTemplate('generic').confirmation(input(provider));

    expect(rendered.html).toContain('#112233');
    expect(rendered.html).toContain('#fefefe');
    expect(rendered.html).toContain('#010203');
    expect(rendered.html).toContain('https://example.com/hero.webp');
    expect(rendered.html).toContain('テスト予約センター');
    expect(rendered.html).toContain('東京都テスト区1-2-3');
    expect(rendered.html).toContain('0312345678');
  });

  it('escapes user-controlled values in HTML output', () => {
    const rendered = getReservationEmailTemplate('generic').confirmation(input({
      ...genericProviderConfig,
      name: '<script>alert(1)</script>',
    }));

    expect(rendered.html).not.toContain('<script>alert(1)</script>');
    expect(rendered.html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
  });

  it('uses the aonisai email template for PROVIDER_ID=aonisai', () => {
    const rendered = getReservationEmailTemplate('aonisai').confirmation(input(aonisaiProviderConfig));

    expect(rendered.html).toContain('AONISAI FARM');
    expect(rendered.html).toContain('アオニサイファーム ブルーベリー観光農園');
    expect(rendered.html).toContain('/aonisai/cafe/cafe-hero.webp');
  });
});
