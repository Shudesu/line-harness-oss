import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { keywordMatches } from './auto-reply.js';
import { computeUnansweredInbox } from './unanswered-inbox.js';
import { webhook } from '../routes/webhook.js';

const proxyDispatch = vi.hoisted(() => vi.fn());
vi.mock('./local-line-proxy.js', () => ({ dispatchLineProxyLocally: proxyDispatch }));

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const secret = 'synthetic-channel-secret';

afterEach(() => {
  vi.restoreAllMocks();
});

function setup() {
  const { db, sqlite } = sqliteD1();
  sqlite.exec(schema);
  sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
    .run('account-a', 'synthetic-channel', 'Synthetic account', 'synthetic-token', secret);
  sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name,metadata) VALUES(?,?,?,?,?)')
    .run('friend-a', 'synthetic-user', 'account-a', 'Synthetic friend', '{}');
  const network = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
  proxyDispatch.mockReset();
  proxyDispatch.mockImplementation(async () => new Response('{}', { status: 200 }));
  const app = new Hono();
  app.route('/', webhook);
  function rule(keyword: string, options: { silent?: boolean; id?: string; reply?: string; createdAt?: string } = {}) {
    sqlite.prepare(`INSERT INTO auto_replies
      (id,keyword,match_type,response_type,response_content,line_account_id,created_at)
      VALUES(?,?,'exact',?,?,'account-a',?)`)
      .run(options.id ?? 'rule-a', keyword, options.silent ? 'silent' : 'text',
        options.reply ?? 'Synthetic reply', options.createdAt ?? '2020-01-01T00:00:00.000+09:00');
  }
  function automation(eventType: string, condition: object) {
    sqlite.prepare("INSERT INTO tags(id,name) VALUES('tag-a','Synthetic tag')").run();
    sqlite.prepare('INSERT INTO automations(id,name,event_type,line_account_id,conditions,actions) VALUES(?,?,?,?,?,?)')
      .run('keyword-action', 'Synthetic keyword action', eventType, 'account-a', JSON.stringify(condition), JSON.stringify([
        { type: 'add_tag', params: { tagId: 'tag-a' } },
        { type: 'set_metadata', params: { data: '{"original":"{{message}}"}' } },
      ]));
    // Observe one tag-change event independently from the outer keyword action.
    sqlite.prepare('INSERT INTO automations(id,name,event_type,line_account_id,conditions,actions) VALUES(?,?,?,?,?,?)')
      .run('tag-observer', 'Synthetic tag observer', 'tag_change', 'account-a', '{"tag_id":"tag-a"}', '[]');
  }
  async function post(kind: 'text' | 'postback', text: string) {
    const event = {
      type: kind === 'text' ? 'message' : 'postback',
      source: { type: 'user', userId: 'synthetic-user' },
      replyToken: 'synthetic-reply-token',
      timestamp: Date.now(),
      mode: 'active',
      webhookEventId: crypto.randomUUID(),
      deliveryContext: { isRedelivery: false },
      ...(kind === 'text' ? { message: { type: 'text', id: crypto.randomUUID(), text } } : { postback: { data: text } }),
    };
    const body = JSON.stringify({ destination: 'synthetic-bot', events: [event] });
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
    const digest = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const signature = btoa(String.fromCharCode(...new Uint8Array(digest)));
    const pending: Promise<unknown>[] = [];
    const response = await app.request('/webhook', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Line-Signature': signature }, body,
    }, { DB: db, LINE_CHANNEL_SECRET: secret, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-token' }, {
      waitUntil(promise: Promise<unknown>) { pending.push(promise); },
      passThroughOnException() {},
      props: {},
    });
    await Promise.all(pending);
    expect(response.status).toBe(200);
    expect(network).not.toHaveBeenCalled();
  }
  return { db, sqlite, rule, automation, post };
}

describe('text-only auto-reply keyword normalization (PR #230)', () => {
  it.each([
    ['exact', '0627', '０６２７', true],
    ['exact', '０６２７', '06２７', true],
    ['exact', '0627', '　 06２７ \n', true],
    ['exact', 'カタカナ', 'ｶﾀｶﾅ', true],
    ['contains', '0627', '０６２７お願いします', true],
    ['exact', '0627', '０６２７お願いします', false],
    ['exact', 'AbC', 'ＡｂＣ', true],
    ['exact', 'ABC', 'abc', false],
    ['contains', '[ab]', '［ａｂ］', true],
    ['regex', '[0-9]+', '0627', false],
    ['unknown', '0627', '0627', false],
    ['contains', '　 ', 'anything', false],
  ] as const)('%s keyword %s against %s keeps the intended match semantics', (match_type, keyword, text, expected) => {
    expect(keywordMatches({ match_type, keyword }, text, { normalizeText: true })).toBe(expected);
  });

  it('keeps the raw comparator opaque unless text normalization is requested', () => {
    expect(keywordMatches({ keyword: '0627', match_type: 'exact' }, '０６２７')).toBe(false);
    expect(keywordMatches({ keyword: '0627', match_type: 'exact' }, ' 0627 ')).toBe(false);
  });

  it('the real text webhook replies to a width variant and stores the original incoming text', async () => {
    const s = setup();
    try {
      s.rule('0627');
      await s.post('text', '　06２７ ');
      expect(proxyDispatch).toHaveBeenCalledTimes(1);
      expect(s.sqlite.prepare("SELECT content FROM messages_log WHERE direction='incoming'").get())
        .toEqual({ content: '　06２７ ' });
      expect(s.sqlite.prepare("SELECT content,source,delivery_type FROM messages_log WHERE direction='outgoing'").get())
        .toEqual({ content: 'Synthetic reply', source: 'auto_reply', delivery_type: 'reply' });
    } finally { s.sqlite.close(); }
  });

  it('silent normalized text rules also suppress unanswered status without an outgoing evidence row', async () => {
    const s = setup();
    try {
      s.rule('カタカナ', { silent: true });
      await s.post('text', ' ｶﾀｶﾅ　');
      expect(proxyDispatch).not.toHaveBeenCalled();
      expect((await computeUnansweredInbox(s.db)).total).toBe(0);
      expect(s.sqlite.prepare("SELECT COUNT(*) n FROM chats WHERE status='unread'").get()).toEqual({ n: 0 });
    } finally { s.sqlite.close(); }
  });

  it.each(['keyword', 'keyword_exact'])('silent text and automation %s agree and attach a tag once with raw evidence', async condition => {
    const s = setup();
    try {
      const input = '　06２７ ';
      s.rule('0627', { silent: true });
      s.automation('message_received', { [condition]: '０６２７' });
      await s.post('text', input);
      expect((await computeUnansweredInbox(s.db)).total).toBe(0);
      expect(s.sqlite.prepare("SELECT COUNT(*) n FROM chats WHERE status='unread'").get()).toEqual({ n: 0 });
      expect(proxyDispatch).not.toHaveBeenCalled();
      expect(s.sqlite.prepare('SELECT friend_id,tag_id FROM friend_tags').all())
        .toEqual([{ friend_id: 'friend-a', tag_id: 'tag-a' }]);
      expect(s.sqlite.prepare("SELECT status FROM automation_logs WHERE automation_id='tag-observer'").all())
        .toEqual([{ status: 'success' }]);
      const log = s.sqlite.prepare("SELECT event_data,status FROM automation_logs WHERE automation_id='keyword-action'").get() as { event_data: string; status: string };
      expect(log.status).toBe('success');
      expect(JSON.parse(log.event_data).text).toBe(input);
      expect(s.sqlite.prepare("SELECT content FROM messages_log WHERE direction='incoming'").get())
        .toEqual({ content: input });
      const friend = s.sqlite.prepare("SELECT metadata FROM friends WHERE id='friend-a'").get() as { metadata: string };
      expect(JSON.parse(friend.metadata).original).toBe(input);
    } finally { s.sqlite.close(); }
  });

  it.each([
    ['keyword', '0627', '０６２７', false],
    ['keyword_exact', '0627', '０６２７', false],
    ['keyword', '０６２７', '０６２７', true],
    ['keyword_exact', '０６２７', '　０６２７ ', true],
  ] as const)('postback automation %s preserves raw width and existing exact trim behavior', async (condition, keyword, input, matches) => {
    const s = setup();
    try {
      s.automation('postback_received', { [condition]: keyword });
      await s.post('postback', input);
      expect(s.sqlite.prepare('SELECT COUNT(*) n FROM friend_tags').get()).toEqual({ n: matches ? 1 : 0 });
      expect(proxyDispatch).not.toHaveBeenCalled();
      expect(s.sqlite.prepare("SELECT content,source FROM messages_log WHERE direction='incoming'").get())
        .toEqual({ content: input, source: 'postback' });
    } finally { s.sqlite.close(); }
  });

  it.each(['０６２７', ' 0627 '])('opaque postback %s is neither normalized nor trimmed', async input => {
    const s = setup();
    try {
      s.rule('0627');
      await s.post('postback', input);
      expect(proxyDispatch).not.toHaveBeenCalled();
      expect(s.sqlite.prepare("SELECT content,source FROM messages_log WHERE direction='incoming'").get())
        .toEqual({ content: input, source: 'postback' });
      expect((await computeUnansweredInbox(s.db)).total).toBe(0);
    } finally { s.sqlite.close(); }
  });

  it('exact opaque postback matching remains available', async () => {
    const s = setup();
    try {
      s.rule(' ０６２７ ');
      await s.post('postback', ' ０６２７ ');
      expect(proxyDispatch).toHaveBeenCalledTimes(1);
    } finally { s.sqlite.close(); }
  });

  it('retains existing first-rule ordering when normalization makes two text rules equivalent', async () => {
    const s = setup();
    try {
      s.rule('0627', { id: 'first', reply: 'First rule', createdAt: '2020-01-01T00:00:00+09:00' });
      s.rule('０６２７', { id: 'second', reply: 'Second rule', createdAt: '2020-01-02T00:00:00+09:00' });
      await s.post('text', '０６２７');
      expect(s.sqlite.prepare("SELECT content FROM messages_log WHERE direction='outgoing'").get())
        .toEqual({ content: 'First rule' });
    } finally { s.sqlite.close(); }
  });
});
