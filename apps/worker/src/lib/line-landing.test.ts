import { describe, expect, it } from 'vitest';
import {
  DEFAULT_LANDING_TEXTS,
  LANDING_TEXT_MAX_LENGTH,
  parseLandingTexts,
  resolveLandingTexts,
  validateLandingTexts,
} from '@line-crm/shared';
import { renderLineHelp, renderLineMobileLanding, renderLineQrLanding } from './line-landing.js';

const TARGET = 'https://liff.line.me/1234-Test?ref=campaign';
const texts = (override: Record<string, string>) => resolveLandingTexts(override);

describe('landing copy resolution', () => {
  it('falls back to the defaults when nothing is stored', () => {
    expect(resolveLandingTexts(null)).toEqual(DEFAULT_LANDING_TEXTS);
    expect(resolveLandingTexts({})).toEqual(DEFAULT_LANDING_TEXTS);
  });

  it('uses a stored override and keeps untouched slots on their default', () => {
    const resolved = resolveLandingTexts({ qrFooter: '勉強会のご案内です' });
    expect(resolved.qrFooter).toBe('勉強会のご案内です');
    expect(resolved.qrHeading).toBe(DEFAULT_LANDING_TEXTS.qrHeading);
  });

  it('treats an empty string as an explicit hide, not as "unset"', () => {
    expect(resolveLandingTexts({ qrHeading: '' }).qrHeading).toBe('');
  });
});

describe('landing copy rows', () => {
  it('drops a malformed row instead of taking the public page down', () => {
    for (const raw of ['not json', '[]', 'null', '"text"', '123']) {
      expect(parseLandingTexts(raw)).toEqual({});
    }
    expect(parseLandingTexts(null)).toEqual({});
  });

  it('drops unknown keys and over-long values from a stored row', () => {
    const row = JSON.stringify({
      qrFooter: 'ok',
      qrHeading: 'x'.repeat(LANDING_TEXT_MAX_LENGTH + 1),
      bogus: 'ignored',
    });
    expect(parseLandingTexts(row)).toEqual({ qrFooter: 'ok' });
  });

  it('rejects writes that would store a bad row', () => {
    expect(validateLandingTexts({ bogus: 'x' }).ok).toBe(false);
    expect(validateLandingTexts({ qrFooter: 1 }).ok).toBe(false);
    expect(validateLandingTexts({ qrFooter: 'x'.repeat(LANDING_TEXT_MAX_LENGTH + 1) }).ok).toBe(false);
    expect(validateLandingTexts([]).ok).toBe(false);
    expect(validateLandingTexts(null).ok).toBe(false);
    // An empty string is a valid write: it hides that line.
    expect(validateLandingTexts({ qrFooter: '', mobileHeading: 'ok' })).toEqual({
      ok: true,
      value: { qrFooter: '', mobileHeading: 'ok' },
    });
  });
});

describe('QR landing rendering', () => {
  it('renders the defaults when the caller passes no overrides', () => {
    const html = renderLineQrLanding(TARGET);
    expect(html).toContain(DEFAULT_LANDING_TEXTS.qrHeading);
    expect(html).toContain('<p class="footer">友だち追加で全機能を無料体験できます</p>');
  });

  it('drops the element when a slot is hidden, leaving no empty paragraph', () => {
    const html = renderLineQrLanding(TARGET, texts({ qrHeading: '' }));
    expect(html).not.toContain('class="msg"');
    expect(html).toContain('class="hint"');
  });

  it('escapes operator input so copy cannot inject markup', () => {
    const html = renderLineQrLanding(TARGET, texts({ qrFooter: '<img src=x onerror=alert(1)>"&\'' }));
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;img src=x onerror=alert(1)&gt;&quot;&amp;&#39;');
  });

  it('renders newlines in operator input as line breaks', () => {
    expect(renderLineQrLanding(TARGET, texts({ qrFooter: '1行目\n2行目' }))).toContain(
      '<p class="footer">1行目<br>2行目</p>',
    );
  });

  it('keeps the QR target on the page', () => {
    expect(renderLineQrLanding(TARGET)).toContain(encodeURIComponent(TARGET));
  });
});

describe('mobile landing rendering', () => {
  it('renders the default heading and the launch button', () => {
    const html = renderLineMobileLanding('iPhone', TARGET, '/help');
    expect(html).toContain(`<p class="msg">${DEFAULT_LANDING_TEXTS.mobileHeading}</p>`);
    expect(html).toContain('LINEで開く');
  });

  it('applies an override and escapes it', () => {
    const html = renderLineMobileLanding('iPhone', TARGET, '/help', texts({ mobileHeading: '<b>ご登録</b>' }));
    expect(html).toContain('&lt;b&gt;ご登録&lt;/b&gt;');
    expect(html).not.toContain('<b>ご登録</b>');
  });

  it('drops the heading when it is hidden, keeping the button', () => {
    const html = renderLineMobileLanding('iPhone', TARGET, '/help', texts({ mobileHeading: '' }));
    expect(html).not.toContain('class="msg"');
    expect(html).toContain('class="btn"');
  });
});

describe('LINE landing presentation', () => {
  it('keeps the QR destination and existing copy', () => {
    const html = renderLineQrLanding(TARGET);
    expect(html).toContain(`data=${encodeURIComponent(TARGET)}`);
    expect(html).toContain('スマートフォンで QR コードを読み取ってください');
    expect(html).toContain('LINE アプリのカメラまたは<br>スマートフォンのカメラで読み取れます');
    expect(html).toContain('友だち追加で全機能を無料体験できます');
  });

  it.each(['iPhone', 'iPad', 'iPod'])('offers the iOS long-press hint on %s', (ua) => {
    const html = renderLineMobileLanding(ua, TARGET, '/r/campaign/help');
    expect(html).toContain('<p class="msg">LINE で開く</p>');
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

// State table: each slot is independently default / custom / hidden.
describe('landing text state table', () => {
  it.each(['qrHeading', 'qrHint', 'qrFooter', 'mobileHeading'] as const)('normalizes and bounds %s', (key) => {
    expect(validateLandingTexts({ [key]: '　 \t\r\n' })).toEqual({ ok: true, value: { [key]: '' } });
    expect(validateLandingTexts({ [key]: 'x'.repeat(200) }).ok).toBe(true);
    expect(validateLandingTexts({ [key]: 'x'.repeat(201) }).ok).toBe(false);
    expect(validateLandingTexts({ [key]: '\u{1F600}'.repeat(100) }).ok).toBe(true);
    expect(validateLandingTexts({ [key]: '\u{1F600}'.repeat(101) }).ok).toBe(false);
    expect(parseLandingTexts(JSON.stringify({ [key]: 123 }))).toEqual({});
    expect(resolveLandingTexts(parseLandingTexts(JSON.stringify({ [key]: 'x'.repeat(201) })))[key]).toBe(DEFAULT_LANDING_TEXTS[key]);
  });

  it.each(['\n', '\r\n', '\r'])('renders each newline convention %j safely', (newline) => {
    const html = renderLineQrLanding(TARGET, texts({ qrHint: `one${newline}<script>two</script>` }));
    expect(html).toContain('<p class="hint">one<br>&lt;script&gt;two&lt;/script&gt;</p>');
  });

  it('hides all empty or whitespace-only slots without hiding the QR or button', () => {
    const empty = texts({ qrHeading: '', qrHint: '　 ', qrFooter: '\t', mobileHeading: '\n' });
    const qr = renderLineQrLanding(TARGET, empty);
    expect(qr).not.toMatch(/<p class="(?:msg|hint|footer)"/);
    expect(qr).toContain('alt="QR Code"');
    const mobile = renderLineMobileLanding('Mobile', TARGET, undefined, empty);
    expect(mobile).not.toContain('class="msg"');
    expect(mobile).toContain('class="btn"');
    expect(mobile).not.toContain('class="hint"');
  });

  it('escapes URL attributes while retaining their decoded destination', () => {
    const html = renderLineMobileLanding('iPhone', TARGET + '&id="quoted"', '/help?a=1&b="2"');
    expect(html).toContain('&amp;id=&quot;quoted&quot;');
    expect(html).toContain('href="/help?a=1&amp;b=&quot;2&quot;"');
  });
});
