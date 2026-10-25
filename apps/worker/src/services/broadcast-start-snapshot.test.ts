import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { URL } from 'node:url';
import { Hono } from 'hono';
import { LineClient } from '@line-crm/line-sdk';
import { sqliteD1 } from '../test-support/sqlite-d1.js';
import { broadcasts } from '../routes/broadcasts.js';
import { processScheduledBroadcasts } from './broadcast.js';

const schema = readFileSync(new URL('../../../../packages/db/bootstrap.sql', import.meta.url), 'utf8');
const closes: Array<() => void> = [];
afterEach(() => {
  try { expect(globalThis.fetch).not.toHaveBeenCalled(); }
  finally {
    closes.splice(0).forEach(close => close());
    vi.restoreAllMocks();
  }
});

type Lane = 'immediate' | 'personalized' | 'large-tag' | 'dedup' | 'segment' | 'scheduled';
function setup(lane: Lane, edit?: string) {
  const { db, sqlite } = sqliteD1();
  closes.push(() => sqlite.close());
  sqlite.exec(schema);
  vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('Real network forbidden'));
  vi.spyOn(LineClient.prototype, 'getMessageQuota').mockResolvedValue({ type: 'none' });
  vi.spyOn(LineClient.prototype, 'getMessageQuotaConsumption').mockResolvedValue({ totalUsage: 0 });
  const send = vi.spyOn(LineClient.prototype, 'broadcast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  const multicast = vi.spyOn(LineClient.prototype, 'multicast').mockResolvedValue({ data: {}, requestId: 'synthetic' });
  sqlite.exec(`INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret)
    VALUES('a','a','Synthetic account','synthetic-token','synthetic-secret');
    INSERT INTO tags(id,name) VALUES('tag','Synthetic tag');`);
  const addFriend = sqlite.prepare("INSERT INTO friends(id,line_user_id,display_name,line_account_id) VALUES(?,?,?,'a')");
  const addTag = sqlite.prepare("INSERT INTO friend_tags(friend_id,tag_id) VALUES(?,'tag')");
  for (let i = 0; i < (lane === 'large-tag' ? 501 : 1); i++) {
    addFriend.run(`f${i}`, `line-f${i}`, `Friend ${i}`);
    addTag.run(`f${i}`);
  }
  sqlite.prepare(`INSERT INTO broadcasts(id,title,message_type,message_content,target_type,target_tag_id,
    line_account_id,status,scheduled_at,account_ids,dedup_priority,track_links)
    VALUES('campaign','Synthetic campaign','text',?,?,'tag','a',?,?,'["a"]','["a"]',0)`)
    .run(lane === 'personalized' ? 'Hello {{name}}' : 'Original',
      lane === 'large-tag' ? 'tag' : lane === 'dedup' ? 'multi-account-dedup' : 'all',
      lane === 'scheduled' ? 'scheduled' : 'draft', lane === 'scheduled' ? '2000-01-01T00:00:00Z' : null);
  // Execute a competing committed edit immediately before the real SQL claim.
  // The claim still runs against SQLite, rather than returning a mocked lock result.
  const prepare = db.prepare.bind(db);
  let edited = false;
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    if (edit && !edited && /UPDATE broadcasts\s+SET status = 'sending'/.test(sql)) {
      edited = true;
      sqlite.exec(`UPDATE broadcasts SET ${edit} WHERE id='campaign'`);
    }
    return prepare(sql);
  });
  const app = new Hono();
  app.route('/', broadcasts);
  const row = () => sqlite.prepare("SELECT * FROM broadcasts WHERE id='campaign'").get() as Record<string, unknown>;
  const run = () => lane === 'scheduled'
    ? processScheduledBroadcasts(db, new LineClient('synthetic-default'))
    : app.request(`/api/broadcasts/campaign/${lane === 'segment' ? 'send-segment' : 'send'}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      ...(lane === 'segment' ? { body: JSON.stringify({ conditions: { operator: 'AND', rules: [{ type: 'is_following', value: true }] } }) } : {}),
    }, { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-default' });
  return { row, run, send, multicast, edited: () => edited };
}

describe('broadcast start uses the validated editable snapshot', () => {
  it.each(['immediate', 'personalized', 'large-tag', 'dedup', 'segment', 'scheduled'] as const)(
    '%s refuses a content edit committed before its claim', async lane => {
      const s = setup(lane, "message_content='Edited after validation'");
      const response = await s.run();
      expect(s.edited()).toBe(true);
      if (response) expect(response.status).toBe(409);
      expect(s.send).not.toHaveBeenCalled();
      expect(s.multicast).not.toHaveBeenCalled();
      expect(s.row()).toMatchObject({ status: lane === 'scheduled' ? 'scheduled' : 'draft', message_content: 'Edited after validation' });
    },
  );
  it.each([
    "scheduled_at='2099-01-01T00:00:00Z'", "target_type='tag'", "track_links=1", "alt_text='Changed alt text'",
    "message_type='image'", "target_tag_id=NULL", "line_account_id=NULL", "account_ids='[]'", "dedup_priority='[]'",
  ])('scheduled start respects a concurrent configuration edit: %s', async edit => {
    const s = setup('scheduled', edit);
    await s.run();
    expect(s.edited()).toBe(true);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.multicast).not.toHaveBeenCalled();
    expect(s.row().status).toBe('scheduled');
  });
  it('does not override a concurrent reschedule of a draft', async () => {
    const s = setup('immediate', "status='scheduled', scheduled_at='2099-01-01T00:00:00Z'");
    const response = await s.run();
    expect(response?.status).toBe(409);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.row()).toMatchObject({ status: 'scheduled', scheduled_at: '2099-01-01T00:00:00Z' });
  });
  it.each(['immediate', 'scheduled'] as const)('%s still sends an unchanged snapshot', async lane => {
    const s = setup(lane);
    const response = await s.run();
    if (response) expect(response.status).toBe(200);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.row()).toMatchObject({ status: 'sent', success_count: 1 });
  });
  it.each(['personalized', 'large-tag', 'dedup', 'segment'] as const)('%s still queues an unchanged snapshot', async lane => {
    const s = setup(lane);
    const response = await s.run();
    expect(response?.status).toBe(202);
    expect(s.send).not.toHaveBeenCalled();
    expect(s.multicast).not.toHaveBeenCalled();
    expect(s.row()).toMatchObject({ status: 'sending', batch_offset: 0 });
    if (lane === 'personalized' || lane === 'dedup') expect(s.row().total_count).toBe(1);
    if (lane !== 'dedup') expect(s.row().segment_conditions).toEqual(expect.any(String));
  });
});
