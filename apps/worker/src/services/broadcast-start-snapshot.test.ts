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
  db.batch = async <T>(statements: D1PreparedStatement[]) => {
    sqlite.exec('BEGIN');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run<T>());
      sqlite.exec('COMMIT');
      return results;
    } catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  };
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
  let senderReads = 0;
  let fault: { phase: 'sender' | 'claim' | 'after-claim'; competing: boolean } | undefined;
  vi.spyOn(db, 'prepare').mockImplementation(sql => {
    if (sql === 'SELECT * FROM line_accounts WHERE id = ?') senderReads++;
    if (fault && (
      (fault.phase === 'sender' && senderReads === 1 && sql === 'SELECT * FROM line_accounts WHERE id = ?')
      || (fault.phase === 'after-claim' && senderReads === 2 && sql === 'SELECT * FROM line_accounts WHERE id = ?')
      || (fault.phase === 'claim' && /UPDATE broadcasts\s+SET status = 'sending'/.test(sql))
    )) {
      if (fault.competing) sqlite.exec("UPDATE broadcasts SET status='sending' WHERE id='campaign'");
      fault = undefined;
      throw new Error('Synthetic preflight or claim database failure');
    }
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
  const fail = (phase: 'sender' | 'claim' | 'after-claim', competing = false) => { fault = { phase, competing }; };
  const editRequest = (body: Record<string, unknown>) => app.request('/api/broadcasts/campaign', {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }, { DB: db, LINE_CHANNEL_ACCESS_TOKEN: 'synthetic-default' });
  return { row, run, send, multicast, fail, editRequest, sqlite, edited: () => edited };
}

describe('broadcast start uses the validated editable snapshot', () => {
  it('refuses a scheduled segment whose saved audience changed before claim', async () => {
    const oldConditions = JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] });
    const newConditions = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag' }] });
    const s = setup('scheduled', `segment_conditions='${newConditions}'`);
    s.sqlite.prepare("UPDATE broadcasts SET target_type='segment',segment_conditions=? WHERE id='campaign'").run(oldConditions);
    await s.run();
    expect(s.edited()).toBe(true);
    expect(s.row()).toMatchObject({ status: 'scheduled', segment_conditions: newConditions });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.multicast).not.toHaveBeenCalled();
  });

  it('still queues an unchanged scheduled segment', async () => {
    const s = setup('scheduled');
    const conditions = JSON.stringify({ operator: 'AND', rules: [{ type: 'is_following', value: true }] });
    s.sqlite.prepare("UPDATE broadcasts SET target_type='segment',segment_conditions=? WHERE id='campaign'").run(conditions);
    await s.run();
    expect(s.row()).toMatchObject({ status: 'sending', segment_conditions: conditions, batch_offset: 0 });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.multicast).not.toHaveBeenCalled();
  });

  it('edits a draft and clears only its old delivery state and insights', async () => {
    const s = setup('immediate');
    s.sqlite.exec(`UPDATE broadcasts SET success_count=3,dedup_progress='old-progress',
      sent_at='2000-01-01',line_request_id='old-request',aggregation_unit='old-unit',
      batch_lock_at='old-lock',failed_account_ids='["a"]' WHERE id='campaign';
      INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('old','campaign','pending');
      INSERT INTO broadcasts(id,title,message_type,message_content,target_type,status)
        VALUES('other','Other','text','Other','all','draft');
      INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('other','other','pending');`);
    const response = await s.editRequest({ messageContent: 'Edited safely' });
    expect(response.status).toBe(200);
    expect(s.row()).toMatchObject({ status: 'draft', message_content: 'Edited safely', success_count: 0,
      dedup_progress: null, sent_at: null, line_request_id: null, aggregation_unit: null,
      batch_lock_at: null, failed_account_ids: null });
    expect(s.sqlite.prepare('SELECT id FROM broadcast_insights').all()).toEqual([{ id: 'other' }]);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('keeps an ordinary reschedule pending until the new due time', async () => {
    const s = setup('scheduled');
    expect((await s.editRequest({ scheduledAt: '2099-01-01T00:00:00Z' })).status).toBe(200);
    await s.run();
    expect(s.row()).toMatchObject({ status: 'scheduled', scheduled_at: '2099-01-01T00:00:00Z' });
    expect(s.send).not.toHaveBeenCalled();
  });

  it('rolls back both the edit and insight cleanup when cleanup fails', async () => {
    const s = setup('immediate');
    s.sqlite.exec(`INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('old','campaign','pending');
      CREATE TRIGGER fail_cleanup BEFORE DELETE ON broadcast_insights
      BEGIN SELECT RAISE(ABORT,'Synthetic cleanup failure'); END;`);
    expect((await s.editRequest({ messageContent: 'Must not persist' })).status).toBe(500);
    expect(s.row()).toMatchObject({ status: 'draft', message_content: 'Original' });
    expect(s.sqlite.prepare('SELECT id FROM broadcast_insights').all()).toEqual([{ id: 'old' }]);
    expect(s.send).not.toHaveBeenCalled();
  });

  it('rolls back insight cleanup if the atomic edit fails', async () => {
    const s = setup('immediate');
    s.sqlite.exec(`INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('old','campaign','pending');
      CREATE TRIGGER fail_edit BEFORE UPDATE ON broadcasts
      BEGIN SELECT RAISE(ABORT,'Synthetic edit failure'); END;`);
    expect((await s.editRequest({ messageContent: 'Must not persist' })).status).toBe(500);
    expect(s.row()).toMatchObject({ status: 'draft', message_content: 'Original' });
    expect(s.sqlite.prepare('SELECT id FROM broadcast_insights').all()).toEqual([{ id: 'old' }]);
  });
  it.each([
    { messageContent: 'Late edit after completed send' },
    { scheduledAt: '2099-01-01T00:00:00Z' },
    { segmentConditions: { operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag' }] } },
  ])('rejects an edit whose editable read preceded a completed send: %j', async body => {
    const s = setup('scheduled');
    let sentRow: Record<string, unknown> | undefined;
    const readText = Request.prototype.text;
    vi.spyOn(Request.prototype, 'text').mockImplementation(async function (this: Request) {
      // The PUT route has read editable status; while its body is arriving,
      // a real scheduler/SQLite execution claims and finishes the delivery.
      if (this.method === 'PUT') { await s.run(); sentRow = s.row(); }
      return readText.call(this);
    });
    const response = await s.editRequest(body);
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(sentRow?.status).toBe('sent');
    expect(response.status).toBe(409);
    expect(s.row()).toEqual(sentRow);
    expect(s.sqlite.prepare("SELECT COUNT(*) n FROM broadcast_insights WHERE broadcast_id='campaign'").get()).toEqual({ n: 1 });
    expect(s.send).toHaveBeenCalledTimes(1);
    expect(s.row()).toMatchObject({
      status: 'sent', message_content: 'Original', success_count: 1,
      scheduled_at: '2000-01-01T00:00:00Z', line_request_id: 'synthetic',
    });
    await s.run();
    expect(s.send).toHaveBeenCalledTimes(1);
  });
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
  // main's saved segment conditions (include / exclude tags) share the same intent.
  const savedConditions = JSON.stringify({ operator: 'AND', rules: [{ type: 'tag_exists', value: 'tag' }] });
  it('saved-segment send refuses a content edit committed before its claim', async () => {
    const s = setup('immediate', "message_content='Edited after validation'");
    s.sqlite.prepare("UPDATE broadcasts SET segment_conditions=? WHERE id='campaign'").run(savedConditions);
    const response = await s.run();
    expect(s.edited()).toBe(true);
    expect(response?.status).toBe(409);
    expect(s.row()).toMatchObject({ status: 'draft', message_content: 'Edited after validation', segment_conditions: savedConditions });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.multicast).not.toHaveBeenCalled();
  });
  it('saved-segment send still queues an unchanged snapshot', async () => {
    const s = setup('immediate');
    s.sqlite.prepare("UPDATE broadcasts SET segment_conditions=? WHERE id='campaign'").run(savedConditions);
    const response = await s.run();
    expect(response?.status).toBe(202);
    expect(s.row()).toMatchObject({ status: 'sending', batch_offset: 0, total_count: 1 });
    expect(JSON.parse(s.row().segment_conditions as string).rules).toContainEqual({ type: 'group', value: JSON.parse(savedConditions) });
    expect(s.send).not.toHaveBeenCalled();
    expect(s.multicast).not.toHaveBeenCalled();
  });
  it('saves segment conditions in the same conditional edit', async () => {
    const s = setup('immediate');
    const response = await s.editRequest({ segmentConditions: JSON.parse(savedConditions) });
    expect(response.status).toBe(200);
    expect((await response.json() as { data: { segmentConditions?: unknown } }).data).toBeTruthy();
    expect(s.row()).toMatchObject({ status: 'draft', segment_conditions: savedConditions });
    expect((await s.editRequest({ segmentConditions: null })).status).toBe(200);
    expect(s.row().segment_conditions).toBeNull();
  });
  it('rolls back saved segment conditions together with a failed edit', async () => {
    const s = setup('immediate');
    s.sqlite.exec(`INSERT INTO broadcast_insights(id,broadcast_id,status) VALUES('old','campaign','pending');
      CREATE TRIGGER fail_cleanup BEFORE DELETE ON broadcast_insights
      BEGIN SELECT RAISE(ABORT,'Synthetic cleanup failure'); END;`);
    const response = await s.editRequest({ messageContent: 'Must not persist', segmentConditions: JSON.parse(savedConditions) });
    expect(response.status).toBe(500);
    expect(s.row()).toMatchObject({ message_content: 'Original', segment_conditions: null });
  });
  it.each(['sender', 'claim'] as const)('does not release another sender after a pre-claim %s failure', async phase => {
    const s = setup('scheduled');
    s.fail(phase, true);
    await s.run();
    expect(s.row().status).toBe('sending');
    await s.run();
    expect(s.send).not.toHaveBeenCalled();
  });
  it.each(['sender', 'claim', 'after-claim'] as const)('can retry a safe %s setup failure without a competing sender', async phase => {
    const s = setup('scheduled');
    s.fail(phase);
    await s.run();
    expect(s.row().status).toBe('scheduled');
    expect(s.send).not.toHaveBeenCalled();
    await s.run();
    expect(s.row().status).toBe('sent');
    expect(s.send).toHaveBeenCalledTimes(1);
  });
});
