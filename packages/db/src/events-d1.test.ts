import { Miniflare } from 'miniflare';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  addTagToFriend,
  createEventTagRule,
  createTag,
  getFriendTags,
  listUserEvents,
  recordUserEvent,
  resetEventSchemaCacheForTest,
  resetTagSchemaCacheForTest,
} from './index.js';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  d1Databases: ['DB'],
});

let db: D1Database;

async function resetDb() {
  db = await mf.getD1Database('DB');
  resetEventSchemaCacheForTest(db);
  resetTagSchemaCacheForTest(db);
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS event_tag_rules'),
    db.prepare('DROP TABLE IF EXISTS event_definitions'),
    db.prepare('DROP TABLE IF EXISTS user_events'),
    db.prepare('DROP TABLE IF EXISTS friend_tags'),
    db.prepare('DROP TABLE IF EXISTS tags'),
    db.prepare('DROP TABLE IF EXISTS friends'),
  ]);
  await db.batch([
    db.prepare(`CREATE TABLE friends (id TEXT PRIMARY KEY, line_user_id TEXT UNIQUE NOT NULL, display_name TEXT, user_id TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now')), updated_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE tags (id TEXT PRIMARY KEY, name TEXT UNIQUE NOT NULL, color TEXT NOT NULL DEFAULT '#3B82F6', created_at TEXT NOT NULL DEFAULT (datetime('now')))`),
    db.prepare(`CREATE TABLE friend_tags (friend_id TEXT NOT NULL REFERENCES friends(id) ON DELETE CASCADE, tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE, assigned_at TEXT NOT NULL DEFAULT (datetime('now')), PRIMARY KEY (friend_id, tag_id))`),
  ]);
  await db.prepare(`INSERT INTO friends (id, line_user_id, display_name, user_id) VALUES ('friend_1', 'Uevent1', 'Event User', 'user_1')`).run();
}

afterAll(() => mf.dispose());

describe('user events — D1 integration', () => {
  beforeEach(resetDb);

  it('records event and seeds system event definitions', async () => {
    const event = await recordUserEvent(db, {
      friendId: 'friend_1',
      lineUserId: 'Uevent1',
      eventType: 'liff.booking.open',
      eventName: 'LIFF予約画面表示',
      eventSource: 'liff',
      subjectType: 'liff_screen',
      subjectId: 'book',
      metadata: { screen: 'book' },
    });

    expect(event.id).toBeTruthy();
    const events = await listUserEvents(db, { friendId: 'friend_1' });
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe('liff.booking.open');

    const definition = await db
      .prepare(`SELECT event_type, is_system FROM event_definitions WHERE event_type = 'liff.booking.open'`)
      .first<{ event_type: string; is_system: number }>();
    expect(definition?.is_system).toBe(1);
  });

  it('seeds LIFF booking and rich menu event definitions used by the UI', async () => {
    await recordUserEvent(db, {
      friendId: 'friend_1',
      eventType: 'liff.booking.open',
      eventSource: 'liff',
    });

    const rows = await db
      .prepare(
        `SELECT event_type FROM event_definitions
         WHERE event_type IN (
           'liff.booking.open',
           'liff.booking.resource_selected',
           'liff.booking.menu_selected',
           'liff.booking.date_selected',
           'liff.booking.slot_selected',
           'liff.booking.confirm_open',
           'liff.booking.completed',
           'liff.mine.open',
           'liff.cancel.open',
           'rich_menu.tap'
         )
         ORDER BY event_type ASC`,
      )
      .all<{ event_type: string }>();

    expect(rows.results?.map((row) => row.event_type)).toEqual([
      'liff.booking.completed',
      'liff.booking.confirm_open',
      'liff.booking.date_selected',
      'liff.booking.menu_selected',
      'liff.booking.open',
      'liff.booking.resource_selected',
      'liff.booking.slot_selected',
      'liff.cancel.open',
      'liff.mine.open',
      'rich_menu.tap',
    ]);
  });

  it('uses idempotency_key to avoid duplicate events', async () => {
    await recordUserEvent(db, {
      friendId: 'friend_1',
      eventType: 'tracked_link.click',
      eventSource: 'tracked_link',
      idempotencyKey: 'click:one',
      metadata: { trackedLinkId: 'link_1' },
    });
    await recordUserEvent(db, {
      friendId: 'friend_1',
      eventType: 'tracked_link.click',
      eventSource: 'tracked_link',
      idempotencyKey: 'click:one',
      metadata: { trackedLinkId: 'link_1' },
    });

    const events = await listUserEvents(db, { eventType: 'tracked_link.click' });
    expect(events).toHaveLength(1);
  });

  it('applies matching event tag rule', async () => {
    const tag = await createTag(db, { name: '予約導線反応あり', category: 'interest' });
    await createEventTagRule(db, {
      name: '予約導線クリックでタグ付与',
      eventType: 'tracked_link.click',
      conditions: { trackedLinkId: 'booking-link' },
      action: 'add_tag',
      tagId: tag.id,
    });

    await recordUserEvent(db, {
      friendId: 'friend_1',
      eventType: 'tracked_link.click',
      eventSource: 'tracked_link',
      metadata: { trackedLinkId: 'booking-link' },
    });

    const tags = await getFriendTags(db, 'friend_1');
    expect(tags.map((item) => item.name)).toContain('予約導線反応あり');
  });

  it('can remove tag through event tag rule', async () => {
    const tag = await createTag(db, { name: '一時タグ', category: 'campaign' });
    await addTagToFriend(db, 'friend_1', tag.id);
    await createEventTagRule(db, {
      name: 'キャンセルで一時タグ解除',
      eventType: 'reservation.cancelled',
      conditions: {},
      action: 'remove_tag',
      tagId: tag.id,
    });

    await recordUserEvent(db, {
      friendId: 'friend_1',
      eventType: 'reservation.cancelled',
      eventSource: 'reservation',
      subjectType: 'reservation',
      subjectId: 'res_1',
    });

    const tags = await getFriendTags(db, 'friend_1');
    expect(tags.map((item) => item.name)).not.toContain('一時タグ');
  });

  it('applies tag rule from rich menu postback metadata', async () => {
    const tag = await createTag(db, { name: 'リッチメニュー予約タップ', category: 'interest' });
    await createEventTagRule(db, {
      name: 'リッチメニュー予約postback',
      eventType: 'rich_menu.tap',
      conditions: { action: 'booking' },
      action: 'add_tag',
      tagId: tag.id,
    });

    await recordUserEvent(db, {
      friendId: 'friend_1',
      eventType: 'rich_menu.tap',
      eventSource: 'line',
      metadata: { action: 'booking', rawData: 'action=booking' },
    });

    const tags = await getFriendTags(db, 'friend_1');
    expect(tags.map((item) => item.name)).toContain('リッチメニュー予約タップ');
  });
});
