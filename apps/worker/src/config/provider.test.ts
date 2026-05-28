import { describe, expect, it } from 'vitest';
import { resolveProviderConfig } from './provider.js';

type TestEnv = Parameters<typeof resolveProviderConfig>[0];

function env(bindings: Record<string, unknown> = {}): TestEnv {
  return bindings as TestEnv;
}

function secret(value: string) {
  return { get: async () => value };
}

describe('resolveProviderConfig', () => {
  it('falls back to the generic provider when PROVIDER_ID is not set', async () => {
    const provider = await resolveProviderConfig(env());

    expect(provider.id).toBe('generic');
    expect(provider.displayName).toBe('予約サービス');
    expect(provider.reservation.enableCafeTab).toBe(false);
    expect(provider.externalImport.enabled).toBe(false);
  });

  it('loads the aonisai provider defaults when PROVIDER_ID=aonisai', async () => {
    const provider = await resolveProviderConfig(env({ PROVIDER_ID: 'aonisai' }));

    expect(provider.id).toBe('aonisai');
    expect(provider.displayName).toContain('アオニサイファーム');
    expect(provider.reservation.enableCafeTab).toBe(true);
    expect(provider.externalImport.provider).toBe('jalan');
  });

  it('falls back to generic when PROVIDER_ID is unknown', async () => {
    const provider = await resolveProviderConfig(env({ PROVIDER_ID: 'missing-provider' }));

    expect(provider.id).toBe('generic');
    expect(provider.name).toBe('Generic Reservation Provider');
  });

  it('overrides public branding values from env bindings', async () => {
    const provider = await resolveProviderConfig(env({
      PROVIDER_ID: 'generic',
      PROVIDER_DISPLAY_NAME: 'テスト体験施設',
      PROVIDER_SHORT_NAME: 'テスト施設',
      PROVIDER_PRIMARY_COLOR: '#123456',
      PROVIDER_ACCENT_COLOR: '#abcdef',
      PROVIDER_LOGO_URL: 'https://example.com/logo.webp',
      BOOKING_TITLE: 'テスト予約',
      BOOKING_ENABLE_CAFE_TAB: 'true',
    }));

    expect(provider.displayName).toBe('テスト体験施設');
    expect(provider.shortName).toBe('テスト施設');
    expect(provider.colors.primary).toBe('#123456');
    expect(provider.colors.accent).toBe('#abcdef');
    expect(provider.assets.logoUrl).toBe('https://example.com/logo.webp');
    expect(provider.reservation.title).toBe('テスト予約');
    expect(provider.reservation.enableCafeTab).toBe(true);
  });

  it('resolves Secret Store style bindings and trims values', async () => {
    const provider = await resolveProviderConfig(env({
      PROVIDER_ID: secret(' generic '),
      PROVIDER_DISPLAY_NAME: secret(' Secret Store 予約 '),
      EMAIL_FROM_NAME: secret(' Secret Store 受付 '),
      EXTERNAL_IMPORT_ENABLED: secret(' yes '),
      EXTERNAL_IMPORT_PROVIDER: secret(' custom '),
      EXTERNAL_IMPORT_LABEL: secret(' 外部メール設定 '),
    }));

    expect(provider.id).toBe('generic');
    expect(provider.displayName).toBe('Secret Store 予約');
    expect(provider.email.fromName).toBe('Secret Store 受付');
    expect(provider.externalImport.enabled).toBe(true);
    expect(provider.externalImport.provider).toBe('custom');
    expect(provider.externalImport.label).toBe('外部メール設定');
  });

  it('does not expose unrelated secret bindings in the public provider config shape', async () => {
    const provider = await resolveProviderConfig(env({
      PROVIDER_ID: 'generic',
      API_KEY: 'should-not-leak',
      LINE_CHANNEL_ACCESS_TOKEN: 'line-secret',
      RESEND_API_KEY: 'resend-secret',
    }));
    const serialized = JSON.stringify(provider);

    expect(serialized).not.toContain('should-not-leak');
    expect(serialized).not.toContain('line-secret');
    expect(serialized).not.toContain('resend-secret');
  });
});
