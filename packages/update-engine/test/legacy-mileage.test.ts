import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { applyLegacyMileageMigration, assertLegacyMileageSource, LEGACY_MILEAGE_HOLD, LEGACY_MILEAGE_MIGRATIONS } from '../src/legacy-mileage.js';
import { applyD1Migrations } from '../src/migrations.js';
import { applyMileageRulesForEvent, processPendingMileageEvents, recordEngagementEvent } from '../../db/src/mileage.js';

const DB_ROOT = join(dirname(fileURLToPath(import.meta.url)), '../../db');
const NAMES = Object.keys(LEGACY_MILEAGE_MIGRATIONS) as Array<keyof typeof LEGACY_MILEAGE_MIGRATIONS>;
const sources = new Map(NAMES.map(name => [name, readFileSync(join(DB_ROOT, 'migrations', name))]));
const NOW = '2026-09-10T20:00:00.000+09:00';
const DAY = '2026-09-09T10:00:00.000+09:00';
const creds = { accountId: 'offline', apiToken: 'offline' };

function seedSql(name: string) {
  const sql = sources.get(name as typeof NAMES[number])!.toString('utf8');
  const start = sql.indexOf('INSERT OR IGNORE INTO mileage_rules');
  return sql.slice(start, sql.indexOf(';', start) + 1);
}
function fixture() {
  const sqlite = new Database(':memory:');
  sqlite.exec(readFileSync(join(DB_ROOT, 'bootstrap.sql'), 'utf8'));
  sqlite.exec(`INSERT INTO mileage_programs VALUES ('default','default','Harnessマイル','active','2026-01-01','2026-01-01');
    INSERT INTO users(id,display_name) VALUES ('u','test');
    INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','channel','offline','not-a-token','not-a-secret');
    INSERT INTO friends(id,line_user_id,user_id,line_account_id) VALUES ('f','Uf','u','a'),('f2','Uf2','u','a');
    CREATE TABLE _line_harness_migrations(name TEXT PRIMARY KEY, checksum TEXT NOT NULL, applied_at TEXT NOT NULL);`);
  for (const name of NAMES) sqlite.exec(seedSql(name));
  return sqlite;
}
function d1(sqlite: Database.Database): D1Database {
  return { prepare(sql: string) {
    const bound = (params: unknown[]) => ({
      async run() { const result = sqlite.prepare(sql).run(...params); return {success: true, results: [], meta: {changes: result.changes}}; },
      async first<T>() { return (sqlite.prepare(sql).get(...params) as T) ?? null; },
      async all<T>() { return {success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {}}; },
    });
    return {...bound([]), bind: (...params: unknown[]) => bound(params)};
  }} as unknown as D1Database;
}
function transport(sqlite: Database.Database, failBeforeStamp = false) {
  return async ({sql, params = []}: {sql: string; params?: any[]}) => {
    if (sql.trim().startsWith('SELECT')) {
      return {success: true, result: [{success: true, results: sqlite.prepare(sql).all(...params)}]};
    }
    // Model the D1 *single-request* transaction, not an application loop of
    // committed statements. Faults after candidate writes must roll them back.
    sqlite.transaction(() => sqlite.exec(failBeforeStamp
      ? sql.replace('INSERT OR IGNORE INTO _line_harness_migrations', 'INSERT OR IGNORE INTO deliberately_missing_table')
      : sql))();
    return {success: true, result: [{success: true, results: []}]};
  };
}
async function adapt(sqlite: Database.Database, name = NAMES[0], failBeforeStamp = false) {
  return applyLegacyMileageMigration({name, source: sources.get(name)!, checksum: `sha256:${LEGACY_MILEAGE_MIGRATIONS[name]}`,
    creds, databaseId: 'memory', execute: transport(sqlite, failBeforeStamp)});
}
function rawMessage(sqlite: Database.Database, id = 'm', friend = 'f', occurred = DAY) {
  sqlite.prepare("INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES(?,?,'incoming','text','offline',?)").run(id, friend, occurred);
}
function rawWebinar(sqlite: Database.Database, position = 300, cta = false) {
  sqlite.exec(`INSERT INTO webinars(id,account_id,title,slug,duration_seconds,created_at,updated_at) VALUES('w','a','offline','offline',1000,'2026-01-01','2026-01-01');`);
  sqlite.prepare('INSERT INTO webinar_viewers(id,webinar_id,friend_id,session_start_at,joined_at,last_position_seconds,cta_clicked_at) VALUES(?,?,?,?,?,?,?)')
    .run('v','w','f',1234,DAY,position,cta ? DAY : null);
}
function wallet(sqlite: Database.Database) { return sqlite.prepare('SELECT COALESCE(SUM(amount),0) AS amount FROM mileage_ledger').get() as {amount: number}; }
function legacyProjection(sqlite: Database.Database, name = NAMES[0]) {
  const source = sources.get(name)!.toString('utf8');
  sqlite.exec(source.slice(source.indexOf('INSERT OR IGNORE INTO mileage_rules')));
}
function ledger(sqlite: Database.Database) { return sqlite.prepare('SELECT * FROM mileage_ledger ORDER BY id').all(); }

describe('immutable mileage replay adapter', () => {
  let sqlite: Database.Database;
  beforeEach(() => { vi.useFakeTimers({toFake: ['Date']}); vi.setSystemTime(new Date(NOW)); sqlite = fixture(); });
  afterEach(() => { sqlite.close(); vi.useRealTimers(); });

  it('recognizes only the exact released SQL bytes', () => {
    for (const name of NAMES) expect(() => assertLegacyMileageSource(name, sources.get(name)!)).not.toThrow();
    expect(() => assertLegacyMileageSource(NAMES[0], Buffer.concat([sources.get(NAMES[0])!, Buffer.from('\n')]))).toThrow('unknown historical mileage SQL');
  });

  it('keeps settled live message + webinar mileage at 6 and retains every ledger row', async () => {
    rawMessage(sqlite); rawWebinar(sqlite);
    await applyMileageRulesForEvent(d1(sqlite), {eventType:'message_received',source:'line',sourceEventId:'m',friendId:'f',occurredAt:DAY});
    await applyMileageRulesForEvent(d1(sqlite), {eventType:'webinar_watch_5m',source:'webinar',sourceEventId:'w:f:5m',friendId:'f',subjectKey:'w',occurredAt:DAY});
    await processPendingMileageEvents(d1(sqlite), {now:NOW});
    const before = ledger(sqlite);
    expect(wallet(sqlite)).toEqual({amount:6});
    const apply = () => applyD1Migrations({creds,databaseId:'memory',names:NAMES,migrations:sources,
      legacyMileageProjectionVersion:1,execute:transport(sqlite)});
    await apply();
    expect(ledger(sqlite)).toEqual(before);
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM engagement_events').get()).toEqual({count:2});
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM _line_harness_legacy_mileage_claims').get()).toEqual({count:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS count FROM _line_harness_migrations').get()).toEqual({count:2});
    expect((await apply()).every(result => result.alreadyApplied)).toBe(true);
    expect(ledger(sqlite)).toEqual(before);
  });

  it('leaves pending live queue rows and disabled live-owned decisions untouched', async () => {
    rawMessage(sqlite);
    await applyMileageRulesForEvent(d1(sqlite), {eventType:'message_received',source:'line',sourceEventId:'m',friendId:'f',occurredAt:DAY});
    sqlite.exec("UPDATE mileage_rules SET is_active=0 WHERE id='builtin-message-received'");
    const queue = sqlite.prepare('SELECT * FROM mileage_event_queue').all();
    await adapt(sqlite);
    expect(sqlite.prepare('SELECT * FROM mileage_event_queue').all()).toEqual(queue);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_legacy_mileage_claims').get()).toEqual({n:0});
    await processPendingMileageEvents(d1(sqlite), {now:NOW});
    expect(wallet(sqlite)).toEqual({amount:0});
  });

  it('claims raw-write → migration → old enqueue exactly once and holds it from old cron', async () => {
    rawMessage(sqlite);
    await adapt(sqlite);
    expect(wallet(sqlite)).toEqual({amount:0});
    const resumed = await applyMileageRulesForEvent(d1(sqlite), {eventType:'message_received',source:'line',sourceEventId:'m',friendId:'f',occurredAt:DAY});
    expect(resumed.event.id).toBe('history-message-m');
    expect(sqlite.prepare('SELECT status,available_at FROM mileage_event_queue').get()).toEqual({status:'pending',available_at:LEGACY_MILEAGE_HOLD});
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mileage_event_queue WHERE status='pending' AND datetime(available_at)<=datetime(?)").get(NOW)).toEqual({n:0});
    expect(await processPendingMileageEvents(d1(sqlite), {now:NOW})).toMatchObject({processed:1, failed:0});
    expect(wallet(sqlite)).toEqual({amount:1});
    await adapt(sqlite);
    expect(await processPendingMileageEvents(d1(sqlite), {now:NOW})).toMatchObject({processed:0});
    expect(wallet(sqlite)).toEqual({amount:1});
  });

  it('does not claim the event-before-queue gap', async () => {
    rawMessage(sqlite);
    const event = await recordEngagementEvent(d1(sqlite), {idempotencyKey:'line:message_received:m',eventType:'message_received',source:'line',sourceEventId:'m',actorFriendId:'f',actorUserId:'u',occurredAt:DAY});
    await adapt(sqlite);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mileage_event_queue').get()).toEqual({n:0});
    const resumed = await applyMileageRulesForEvent(d1(sqlite), {eventType:'message_received',source:'line',sourceEventId:'m',friendId:'f',occurredAt:DAY});
    expect(resumed.event.id).toBe(event.id);
    await processPendingMileageEvents(d1(sqlite), {now:NOW});
    expect(wallet(sqlite)).toEqual({amount:1});
  });

  it('repairs an old event whose grant is missing without changing another historical grant', async () => {
    rawMessage(sqlite, 'granted'); rawMessage(sqlite, 'unfinished');
    legacyProjection(sqlite);
    sqlite.exec("DELETE FROM mileage_ledger WHERE source_event_id='unfinished'");
    const before = ledger(sqlite);
    await adapt(sqlite);
    expect(ledger(sqlite)).toEqual(before);
    expect(sqlite.prepare("SELECT id,idempotency_key FROM engagement_events WHERE source_event_id='unfinished'").get())
      .toEqual({id:'history-message-unfinished',idempotency_key:'line:message_received:unfinished'});
    expect(sqlite.prepare('SELECT status,COUNT(*) AS n FROM mileage_event_queue GROUP BY status ORDER BY status').all())
      .toEqual([{status:'pending',n:1},{status:'processed',n:1}]);
    await processPendingMileageEvents(d1(sqlite), {now:NOW});
    expect(wallet(sqlite)).toEqual({amount:2});
    expect(ledger(sqlite)).toEqual(expect.arrayContaining(before));
  });

  it('preserves historical cap suppression and uses runtime for genuinely ungranted days', async () => {
    for (let i=0;i<6;i++) rawMessage(sqlite, `m${i}`, i%2 ? 'f2':'f');
    legacyProjection(sqlite);
    const before = ledger(sqlite);
    rawMessage(sqlite, 'next-day', 'f', '2026-09-10T10:00:00.000+09:00');
    await adapt(sqlite);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mileage_event_queue WHERE status='processed'").get()).toEqual({n:6});
    expect(ledger(sqlite)).toEqual(before);
    await processPendingMileageEvents(d1(sqlite), {now:NOW});
    expect(wallet(sqlite)).toEqual({amount:6});
  });

  it('queues all source families and recovers the CTA session key from a proven legacy event', async () => {
    rawMessage(sqlite); rawWebinar(sqlite, 1000, true);
    sqlite.exec(`UPDATE friends SET ig_igsid='ig' WHERE id='f';
      INSERT INTO tracked_links(id,name,original_url) VALUES('link','link','https://example.test');
      INSERT INTO link_clicks(id,tracked_link_id,friend_id,clicked_at) VALUES('click','link','f','${DAY}');
      INSERT INTO forms(id,name) VALUES('form','form');
      INSERT INTO form_submissions(id,form_id,friend_id,created_at) VALUES('submission','form','f','${DAY}');
      INSERT INTO staff(id,line_account_id,name,display_name) VALUES('staff','a','staff','staff');
      INSERT INTO menus(id,line_account_id,name,duration_minutes,base_price) VALUES('menu','a','menu',30,100);
      INSERT INTO bookings(id,line_account_id,friend_id,staff_id,menu_id,starts_at,ends_at,block_ends_at,status,price_at_booking,requested_at,created_at)
        VALUES('booking','a','f','staff','menu','${DAY}','${DAY}','${DAY}','confirmed',100,'${DAY}','${DAY}');
      INSERT INTO events(id,line_account_id,name) VALUES('event','a','event');
      INSERT INTO event_slots(id,event_id,starts_at,ends_at) VALUES('slot','event','${DAY}','${DAY}');
      INSERT INTO event_bookings(id,line_account_id,event_id,slot_id,friend_id,status,requested_at,created_at)
        VALUES('event-booking','a','event','slot','f','confirmed','${DAY}','${DAY}');`);
    // A partial old projection proves the CTA identity that the raw viewer
    // alone cannot provide. Keep its events while simulating unfinished grants.
    legacyProjection(sqlite,NAMES[1]);
    sqlite.exec('DELETE FROM mileage_ledger');
    for (const name of NAMES) await adapt(sqlite,name);
    expect(sqlite.prepare("SELECT idempotency_key,json_extract(metadata,'$.subjectKey') AS subject FROM engagement_events WHERE event_type='webinar_cta_clicked'").get())
      .toEqual({idempotency_key:'webinar:webinar_cta_clicked:w:f:1234:primary',subject:'w:primary'});
    expect(wallet(sqlite)).toEqual({amount:0});
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({processed:10,failed:0});
    expect(wallet(sqlite)).toEqual({amount:123});
  });

  it('keeps previously rewarded form subjects settled across linked friends', async () => {
    sqlite.exec(`INSERT INTO forms(id,name) VALUES('form','form');
      INSERT INTO form_submissions(id,form_id,friend_id,created_at) VALUES('old','form','f','${DAY}');`);
    legacyProjection(sqlite);
    const before = ledger(sqlite);
    sqlite.exec(`INSERT INTO form_submissions(id,form_id,friend_id,created_at) VALUES('repeat','form','f2','${DAY}');`);
    await adapt(sqlite);
    expect(sqlite.prepare('SELECT DISTINCT status FROM mileage_event_queue').all()).toEqual([{status:'processed'}]);
    expect(ledger(sqlite)).toEqual(before);
    await applyMileageRulesForEvent(d1(sqlite),{eventType:'form_submitted',source:'form',sourceEventId:'future',friendId:'f2',subjectKey:'form',occurredAt:DAY});
    await processPendingMileageEvents(d1(sqlite),{now:NOW});
    expect(ledger(sqlite)).toEqual(before);
  });

  it('retains anonymous historical analytics without creating an unprocessable pending action', async () => {
    sqlite.exec(`INSERT INTO tracked_links(id,name,original_url) VALUES('link','link','https://example.test');
      INSERT INTO link_clicks(id,tracked_link_id,clicked_at) VALUES('anonymous','link','${DAY}');`);
    await adapt(sqlite);
    expect(sqlite.prepare('SELECT actor_friend_id FROM engagement_events').get()).toEqual({actor_friend_id:null});
    expect(sqlite.prepare('SELECT status FROM mileage_event_queue').get()).toEqual({status:'processed'});
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({claimed:0});
  });

  it('repairs a proven historic primary CTA without taking over a distinct live secondary CTA', async () => {
    rawWebinar(sqlite, 100, true);
    legacyProjection(sqlite, NAMES[1]);
    sqlite.exec("DELETE FROM mileage_ledger WHERE mileage_rule_id='builtin-webinar-cta-clicked'");
    await applyMileageRulesForEvent(d1(sqlite), {eventType:'webinar_cta_clicked',source:'webinar',sourceEventId:'w:f:1234:secondary',
      friendId:'f',subjectKey:'w:secondary',metadata:{webinarId:'w',sessionStartAt:1234,ctaId:'secondary'},occurredAt:DAY});
    const queue = sqlite.prepare('SELECT * FROM mileage_event_queue').all();
    await adapt(sqlite,NAMES[1]);
    expect(sqlite.prepare('SELECT * FROM mileage_event_queue').all()).toEqual(expect.arrayContaining(queue));
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_legacy_mileage_claims').get()).toEqual({n:1});
    await processPendingMileageEvents(d1(sqlite),{now:NOW});
    expect(wallet(sqlite)).toEqual({amount:20});
  });

  it('aborts the raw-secondary-CTA → migration gap, then retries safely after live enqueue', async () => {
    // /cta-click commits this timestamp before it records the request's
    // secondary CTA identity. The migration must not guess a primary action.
    rawWebinar(sqlite, 100, true);
    const viewer = sqlite.prepare('SELECT * FROM webinar_viewers').all();
    await expect(adapt(sqlite,NAMES[1])).rejects.toThrow('cannot establish historical CTA identity');
    expect(sqlite.prepare('SELECT * FROM webinar_viewers').all()).toEqual(viewer);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM engagement_events').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mileage_event_queue').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:0});
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '_line_harness_legacy_mileage_%'").get()).toEqual({n:0});

    // Resume the old async request with its actual CTA, then retry migration.
    await applyMileageRulesForEvent(d1(sqlite), {eventType:'webinar_cta_clicked',source:'webinar',sourceEventId:'w:f:1234:secondary',
      friendId:'f',subjectKey:'w:secondary',metadata:{webinarId:'w',sessionStartAt:1234,ctaId:'secondary'},occurredAt:DAY});
    await adapt(sqlite,NAMES[1]);
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({processed:1,failed:0});
    expect(wallet(sqlite)).toEqual({amount:10});
    expect(sqlite.prepare("SELECT json_extract(metadata,'$.subjectKey') AS subject FROM engagement_events").all())
      .toEqual([{subject:'w:secondary'}]);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_legacy_mileage_claims').get()).toEqual({n:0});
  });

  it('rejects legacy CTA recovery when its recorded session disagrees with the raw viewer', async () => {
    rawWebinar(sqlite, 100, true);
    legacyProjection(sqlite,NAMES[1]);
    sqlite.exec("UPDATE engagement_events SET metadata=json_set(metadata,'$.sessionStartAt',9999) WHERE event_type='webinar_cta_clicked'");
    const events = sqlite.prepare('SELECT * FROM engagement_events').all();
    const grants = ledger(sqlite);
    await expect(adapt(sqlite,NAMES[1])).rejects.toThrow('cannot establish historical CTA identity');
    expect(sqlite.prepare('SELECT * FROM engagement_events').all()).toEqual(events);
    expect(ledger(sqlite)).toEqual(grants);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:0});
  });

  it.each(['pending','processing','failed'] as const)('blocks an old-runtime %s queue overlapping a historical grant without taking ownership', async status => {
    rawMessage(sqlite);
    legacyProjection(sqlite);
    const grants = ledger(sqlite);
    await applyMileageRulesForEvent(d1(sqlite),{eventType:'message_received',source:'line',sourceEventId:'m',friendId:'f',occurredAt:DAY});
    sqlite.prepare('UPDATE mileage_event_queue SET status=?,attempts=1,processing_started_at=?').run(status,NOW);
    const queue = sqlite.prepare('SELECT * FROM mileage_event_queue').all();
    const events = sqlite.prepare('SELECT * FROM engagement_events ORDER BY id').all();
    await expect(adapt(sqlite)).rejects.toThrow('pending live mileage events that overlap existing historical grants');
    expect(sqlite.prepare('SELECT * FROM mileage_event_queue').all()).toEqual(queue);
    expect(sqlite.prepare('SELECT * FROM engagement_events ORDER BY id').all()).toEqual(events);
    expect(ledger(sqlite)).toEqual(grants);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:0});
  });

  it('detects a historical overlap in the event-before-queue gap', async () => {
    rawMessage(sqlite);
    legacyProjection(sqlite);
    await recordEngagementEvent(d1(sqlite),{idempotencyKey:'line:message_received:m',eventType:'message_received',source:'line',sourceEventId:'m',actorFriendId:'f',actorUserId:'u',occurredAt:DAY});
    await expect(adapt(sqlite)).rejects.toThrow('pending live mileage events that overlap existing historical grants');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mileage_event_queue').get()).toEqual({n:0});
    expect(wallet(sqlite)).toEqual({amount:1});
  });

  it('finds pending subject overlaps even without the live source row and succeeds after compatible reconciliation', async () => {
    sqlite.exec(`INSERT INTO forms(id,name) VALUES('form','form');
      INSERT INTO form_submissions(id,form_id,friend_id,created_at) VALUES('old','form','f','${DAY}');`);
    legacyProjection(sqlite);
    const grants = ledger(sqlite);
    await applyMileageRulesForEvent(d1(sqlite),{eventType:'form_submitted',source:'form',sourceEventId:'different-source-not-in-raw-table',
      friendId:'f2',subjectKey:'form',occurredAt:DAY});
    await expect(adapt(sqlite)).rejects.toThrow('pending live mileage events that overlap existing historical grants');
    // Reconcile with the actual compatible processor; blindly draining the
    // old processor would duplicate this grant, which is why replay stopped.
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({processed:1,failed:0});
    expect(ledger(sqlite)).toEqual(grants);
    await adapt(sqlite);
    expect(ledger(sqlite)).toEqual(grants);
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:1});
  });

  it('accepts reordered equivalent default condition keys', async () => {
    sqlite.exec(`UPDATE mileage_rules SET conditions='{"uniquePerSubjectPerDay":true,"dailyCapActions":5}' WHERE id='builtin-link-clicked';
      INSERT INTO tracked_links(id,name,original_url) VALUES('link','link','https://example.test');
      INSERT INTO link_clicks(id,tracked_link_id,friend_id,clicked_at) VALUES('click','link','f','${DAY}');`);
    await adapt(sqlite);
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({processed:1,failed:0});
    expect(wallet(sqlite)).toEqual({amount:2});
  });

  it('ignores a multiplier assigned after the historical action', async () => {
    rawMessage(sqlite);
    sqlite.exec(`INSERT INTO tags(id,name,mileage_multiplier_bps) VALUES('later-tier','later-tier',20000);
      INSERT INTO friend_tags(friend_id,tag_id,assigned_at) VALUES('f','later-tier','${NOW}');`);
    await adapt(sqlite);
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({processed:1,failed:0});
    expect(wallet(sqlite)).toEqual({amount:1});
  });

  it('fails a held projection explicitly if its saved rule policy later changes', async () => {
    rawMessage(sqlite);
    await adapt(sqlite);
    sqlite.exec("UPDATE mileage_rules SET amount=7 WHERE id='builtin-message-received'");
    expect(await processPendingMileageEvents(d1(sqlite),{now:NOW})).toMatchObject({processed:0,failed:1});
    expect(wallet(sqlite)).toEqual({amount:0});
    expect(sqlite.prepare('SELECT status,available_at FROM mileage_event_queue').get())
      .toEqual({status:'failed',available_at:LEGACY_MILEAGE_HOLD});
  });

  it('rejects orphan ungranted legacy history rather than stamping it as complete', async () => {
    rawMessage(sqlite);
    legacyProjection(sqlite);
    sqlite.exec("DELETE FROM mileage_ledger; DELETE FROM messages_log WHERE id='m'");
    await expect(adapt(sqlite)).rejects.toThrow('require review');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT idempotency_key FROM engagement_events').get()).toEqual({idempotency_key:'history:message:m'});
  });

  it('does not repurpose an old Instagram event if its friend now has a different IGSID', async () => {
    sqlite.exec("UPDATE friends SET ig_igsid='original' WHERE id='f'");
    legacyProjection(sqlite,NAMES[1]);
    const oldEvents = sqlite.prepare('SELECT * FROM engagement_events').all();
    const oldLedger = ledger(sqlite);
    sqlite.exec("UPDATE friends SET ig_igsid='changed' WHERE id='f'");
    await expect(adapt(sqlite,NAMES[1])).rejects.toThrow('require review');
    expect(sqlite.prepare('SELECT * FROM engagement_events').all()).toEqual(oldEvents);
    expect(ledger(sqlite)).toEqual(oldLedger);
  });

  it.each([
    "UPDATE mileage_rules SET is_active=0 WHERE id='builtin-message-received'",
    "UPDATE mileage_rules SET amount=7 WHERE id='builtin-message-received'",
    "INSERT INTO mileage_rules(id,program_id,name,event_type,source,amount,initial_status,is_active,created_at,updated_at) VALUES('custom','default','custom','message_received','line',3,'available',1,'2026-01-01','2026-01-01')",
    `INSERT INTO tags(id,name,mileage_multiplier_bps) VALUES('tier','tier',20000); INSERT INTO friend_tags(friend_id,tag_id,assigned_at) VALUES('f','tier','${DAY}')`,
  ])('rolls back a candidate whose entitlement has ambiguous custom policy: %s', async sql => {
    rawMessage(sqlite); sqlite.exec(sql);
    await expect(adapt(sqlite)).rejects.toThrow('require review');
    expect(wallet(sqlite)).toEqual({amount:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM engagement_events').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:0});
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE name LIKE '_line_harness_legacy_mileage_%'").get()).toEqual({n:0});
  });

  it('rolls back claims/events/queue together when execution fails before the stamp, then retries', async () => {
    rawMessage(sqlite);
    await expect(adapt(sqlite,NAMES[0],true)).rejects.toThrow('deliberately_missing_table');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM engagement_events').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM mileage_event_queue').get()).toEqual({n:0});
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM _line_harness_migrations').get()).toEqual({n:0});
    await adapt(sqlite);
    await processPendingMileageEvents(d1(sqlite),{now:NOW});
    expect(wallet(sqlite)).toEqual({amount:1});
  });

  it('refuses a queue-less existing synchronous mileage baseline', async () => {
    sqlite.exec('DROP TABLE mileage_event_queue'); rawMessage(sqlite);
    await expect(adapt(sqlite)).rejects.toThrow('asynchronous mileage baseline');
    expect(sqlite.prepare('SELECT COUNT(*) AS n FROM engagement_events').get()).toEqual({n:0});
  });
});
