import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Buffer } from 'node:buffer';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { liffRoutes } from './liff.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
afterEach(() => { vi.restoreAllMocks(); });

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  for (const account of ['a', 'b']) {
    sqlite.prepare(`INSERT INTO line_accounts
      (id,channel_id,name,channel_access_token,channel_secret,login_channel_id)
      VALUES(?,?,?,?,?,?)`)
      .run(account, `channel-${account}`, account, 'synthetic-token', 'synthetic-secret', `login-${account}`);
  }
  sqlite.prepare("INSERT INTO traffic_pools(id,slug,name,active_account_id,created_at,updated_at) VALUES(?,?,?,?,'2020-01-01','2020-01-01')")
    .run('pool-b', 'campaign', 'Synthetic pool', 'b');
  sqlite.prepare("INSERT INTO pool_accounts(id,pool_id,line_account_id,is_active,created_at) VALUES(?,?,?,1,'2020-01-01')")
    .run('member-b', 'pool-b', 'b');
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
  const app = new Hono();
  app.route('/', liffRoutes);
  async function request(query: URLSearchParams, configured = true) {
    const response = await app.request(`/auth/oauth?${query.toString()}`, {}, {
      DB: db, LINE_LOGIN_CHANNEL_ID: configured ? 'login-default' : undefined,
      LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-default-token',
    });
    expect(network).not.toHaveBeenCalled();
    return response;
  }
  async function authorize(query: URLSearchParams) {
    const response = await request(query);
    expect(response.status).toBe(302);
    const location = new URL(response.headers.get('location')!);
    expect(location.origin).toBe('https://access.line.me');
    expect(location.pathname).toBe('/oauth2/v2.1/authorize');
    expect(location.searchParams.get('redirect_uri')).toBe('http://localhost/auth/callback');
    expect(location.searchParams.get('response_type')).toBe('code');
    expect(location.searchParams.get('scope')).toBe('profile openid email');
    expect(location.searchParams.get('bot_prompt')).toBe('aggressive');
    const state = JSON.parse(Buffer.from(location.searchParams.get('state')!, 'base64').toString('utf8')) as Record<string, string>;
    return { location, state };
  }
  return { sqlite, request, authorize };
}

describe('/auth/oauth LIFF query fallback (PR #159)', () => {
  it.each(['?ref=campaign-a', '/path?ref=campaign-a', 'relative/path?ref=campaign-a'])(
    'recovers query parameters from %s without changing the OAuth contract', async liffState => {
      const s = setup();
      try {
        const { state, location } = await s.authorize(new URLSearchParams({ 'liff.state': liffState }));
        expect(state.ref).toBe('campaign-a');
        expect(location.searchParams.get('client_id')).toBe('login-default');
      } finally { s.sqlite.close(); }
    },
  );

  it('recovers all existing fields, including iga/igan and encoded Japanese values', async () => {
    const s = setup();
    try {
      const fields = {
        ref: '広告/東京 50% +', redirect: 'https://destination.example/path?a=1#section',
        form: 'synthetic-form', gate: 'synthetic-gate', xh: 'synthetic-xh',
        gclid: 'synthetic-g', fbclid: 'synthetic-fb', twclid: 'synthetic-tw', ttclid: 'synthetic-tt',
        utm_source: '紹介', utm_medium: 'SNS', utm_campaign: '夏の勉強会',
        account: 'channel-b', uid: 'synthetic-user', ig: 'synthetic-ig',
        iga: 'synthetic-iga', igan: '日本語アカウント',
      };
      const direct = await s.authorize(new URLSearchParams(fields));
      const wrapped = await s.authorize(new URLSearchParams({
        'liff.state': '/path?' + new URLSearchParams(fields).toString() + '#ignored-fragment',
      }));
      expect(wrapped.state).toEqual(direct.state);
      expect(wrapped.location.searchParams.get('client_id')).toBe('login-b');
      expect(wrapped.state.redirect).toBe(fields.redirect);
    } finally { s.sqlite.close(); }
  });

  it('recovers pool selection with the same account resolution as a direct pool query', async () => {
    const s = setup();
    try {
      const direct = await s.authorize(new URLSearchParams({ pool: 'campaign', ref: 'pool-ref' }));
      const wrapped = await s.authorize(new URLSearchParams({ 'liff.state': '/path?pool=campaign&ref=pool-ref' }));
      expect(wrapped.state).toEqual(direct.state);
      expect(wrapped.state.account).toBe('channel-b');
      expect(wrapped.location.searchParams.get('client_id')).toBe('login-b');
    } finally { s.sqlite.close(); }
  });

  it.each(['/path??account=channel-b&ref=normal', '??ref=hidden', '/path?%3Fref=hidden&iga=normal'])('keeps standard URL query-key semantics for %s', async liffState => {
    const s = setup();
    try {
      const directQuery = new URL(liffState, 'https://synthetic.example').searchParams;
      const direct = await s.authorize(directQuery);
      const wrapped = await s.authorize(new URLSearchParams({ 'liff.state': liffState }));
      expect(wrapped.state).toEqual(direct.state);
      expect(wrapped.location.searchParams.get('client_id')).toBe(direct.location.searchParams.get('client_id'));
    } finally { s.sqlite.close(); }
  });

  it('direct values, including explicit empty values, override hidden state', async () => {
    const s = setup();
    try {
      const { state, location } = await s.authorize(new URLSearchParams({
        ref: '', account: 'channel-a', iga: '', pool: '',
        'liff.state': '?ref=hidden&account=channel-b&iga=hidden&igan=rescued&pool=campaign',
      }));
      expect(state.ref).toBe('');
      expect(state.iga).toBe('');
      expect(state.igan).toBe('rescued');
      expect(state.account).toBe('channel-a');
      expect(location.searchParams.get('client_id')).toBe('login-a');
    } finally { s.sqlite.close(); }
  });

  it('an explicit empty account and pool keep the existing default selection', async () => {
    const s = setup();
    try {
      const { state, location } = await s.authorize(new URLSearchParams({
        account: '', pool: '', 'liff.state': '?account=channel-b&pool=campaign',
      }));
      expect(location.searchParams.get('client_id')).toBe('login-default');
      expect(state.account).toBe('');
    } finally { s.sqlite.close(); }
  });

  it('keeps first-value semantics for duplicate direct and state parameters', async () => {
    const s = setup();
    try {
      const direct = new URLSearchParams([
        ['ref', 'first-direct'], ['ref', 'second-direct'],
        ['liff.state', '?ref=hidden&iga=first-state&iga=second-state'],
      ]);
      const first = await s.authorize(direct);
      expect(first.state.ref).toBe('first-direct');
      expect(first.state.iga).toBe('first-state');
      const duplicateState = await s.authorize(new URLSearchParams([
        ['liff.state', '?ref=first-state'], ['liff.state', '?ref=second-state'],
      ]));
      expect(duplicateState.state.ref).toBe('first-state');
      const emptyFirst = await s.authorize(new URLSearchParams([
        ['ref', ''], ['ref', 'second-direct'], ['liff.state', '?ref=hidden'],
      ]));
      expect(emptyFirst.state.ref).toBe('');
    } finally { s.sqlite.close(); }
  });

  it('does not treat fragments or encoded delimiters as extra parameters', async () => {
    const s = setup();
    try {
      const { state } = await s.authorize(new URLSearchParams({
        'liff.state': '/path?ref=a%26b%3D1%23part&iga=%2526literal#igan=not-a-query',
      }));
      expect(state.ref).toBe('a&b=1#part');
      expect(state.iga).toBe('%26literal');
      expect(state.igan).toBe('');
    } finally { s.sqlite.close(); }
  });

  it.each([
    '/path-only', '#?iga=fragment-only', '%3Figa%3Ddouble-encoded',
    'https://other.example/path?iga=not-a-liff-path', '//other.example/path?iga=not-a-liff-path',
  ])('ignores unsupported state shape %s and keeps direct values', async liffState => {
    const s = setup();
    try {
      const { state } = await s.authorize(new URLSearchParams({ ref: 'direct', 'liff.state': liffState }));
      expect(state.ref).toBe('direct');
      expect(state.iga).toBe('');
    } finally { s.sqlite.close(); }
  });

  it('malformed percent escapes do not throw or override an explicit direct value', async () => {
    const s = setup();
    try {
      const { state } = await s.authorize(new URLSearchParams({ ref: '', 'liff.state': '?ref=%ZZ&iga=%E0%A4' }));
      expect(state.ref).toBe('');
      expect(typeof state.iga).toBe('string');
    } finally { s.sqlite.close(); }
  });

  it('does not bypass the existing unconfigured-login guard', async () => {
    const s = setup();
    try {
      const response = await s.request(new URLSearchParams({ 'liff.state': '?ref=campaign' }), false);
      expect(response.status).toBe(503);
      expect(response.headers.has('location')).toBe(false);
    } finally { s.sqlite.close(); }
  });
});
