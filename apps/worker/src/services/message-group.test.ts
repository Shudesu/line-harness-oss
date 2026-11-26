import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Hono } from 'hono';
import { LineClient, type Message } from '@line-crm/line-sdk';
import { packMessageItems, messageItems, parseMessageGroup, validateMessageContent, type MessageItem } from '@line-crm/shared';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { chats } from '../routes/chats.js';
import { broadcasts } from '../routes/broadcasts.js';
import { scenarios } from '../routes/scenarios.js';
import { reminders } from '../routes/reminders.js';
import { processScheduledBroadcasts, processQueuedBroadcasts } from './broadcast.js';
import { processStepDeliveries } from './step-delivery.js';
import { processReminderDeliveries } from './reminder-delivery.js';
import { pushImmediateFirstStep } from './immediate-first-step.js';

vi.mock('./stealth.js', () => ({ sleep: async () => {}, calculateStaggerDelay: () => 0, addJitter: () => 0, jitterDeliveryTime: (date: Date) => date, addMessageVariation: (text: string) => text }));
const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const image = { originalContentUrl: 'https://images.example/original.png', previewImageUrl: 'https://images.example/preview.png' };
const items: MessageItem[] = [
  { messageType: 'image', messageContent: JSON.stringify(image) },
  { messageType: 'text', messageContent: 'こんにちは {{name}}' },
  { messageType: 'flex', messageContent: JSON.stringify({ type: 'bubble', body: { type: 'box', layout: 'vertical', contents: [{ type: 'text', text: '{{name}}' }] } }) },
  { messageType: 'text', messageContent: 'https://example.test/join' },
  { messageType: 'image', messageContent: JSON.stringify(image) },
];
const packed = packMessageItems(items);

describe('ordered message groups', () => {
  it('preserves single-message storage and round-trips mixed groups', () => {
    expect(packMessageItems([items[1]])).toEqual(items[1]);
    expect(parseMessageGroup(items[1].messageContent)).toBeNull();
    expect(messageItems(packed.messageType, packed.messageContent)).toEqual(items);
    expect(validateMessageContent(packed.messageType, packed.messageContent)).toBeNull();
  });
  it.each([{ group: [] }, { group: [...items, items[0]] }])('rejects empty or oversized groups', ({ group }) => {
    expect(() => packMessageItems(group)).toThrow();
    expect(validateMessageContent('text', JSON.stringify({ $lineHarnessMessages: 1, items: group }))).toBeTruthy();
  });
  it.each([
    { messageType: 'text', messageContent: ' ' },
    { messageType: 'text', messageContent: 'x'.repeat(5001) },
    { messageType: 'image', messageContent: JSON.stringify({ ...image, originalContentUrl: 'http://images.example/x' }) },
    { messageType: 'flex', messageContent: '{"type":"text"}' },
    packed,
  ])('rejects invalid content and nested groups', invalid => {
    const content = JSON.stringify({ $lineHarnessMessages: 1, items: [items[0], invalid] });
    expect(validateMessageContent('image', content)).toBeTruthy();
  });
});

describe('grouped send boundaries and real database accounting', () => {
  let fixture: ReturnType<typeof sqliteD1>;
  let requests: Array<{ token: string; path: string; messages: Message[]; to: string | string[] }>;
  let app: Hono;
  beforeEach(() => {
    fixture = sqliteD1(); fixture.sqlite.exec(schema);
    fixture.db.batch = async <T>(statements: D1PreparedStatement[]) => Promise.all(statements.map(s => s.run<T>()));
    fixture.sqlite.exec(`
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','channel-a','A','token-a','secret'),('b','channel-b','B','token-b','secret');
      INSERT INTO friends(id,line_user_id,line_account_id,display_name) VALUES('fa','line-fa','a','A "quote"\\slash'),('fb','line-fb','b','Other account');
      INSERT INTO chats(id,friend_id,status) VALUES('chat','fa','unread');
      INSERT INTO tags(id,name) VALUES('tag','Shared');
      INSERT INTO friend_tags(friend_id,tag_id) VALUES('fa','tag'),('fb','tag');
      INSERT INTO account_settings(id,line_account_id,key,value) VALUES('recipients','a','test_recipients','["fa"]');
      INSERT INTO scenarios(id,name,trigger_type,line_account_id) VALUES('scenario','Test','manual','a');
      INSERT INTO reminders(id,name,line_account_id) VALUES('reminder','Test','a');
    `);
    requests = [];
    vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('No real network allowed'));
    vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
    vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
    vi.spyOn(LineClient.prototype, 'request').mockImplementation(async function(this: LineClient, method, path, body) {
      expect(method).toBe('POST');
      requests.push({ token: Reflect.get(this, 'channelAccessToken'), path, ...(body as { messages: Message[]; to: string }) });
      return { data: {}, headers: new Headers() };
    });
    app = new Hono(); app.route('/', chats); app.route('/', broadcasts); app.route('/', scenarios); app.route('/', reminders);
  });
  afterEach(() => { expect(fetch).not.toHaveBeenCalled(); fixture.sqlite.close(); vi.restoreAllMocks(); });
  function post(path: string, body: unknown = {}) {
    return app.request(`https://worker.example${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, { DB: fixture.db, WORKER_URL: 'https://worker.example' });
  }
  function addBroadcast(status: string) {
    fixture.sqlite.prepare("INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,line_account_id,status,scheduled_at,track_links) VALUES('broadcast','Test',?,?,'tag','tag','a',?,'2020-01-01T00:00:00Z',1)").run(packed.messageType, packed.messageContent, status);
    if (status === 'sending') fixture.sqlite.exec("UPDATE broadcasts SET segment_conditions='' WHERE id='broadcast'");
  }
  function assertOneSend() {
    expect(requests).toHaveLength(1);
    expect(requests[0].token).toBe('token-a');
    expect(requests[0].messages.map(m => m.type)).toEqual(['image','text','flex','text','image']);
    expect(requests[0].messages[0]).toEqual({ type: 'image', ...image });
    expect(requests[0].messages[4]).toEqual({ type: 'image', ...image });
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM messages_log').get()).toEqual({ n: 1 });
    const log = fixture.sqlite.prepare('SELECT friend_id,content FROM messages_log').get() as { friend_id: string; content: string };
    expect(log.friend_id).toBe('fa');
    expect(parseMessageGroup(log.content)).toHaveLength(5);
  }
  it('sends five mixed chat bubbles with one API call and one log, including tracking after an image', async () => {
    const response = await post('/api/chats/chat/send', { messageType: packed.messageType, content: packed.messageContent });
    expect(response.status).toBe(200);
    assertOneSend();
    expect(requests[0].to).toBe('line-fa');
    expect(requests[0].messages[3]).toMatchObject({ type: 'text', text: expect.stringMatching(/^https:\/\/worker.example\/t\/.*\?f=fa$/) });
    expect(fixture.sqlite.prepare('SELECT source,line_account_id FROM messages_log').get()).toEqual({ source: 'manual', line_account_id: 'a' });
  });
  it.each(['scheduled','sending'])('sends %s groups once, expands quoted names, and keeps a shared tag within its account', async status => {
    addBroadcast(status);
    const run = status === 'scheduled' ? processScheduledBroadcasts : processQueuedBroadcasts;
    await run(fixture.db, new LineClient('unused'), 'https://worker.example');
    await processQueuedBroadcasts(fixture.db, new LineClient('unused'), 'https://worker.example');
    expect(fixture.sqlite.prepare("SELECT status,last_error FROM broadcasts WHERE id='broadcast'").get()).toMatchObject({status:'sent'});
    assertOneSend();
    expect(requests[0].to).toBe('line-fa');
    expect(requests[0].messages[1]).toMatchObject({ text: 'こんにちは A "quote"\\slash' });
    expect(requests[0].messages[2]).toMatchObject({ contents: { body: { contents: [{ text: 'A "quote"\\slash' }] } } });
    expect(fixture.sqlite.prepare("SELECT success_count,status FROM broadcasts WHERE id='broadcast'").get()).toEqual({ success_count: 1, status: 'sent' });
  });
  it.each(['scheduled', 'sending', 'dedup'])('sends non-personalized %s groups in a single multicast with one recipient count', async mode => {
    addBroadcast(mode === 'scheduled' ? 'scheduled' : 'sending');
    const plain = packMessageItems(items.map(item => ({ ...item, messageContent: item.messageContent.replaceAll('{{name}}', '皆さん') })));
    fixture.sqlite.prepare("UPDATE broadcasts SET message_content=? WHERE id='broadcast'").run(plain.messageContent);
    if (mode === 'dedup') {
      fixture.sqlite.exec(`INSERT INTO users(id) VALUES('same-person'); UPDATE friends SET user_id='same-person';
        UPDATE broadcasts SET target_type='multi-account-dedup',account_ids='["a","b"]',dedup_priority='["a","b"]' WHERE id='broadcast'`);
    }
    if (mode === 'scheduled') await processScheduledBroadcasts(fixture.db, new LineClient('unused'), 'https://worker.example');
    await processQueuedBroadcasts(fixture.db, new LineClient('unused'), 'https://worker.example');
    await processQueuedBroadcasts(fixture.db, new LineClient('unused'), 'https://worker.example');
    assertOneSend();
    expect(requests[0].path).toBe('/v2/bot/message/multicast');
    expect(requests[0].to).toEqual(['line-fa']);
    expect(fixture.sqlite.prepare("SELECT success_count,status FROM broadcasts WHERE id='broadcast'").get()).toEqual({ success_count: 1, status: 'sent' });
  });
  it('test-send keeps the group ordered and prefixes text items only', async () => {
    addBroadcast('draft');
    expect((await post('/api/broadcasts/broadcast/test-send')).status).toBe(200);
    assertOneSend();
    expect(requests[0].messages[1]).toMatchObject({ text: expect.stringMatching(/^【テスト配信】\n/) });
    expect(requests[0].messages[3]).toMatchObject({ text: expect.stringMatching(/^【テスト配信】\n/) });
  });
  it.each(['chat','broadcast','scenario','reminder'])('rejects a sixth item at the %s API boundary before saving or sending', async kind => {
    const invalid = JSON.stringify({ $lineHarnessMessages: 1, items: [...items, items[0]] });
    const path = { chat: '/api/chats/chat/send', broadcast: '/api/broadcasts', scenario: '/api/scenarios/scenario/steps', reminder: '/api/reminders/reminder/steps' }[kind]!;
    const response = await post(path, { title: 'Invalid', content: invalid, messageContent: invalid, messageType: 'image', stepOrder: 1, delayMinutes: 0, offsetMinutes: 0, targetType: 'all', lineAccountId: 'a' });
    expect(response.status).toBe(400);
    expect(requests).toEqual([]);
    for (const table of ['broadcasts','scenario_steps','reminder_steps','messages_log']) expect(fixture.sqlite.prepare(`SELECT COUNT(*) n FROM ${table}`).get()).toEqual({ n: 0 });
  });
  it.each(['scheduled','immediate','reply'])('delivers a %s scenario group once and advances the enrollment', async mode => {
    fixture.sqlite.prepare("INSERT INTO scenario_steps(id,scenario_id,step_order,delay_minutes,message_type,message_content) VALUES('step','scenario',1,0,?,?)").run(packed.messageType, packed.messageContent);
    fixture.sqlite.exec("INSERT INTO friend_scenarios(id,friend_id,scenario_id,current_step_order,status,next_delivery_at) VALUES('enrollment','fa','scenario',0,'active','2020-01-01T00:00:00Z')");
    if (mode === 'scheduled') {
      await processStepDeliveries(fixture.db, new LineClient('unused'), 'https://worker.example');
      await processStepDeliveries(fixture.db, new LineClient('unused'), 'https://worker.example');
    } else {
      const options = mode === 'reply' ? { reply: { client: new LineClient('token-a'), replyToken: 'synthetic' } } : undefined;
      expect(await pushImmediateFirstStep(fixture.db, 'fa', 'scenario', { defaultAccessToken: 'unused', workerUrl: 'https://worker.example' }, options)).toBe(true);
      expect(await pushImmediateFirstStep(fixture.db, 'fa', 'scenario', { defaultAccessToken: 'unused', workerUrl: 'https://worker.example' }, options)).toBe(false);
    }
    assertOneSend();
    expect(fixture.sqlite.prepare("SELECT status FROM friend_scenarios WHERE id='enrollment'").get()).toEqual({ status: 'completed' });
    if (mode === 'reply') expect(fixture.sqlite.prepare('SELECT delivery_type FROM messages_log').get()).toEqual({ delivery_type: 'reply' });
  });
  it('reminder groups send once, log once and complete once', async () => {
    fixture.sqlite.prepare("INSERT INTO reminder_steps(id,reminder_id,offset_minutes,message_type,message_content) VALUES('step','reminder',0,?,?)").run(packed.messageType, packed.messageContent);
    fixture.sqlite.exec("INSERT INTO friend_reminders(id,friend_id,reminder_id,target_date) VALUES('enrollment','fa','reminder','2020-01-01T00:00:00Z')");
    await processReminderDeliveries(fixture.db, new LineClient('unused'));
    await processReminderDeliveries(fixture.db, new LineClient('unused'));
    assertOneSend();
    expect(fixture.sqlite.prepare('SELECT COUNT(*) n FROM friend_reminder_deliveries').get()).toEqual({ n: 1 });
    expect(fixture.sqlite.prepare('SELECT status FROM friend_reminders').get()).toEqual({ status: 'completed' });
  });
});
