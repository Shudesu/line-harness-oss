import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { chats } from './chats.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const RAW_URL = 'https://example.test/join';
const WORKER = 'https://request-worker.example';

describe('chat reply tracking and delivery logs', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let app: Hono;
  let requests: Array<{ token: string; to: string; messages: Message[] }>;
  let failDelivery: boolean;
  beforeEach(() => {
    fixture = sqliteD1();
    fixture.sqlite.exec(schema);
    for (const id of ['a', 'b']) {
      fixture.sqlite.prepare('INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES(?,?,?,?,?)')
        .run(`account-${id}`, `channel-${id}`, 'Synthetic account', `synthetic-token-${id}`, 'synthetic-secret');
      fixture.sqlite.prepare('INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES(?,?,?,?)')
        .run(`friend-${id}`, `line-friend-${id}`, `account-${id}`, 'Synthetic friend');
      fixture.sqlite.prepare('INSERT INTO chats(id,friend_id,status) VALUES(?,?,?)').run(`chat-${id}`, `friend-${id}`, 'unread');
    }
    requests = [];
    failDelivery = false;
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network is forbidden in this test'));
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function (this: LineClient, method, path, body) {
      expect(method).toBe('POST');
      expect(path).toBe('/v2/bot/message/push');
      requests.push({ token: Reflect.get(this, 'channelAccessToken'), ...(body as { to: string; messages: Message[] }) });
      if (failDelivery) throw new Error('Synthetic delivery failure');
      return { data: {}, headers: new Headers() };
    });
    app = new Hono();
    app.route('/', chats);
  });
  afterEach(() => {
    expect(fetch).not.toHaveBeenCalled();
    fixture.sqlite.close();
    vi.restoreAllMocks();
  });

  function send(body: { content: string; messageType?: string; trackLinks?: boolean }, id = 'chat-a', workerUrl?: string) {
    return app.request(`${WORKER}/api/chats/${id}/send`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://untrusted-admin.example' }, body: JSON.stringify(body),
    }, { DB: fixture.db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-unrelated-default', ...(workerUrl === undefined ? {} : { WORKER_URL: workerUrl }) });
  }

  function links() {
    return fixture.sqlite.prepare('SELECT original_url,line_account_id,short_code FROM tracked_links ORDER BY line_account_id').all() as Array<{
      original_url: string; line_account_id: string | null; short_code: string;
    }>;
  }

  function expectLogMatches(message: Message, friend = 'friend-a', account = 'account-a') {
    const content = message.type === 'text' ? message.text
      : message.type === 'flex' ? JSON.stringify(message.contents)
        : message.type === 'image' ? JSON.stringify({ originalContentUrl: message.originalContentUrl, previewImageUrl: message.previewImageUrl })
          : JSON.stringify(message);
    expect(fixture.sqlite.prepare('SELECT message_type,content,source,line_account_id FROM messages_log WHERE friend_id=?').get(friend))
      .toEqual({ message_type: message.type, content, source: 'manual', line_account_id: account });
  }

  it('uses each recipient account for both its current token and owned tracked link, with distinct friend attribution', async () => {
    fixture.sqlite.exec("UPDATE line_accounts SET channel_access_token='synthetic-rotated-b' WHERE id='account-b'");
    for (const id of ['a', 'b']) expect((await send({ content: `See ${RAW_URL}` }, `chat-${id}`)).status).toBe(200);
    const rows = links();
    expect(rows).toHaveLength(2);
    for (const [index, id] of ['a', 'b'].entries()) {
      expect(rows[index]).toMatchObject({ original_url: RAW_URL, line_account_id: `account-${id}` });
      expect(requests[index]).toMatchObject({
        token: id === 'a' ? 'synthetic-token-a' : 'synthetic-rotated-b', to: `line-friend-${id}`,
        messages: [{ type: 'text', text: `See ${WORKER}/t/${rows[index].short_code}?f=friend-${id}` }],
      });
      expectLogMatches(requests[index].messages[0], `friend-${id}`, `account-${id}`);
    }
  });

  it('attributes a lazy-created chat to the friend ID, not the new chat ID', async () => {
    fixture.sqlite.exec("DELETE FROM chats WHERE id='chat-a'");
    expect((await send({ content: RAW_URL }, 'friend-a')).status).toBe(200);
    const chat = fixture.sqlite.prepare("SELECT id,status FROM chats WHERE friend_id='friend-a'").get() as { id: string; status: string };
    expect(chat.id).not.toBe('friend-a');
    expect(chat.status).toBe('in_progress');
    expect(requests[0].messages).toEqual([{ type: 'text', text: `${WORKER}/t/${links()[0].short_code}?f=friend-a` }]);
    expectLogMatches(requests[0].messages[0]);
  });

  it('retains the owner ID when an unassigned legacy friend uses the sole active account', async () => {
    fixture.sqlite.exec("UPDATE friends SET line_account_id=NULL WHERE id='friend-a'; UPDATE line_accounts SET is_active=0 WHERE id='account-b'");
    expect((await send({ content: RAW_URL })).status).toBe(200);
    expect(requests[0].token).toBe('synthetic-token-a');
    expect(links()[0].line_account_id).toBe('account-a');
    expectLogMatches(requests[0].messages[0]);
  });

  it('leaves raw links alone when tracking is disabled', async () => {
    expect((await send({ content: RAW_URL, trackLinks: false })).status).toBe(200);
    expect(links()).toEqual([]);
    expect(requests[0].messages).toEqual([{ type: 'text', text: RAW_URL }]);
    expectLogMatches(requests[0].messages[0]);
  });

  it('still attributes an existing tracked link when raw-URL tracking is disabled', async () => {
    const text = `${WORKER}/t/ExistingCode?utm_source=chat`;
    expect((await send({ content: text, trackLinks: false })).status).toBe(200);
    expect(links()).toEqual([]);
    expect(requests[0].messages).toEqual([{ type: 'text', text: `${text}&f=friend-a` }]);
    expectLogMatches(requests[0].messages[0]);
  });

  it('tracks Flex URI actions and preserves media URLs while logging the actual sent object', async () => {
    const contents = { type: 'bubble', hero: { type: 'image', url: 'https://images.example/hero.png' }, body: {
      type: 'box', layout: 'vertical', contents: [{ type: 'button', action: { type: 'uri', label: 'Join', uri: RAW_URL } }],
    } };
    expect((await send({ messageType: 'flex', content: JSON.stringify(contents, null, 2) })).status).toBe(200);
    const rows = links();
    expect(rows).toHaveLength(1);
    const expected = structuredClone(contents);
    expected.body.contents[0].action.uri = `${WORKER}/t/${rows[0].short_code}?f=friend-a`;
    expect(requests[0].messages[0]).toMatchObject({ type: 'flex', contents: expected });
    expectLogMatches(requests[0].messages[0]);
  });

  it('keeps image URLs untouched and excludes unsent input fields from the log', async () => {
    const image = { originalContentUrl: `${WORKER}/t/image-original.png`, previewImageUrl: 'https://images.example/preview.png', unsentCaption: 'not sent' };
    expect((await send({ messageType: 'image', content: JSON.stringify(image, null, 2) })).status).toBe(200);
    expect(links()).toEqual([]);
    expect(requests[0].messages).toEqual([{ type: 'image', originalContentUrl: image.originalContentUrl, previewImageUrl: image.previewImageUrl }]);
    expectLogMatches(requests[0].messages[0]);
  });

  it('uses the request URL origin when WORKER_URL is missing, never the Origin header', async () => {
    expect((await send({ content: RAW_URL })).status).toBe(200);
    expect(requests[0].messages).toEqual([{ type: 'text', text: `${WORKER}/t/${links()[0].short_code}?f=friend-a` }]);
  });

  it('uses a configured short domain for tracking and friend attribution', async () => {
    fixture.sqlite.prepare("INSERT INTO account_settings(id,line_account_id,key,value) VALUES('short-domain','__global__','tracked_link_base_url',?)")
      .run(JSON.stringify('https://go.example'));
    expect((await send({ content: RAW_URL }, 'chat-a', 'https://configured-worker.example')).status).toBe(200);
    expect(requests[0].messages).toEqual([{ type: 'text', text: `https://go.example/t/${links()[0].short_code}?f=friend-a` }]);
    expectLogMatches(requests[0].messages[0]);
  });

  it('reuses existing app-link behavior instead of introducing another URL rewrite policy', async () => {
    expect((await send({ content: 'https://youtube.com/watch?v=synthetic' })).status).toBe(200);
    expect(links()).toEqual([]);
    expect(requests[0].messages).toEqual([{ type: 'text', text: 'https://youtube.com/watch?v=synthetic&openExternalBrowser=1' }]);
    expectLogMatches(requests[0].messages[0]);
  });

  it.each(['inactive', 'empty token'])('does not send or create tracking rows for an assigned account with %s', async state => {
    fixture.sqlite.exec(state === 'inactive'
      ? "UPDATE line_accounts SET is_active=0 WHERE id='account-a'"
      : "UPDATE line_accounts SET channel_access_token='' WHERE id='account-a'");
    expect((await send({ content: RAW_URL })).status).toBe(500);
    expect(requests).toEqual([]);
    expect(links()).toEqual([]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM messages_log').get()).toEqual({ count: 0 });
  });

  it('does not record a sent message or advance chat state when LINE delivery fails', async () => {
    failDelivery = true;
    expect((await send({ content: RAW_URL })).status).toBe(500);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM messages_log').get()).toEqual({ count: 0 });
    expect(fixture.sqlite.prepare("SELECT status FROM chats WHERE id='chat-a'").get()).toEqual({ status: 'unread' });
  });

  it('rejects unsupported message types instead of logging an unsent message as successful', async () => {
    expect((await send({ messageType: 'video', content: RAW_URL })).status).toBe(400);
    expect(requests).toEqual([]);
    expect(links()).toEqual([]);
    expect(fixture.sqlite.prepare('SELECT COUNT(*) AS count FROM messages_log').get()).toEqual({ count: 0 });
  });
});
