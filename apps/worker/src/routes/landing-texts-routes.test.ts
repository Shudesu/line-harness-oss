import { DEFAULT_LANDING_TEXTS } from '@line-crm/shared';
// Stored copy reaches every landing branch; invalid writes never clear settings.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const dbMocks = {
  getLandingTextsJson: vi.fn().mockResolvedValue(null),
  setLandingTextsJson: vi.fn().mockResolvedValue(undefined),
  getLinkBaseUrl: vi.fn().mockResolvedValue(null),
  setLinkBaseUrl: vi.fn().mockResolvedValue(undefined),
  getTrackedLinkBaseUrl: vi.fn().mockResolvedValue(null),
  setTrackedLinkBaseUrl: vi.fn().mockResolvedValue(undefined),
  getLineAccounts: vi.fn().mockResolvedValue([]),
  getStaffByApiKey: vi.fn(),
  recoverStalledBroadcasts: vi.fn(),
  recoverStuckDeliveries: vi.fn(),
  getEntryRouteByRefCode: vi.fn().mockResolvedValue(null),
  recordRefTracking: vi.fn().mockResolvedValue(undefined),
  getAffiliateLinkByRefCode: vi.fn().mockResolvedValue(null),
  incrementAffiliateLinkClick: vi.fn().mockResolvedValue(undefined),
  getTrafficPoolBySlug: vi.fn().mockResolvedValue(null),
  getTrafficPoolById: vi.fn().mockResolvedValue(null),
  getRandomPoolAccount: vi.fn().mockResolvedValue(null),
  getPoolAccounts: vi.fn().mockResolvedValue([]),
  getLineAccountById: vi.fn().mockResolvedValue(null),
  getLineAccountByChannelId: vi.fn().mockResolvedValue(null),
  jstNow: () => '2026-09-19 00:00:00',
};
vi.mock('@line-crm/db', () => dbMocks);

const worker = (await import('../index.js')).default;

const API_KEY = 'landing-texts-test-key';
const DESKTOP_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15';
const MOBILE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15';

const DB = {} as D1Database;
const env = {
  DB,
  API_KEY,
  LINE_LOGIN_CHANNEL_ID: '1234567890',
  LIFF_URL: 'https://liff.line.me/1000000000-DefaultAA',
} as unknown as import('../index.js').Env['Bindings'];

const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;

const open = (path: string, ua: string) =>
  worker.fetch(
    new Request(`https://worker.example.com${path}`, { headers: { 'user-agent': ua } }),
    env,
    ctx,
  );

const put = (body: BodyInit | undefined) =>
  worker.fetch(
    new Request('https://worker.example.com/api/account-settings/landing-texts', {
      method: 'PUT',
      headers: { Authorization: `Bearer ${API_KEY}`, 'Content-Type': 'application/json' },
      body,
    }),
    env,
    ctx,
  );

beforeEach(() => {
  vi.clearAllMocks();
  dbMocks.getLineAccounts.mockResolvedValue([]);
  dbMocks.getLandingTextsJson.mockReset().mockResolvedValue(null);
});

describe('/r/:ref — stored landing copy reaches both device branches', () => {
  it('applies the stored copy on the PC branch', async () => {
    dbMocks.getLandingTextsJson.mockResolvedValueOnce(
      JSON.stringify({ qrFooter: '勉強会のご案内', qrHeading: '' }),
    );
    const res = await open('/r/campaign', DESKTOP_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="footer">勉強会のご案内</p>');
    // An empty override hides the heading outright.
    expect(html).not.toContain('class="msg"');
  });

  it('applies the stored copy on the mobile branch', async () => {
    dbMocks.getLandingTextsJson.mockResolvedValueOnce(
      JSON.stringify({ mobileHeading: '勉強会に参加する' }),
    );
    const res = await open('/r/campaign', MOBILE_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="msg">勉強会に参加する</p>');
    expect(html).toContain('class="btn"');
  });

  it('falls back to the defaults when nothing is stored', async () => {
    const res = await open('/r/campaign', DESKTOP_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('スマートフォンで QR コードを読み取ってください');
    expect(html).toContain('<p class="footer">友だち追加で全機能を無料体験できます</p>');
  });
});

describe('/o — the explicit-liffId wrapper renders the same pages as /r', () => {
  const LIFF_ID = '1234567890-AbCdEfGh';

  it('applies the stored copy on the PC branch', async () => {
    dbMocks.getLandingTextsJson.mockResolvedValueOnce(
      JSON.stringify({ qrFooter: '勉強会のご案内', qrHeading: '' }),
    );
    const res = await open(`/o?liffId=${LIFF_ID}&page=event&id=42`, DESKTOP_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('<p class="footer">勉強会のご案内</p>');
    expect(html).not.toContain('class="msg"');
    // The QR still points at the explicit LIFF with its passthrough params.
    expect(decodeURIComponent(/data=([^"]+)"/.exec(html)![1])).toBe(
      `https://liff.line.me/${LIFF_ID}?liffId=${LIFF_ID}&page=event&id=42`,
    );
  });

  it('applies the mobile copy without adding a help route', async () => {
    dbMocks.getLandingTextsJson.mockResolvedValueOnce(JSON.stringify({ mobileHeading: '勉強会に参加する' }));
    const html = await (await open(`/o?liffId=${LIFF_ID}`, MOBILE_UA)).text();
    expect(html).toContain('<p class="msg">勉強会に参加する</p>');
    expect(html).not.toContain('class="help"');
  });

  it('uses the shared default heading on mobile (was "LINE で開く" before the merge)', async () => {
    const html = await (await open(`/o?liffId=${LIFF_ID}`, MOBILE_UA)).text();
    expect(html).toContain('<p class="msg">友達追加して始める</p>');
    expect(html).toContain('class="btn"');
  });

  it('falls back to the defaults when the copy row is unreadable', async () => {
    dbMocks.getLandingTextsJson.mockRejectedValueOnce(new Error('D1 unavailable'));
    const res = await open(`/o?liffId=${LIFF_ID}`, DESKTOP_UA);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain('スマートフォンで QR コードを読み取ってください');
  });

  it('still rejects a malformed liffId', async () => {
    expect((await open('/o?liffId=not-a-liff', DESKTOP_UA)).status).toBe(400);
  });
});

describe('PUT /api/account-settings/landing-texts — a bad write must not clear the row', () => {
  it.each([
    ['empty body', undefined],
    ['broken JSON', '{'],
    ['array', '[]'],
    ['number', '42'],
    ['null body', 'null'],
    ['boolean', 'true'],
    ['string body', '"text"'],
    ['array value', '{"value":[]}'],
    ['over limit', JSON.stringify({ value: { qrFooter: 'x'.repeat(201) } })],
    ['missing value', '{}'],
    ['null value', '{"value":null}'],
    ['unknown key', '{"value":{"bogus":"x"}}'],
    ['non-string value', '{"value":{"qrFooter":1}}'],
  ])('rejects %s with 400 and writes nothing', async (_label, body) => {
    const res = await put(body as BodyInit | undefined);
    expect(res.status).toBe(400);
    expect(dbMocks.setLandingTextsJson).not.toHaveBeenCalled();
  });

  it('stores a valid write', async () => {
    const res = await put(JSON.stringify({ value: { qrFooter: 'ご案内' } }));
    expect(res.status).toBe(200);
    expect(dbMocks.setLandingTextsJson).toHaveBeenCalledWith(DB, JSON.stringify({ qrFooter: 'ご案内' }));
  });

  it('accepts an explicit reset to the defaults', async () => {
    const res = await put(JSON.stringify({ value: {} }));
    expect(res.status).toBe(200);
    expect(dbMocks.setLandingTextsJson).toHaveBeenCalledWith(DB, '{}');
  });

  it('normalises a whitespace-only value to "hidden"', async () => {
    const res = await put(JSON.stringify({ value: { qrFooter: '　 ' } }));
    expect(res.status).toBe(200);
    expect(dbMocks.setLandingTextsJson).toHaveBeenCalledWith(DB, JSON.stringify({ qrFooter: '' }));
  });
});

// Every rendered slot is covered through each public route, not just its helper.
describe.each([
  ['/r/campaign', DESKTOP_UA],
  ['/o?liffId=1234567890-AbCdEfGh', DESKTOP_UA],
  ['/auth/line?ref=campaign', DESKTOP_UA],
  ['/r/campaign', MOBILE_UA],
  ['/o?liffId=1234567890-AbCdEfGh', MOBILE_UA],
])('%s with a malformed stored row (%s)', (path, ua) => {
  it.each(['{', 'null', '[]', '{"qrHeading":42,"mobileHeading":false}'])('uses defaults for %s', async (raw) => {
    dbMocks.getLandingTextsJson.mockResolvedValueOnce(raw);
    const res = await open(path, ua);
    expect(res.status).toBe(200);
    expect(await res.text()).toContain(ua === DESKTOP_UA ? DEFAULT_LANDING_TEXTS.qrHeading : DEFAULT_LANDING_TEXTS.mobileHeading);
    expect(dbMocks.getLandingTextsJson).toHaveBeenCalledTimes(1);
  });
});

describe.each(['/r/campaign', '/o?liffId=1234567890-AbCdEfGh', '/auth/line?ref=campaign'])('%s PC settings', (path) => {
  it.each(['default', 'custom', 'hidden'] as const)('%s for all three PC slots', async (state) => {
    const keys = ['qrHeading', 'qrHint', 'qrFooter'] as const;
    const classes = ['msg', 'hint', 'footer'];
    const stored = state === 'default' ? {} : Object.fromEntries(keys.map(key => [key, state === 'hidden' ? '' : `<script>${key}</script>\n案内`]));
    dbMocks.getLandingTextsJson.mockResolvedValueOnce(JSON.stringify(stored));
    const res = await open(path, DESKTOP_UA);
    expect(res.status).toBe(200);
    const html = await res.text();
    keys.forEach((key, index) => {
      if (state === 'hidden') expect(html).not.toContain(`<p class="${classes[index]}"`);
      else if (state === 'default') expect(html).toContain(DEFAULT_LANDING_TEXTS[key].replace(/\n/g, '<br>'));
      else expect(html).toContain(`&lt;script&gt;${key}&lt;/script&gt;<br>案内`);
    });
    expect(html).not.toContain('<script>');
    expect(html).toContain('/api/qr?size=240x240&data=');
    expect(dbMocks.getLandingTextsJson).toHaveBeenCalledTimes(1);
  });
});

describe.each(['/r/campaign', '/o?liffId=1234567890-AbCdEfGh'])('%s mobile settings', (path) => {
  it.each(['iPhone', 'Android Mobile', 'Mobile'])('default / custom / hidden on %s', async (ua) => {
    for (const value of [undefined, '<script>登録</script>', '']) {
      dbMocks.getLandingTextsJson.mockResolvedValueOnce(JSON.stringify(value === undefined ? {} : { mobileHeading: value }));
      const html = await (await open(path, ua)).text();
      if (value === '') expect(html).not.toContain('<p class="msg"');
      else expect(html).toContain(value === undefined ? DEFAULT_LANDING_TEXTS.mobileHeading : '&lt;script&gt;登録&lt;/script&gt;');
      expect(html).toContain('class="btn"');
      expect(html).not.toContain('<script>');
    }
  });
});

it.each(['iPhone', 'Android Mobile', DESKTOP_UA])('/o stays available on read failure (%s)', async (ua) => {
  dbMocks.getLandingTextsJson.mockRejectedValueOnce(new Error('database unavailable'));
  const res = await open('/o?liffId=1234567890-AbCdEfGh', ua);
  expect(res.status).toBe(200);
  expect(await res.text()).toContain(ua === DESKTOP_UA ? DEFAULT_LANDING_TEXTS.qrFooter : DEFAULT_LANDING_TEXTS.mobileHeading);
});

it('GET returns only overrides plus the defaults and limit', async () => {
  dbMocks.getLandingTextsJson.mockResolvedValueOnce(JSON.stringify({ qrHeading: '', bogus: 'ignored' }));
  const res = await worker.fetch(new Request('https://worker.example.com/api/account-settings/landing-texts', {
    headers: { Authorization: `Bearer ${API_KEY}` },
  }), env, ctx);
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({ success: true, data: { stored: { qrHeading: '' }, defaults: DEFAULT_LANDING_TEXTS, maxLength: 200 } });
});

it.each(['GET', 'PUT'])('requires authentication for %s settings', async (method) => {
  const res = await worker.fetch(new Request('https://worker.example.com/api/account-settings/landing-texts', {
    method, ...(method === 'PUT' ? { body: JSON.stringify({ value: {} }) } : {}),
  }), env, ctx);
  expect(res.status).toBe(401);
  expect(dbMocks.getLandingTextsJson).not.toHaveBeenCalled();
  expect(dbMocks.setLandingTextsJson).not.toHaveBeenCalled();
});
