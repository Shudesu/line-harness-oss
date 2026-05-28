import { beforeEach, describe, expect, it, vi } from 'vitest';

function escapeForHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function installMinimalDom() {
  vi.stubGlobal('window', { location: { search: '' } });
  vi.stubGlobal('document', {
    createElement: () => {
      let value = '';
      return {
        set textContent(next: string) {
          value = String(next ?? '');
        },
        get innerHTML() {
          return escapeForHtml(value);
        },
      };
    },
  });
}

describe('booking UI provider rendering', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.unstubAllGlobals();
    installMinimalDom();
  });

  it('uses generic fallback provider by default and does not render AONISAI specific header content', async () => {
    const [{ state }, { renderHeader }] = await Promise.all([
      import('../client/booking/state.js'),
      import('../client/booking/render.js'),
    ]);

    const html = renderHeader();

    expect(state.provider.id).toBe('generic');
    expect(html).toContain('Generic Reservation Provider');
    expect(html).toContain('<h1>予約</h1>');
    expect(html).not.toContain('アオニサイ');
    expect(html).not.toContain('/aonisai/');
    expect(html).not.toContain('data-action="show-cafe"');
  });

  it('renders provider header values and cafe tab only when enabled', async () => {
    const [{ state }, { renderHeader }] = await Promise.all([
      import('../client/booking/state.js'),
      import('../client/booking/render.js'),
    ]);
    state.provider = {
      ...state.provider,
      id: 'custom',
      name: 'CUSTOM FARM',
      displayName: 'カスタム農園',
      shortName: 'カスタム',
      assets: {
        ...state.provider.assets,
        logoUrl: 'https://example.com/logo.webp',
      },
      reservation: {
        ...state.provider.reservation,
        title: '収穫体験予約',
        enableCafeTab: true,
      },
    };

    const html = renderHeader();

    expect(html).toContain('CUSTOM FARM');
    expect(html).toContain('収穫体験予約');
    expect(html).toContain('https://example.com/logo.webp');
    expect(html).toContain('alt="カスタム農園"');
    expect(html).toContain('data-action="show-cafe"');
  });

  it('does not render AONISAI cafe content for non-aonisai providers', async () => {
    const [{ state }, { renderScreen }] = await Promise.all([
      import('../client/booking/state.js'),
      import('../client/booking/render.js'),
    ]);
    state.screen = 'cafe';
    state.provider = {
      ...state.provider,
      id: 'custom',
      shortName: 'カスタム',
      description: 'カスタム施設の説明です。',
      reservation: {
        ...state.provider.reservation,
        enableCafeTab: true,
      },
    };

    const html = renderScreen();

    expect(html).toContain('カスタム施設の説明です。');
    expect(html).not.toContain('アオニサイカフェ');
    expect(html).not.toContain('ブルーベリーピザ');
    expect(html).not.toContain('/aonisai/cafe/');
  });
});
