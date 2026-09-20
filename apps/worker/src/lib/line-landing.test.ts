import { describe, expect, it } from 'vitest';
import { renderLineHelp, renderLineMobileLanding, renderLineQrLanding } from './line-landing.js';

const TARGET = 'https://liff.line.me/1234-Test?ref=campaign';

describe('LINE landing presentation', () => {
  it('keeps the QR destination and existing copy', () => {
    const html = renderLineQrLanding(TARGET);
    expect(html).toContain(`data=${encodeURIComponent(TARGET)}`);
    expect(html).toContain('スマートフォンで QR コードを読み取ってください');
    expect(html).toContain('LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます');
    expect(html).toContain('友だち追加で全機能を無料体験できます');
    expect(renderLineQrLanding(TARGET, false)).not.toContain('footer');
  });

  it.each(['iPhone', 'iPad', 'iPod'])('offers the iOS long-press hint on %s', (ua) => {
    const html = renderLineMobileLanding(ua, TARGET, '/r/campaign/help');
    expect(html).toContain('友達追加して始める');
    expect(html).toContain(`href="${TARGET}"`);
    expect(html).toContain('<strong>長押し</strong>');
    expect(html).toContain('href="/r/campaign/help"');
  });

  it('keeps the Android intent and HTTPS fallback', () => {
    const html = renderLineMobileLanding('Android Mobile', TARGET);
    expect(html).toContain('href="intent://liff.line.me/1234-Test?ref=campaign#Intent;');
    expect(html).toContain('package=jp.naver.line.android;');
    expect(html).toContain(`S.browser_fallback_url=${encodeURIComponent(TARGET)};end`);
    expect(html).not.toContain('長押し');
    expect(html).not.toContain('class="help"');
    expect(html).not.toContain('.help');
  });

  it.each([
    ['iPhone', 'Safari', true],
    ['Android', 'Chrome', false],
    ['Desktop', 'ブラウザ（iPhoneは Safari／Androidは Chrome）', false],
  ] as const)('keeps the help instructions for %s', (ua, browser, longPress) => {
    const html = renderLineHelp(ua, TARGET);
    expect(html).toContain(`${browser}で開く`);
    expect(html.includes('長押しで開く（最も簡単）')).toBe(longPress);
    expect(html).toContain(`data-url="${TARGET}"`);
    expect(html).toContain('navigator.clipboard.writeText');
  });
});
