import { describe, expect, it } from 'vitest';
import { providerConfig } from './provider-config.js';

type JsonResponse = {
  success: boolean;
  data?: {
    id: string;
    displayName: string;
    reservation: {
      title: string;
      enableCafeTab: boolean;
    };
    externalImport: {
      enabled: boolean;
      provider: string;
      label: string;
    };
  };
  error?: string;
};

function secret(value: string) {
  return { get: async () => value };
}

describe('GET /api/public/provider-config', () => {
  it('returns public provider config without authorization', async () => {
    const res = await providerConfig.request('/api/public/provider-config', undefined, {
      PROVIDER_ID: 'aonisai',
    });
    const body = await res.json<JsonResponse>();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.id).toBe('aonisai');
    expect(body.data?.displayName).toContain('アオニサイファーム');
    expect(body.data?.reservation.enableCafeTab).toBe(true);
  });

  it('applies environment overrides and Secret Store style bindings', async () => {
    const res = await providerConfig.request('/api/public/provider-config', undefined, {
      PROVIDER_ID: secret('generic'),
      PROVIDER_DISPLAY_NAME: secret('テスト予約施設'),
      BOOKING_TITLE: secret('テスト予約画面'),
      EXTERNAL_IMPORT_ENABLED: secret('true'),
      EXTERNAL_IMPORT_PROVIDER: secret('custom'),
      EXTERNAL_IMPORT_LABEL: secret('外部メール取り込み'),
    });
    const body = await res.json<JsonResponse>();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.data?.id).toBe('generic');
    expect(body.data?.displayName).toBe('テスト予約施設');
    expect(body.data?.reservation.title).toBe('テスト予約画面');
    expect(body.data?.externalImport).toMatchObject({
      enabled: true,
      provider: 'custom',
      label: '外部メール取り込み',
    });
  });

  it('does not leak unrelated secret values in the public response', async () => {
    const res = await providerConfig.request('/api/public/provider-config', undefined, {
      PROVIDER_ID: 'generic',
      API_KEY: 'api-secret',
      LINE_CHANNEL_ACCESS_TOKEN: 'line-secret',
      RESEND_API_KEY: 'resend-secret',
    });
    const text = await res.text();

    expect(res.status).toBe(200);
    expect(text).not.toContain('api-secret');
    expect(text).not.toContain('line-secret');
    expect(text).not.toContain('resend-secret');
  });
});
