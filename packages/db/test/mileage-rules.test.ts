import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  applyMileageRulesForEvent,
  processPendingMileageEvents,
  enqueueFollowingMileageMilestones,
  getMileageAdminOverview,
  getMileageEarningOpportunitiesForFriend,
  getMileageSelfInsights,
  getMileageSummaryForFriend,
  updateMileageRule,
} from '../src/mileage.js';
import { addTagToFriend, enqueueHistoricTagMileage } from '../src/tags.js';
import { updateFriendFollowStatus } from '../src/friends.js';

const PACKAGE_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const BENIGN = /duplicate column name|already exists/i;
const FIXED_NOW = new Date('2026-08-10T00:00:00.000+09:00');

function execSafe(db: Database.Database, sql: string) {
  for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
    try { db.exec(statement); } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!BENIGN.test(message)) throw error;
    }
  }
}

function setupSqlite() {
  const db = new Database(':memory:');
  execSafe(db, readFileSync(join(PACKAGE_ROOT, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(PACKAGE_ROOT, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    execSafe(db, readFileSync(join(PACKAGE_ROOT, 'migrations', file), 'utf8'));
  }
  db.prepare(`INSERT INTO users (id, display_name) VALUES ('user-1', '横断ユーザー')`).run();
  db.prepare(`INSERT INTO line_accounts (id, channel_id, name, channel_access_token, channel_secret)
              VALUES ('account-1', 'channel-1', '公式A', 'token', 'secret'),
                     ('account-2', 'channel-2', '公式B', 'token', 'secret')`).run();
  db.prepare(`INSERT INTO friends
                (id, line_user_id, display_name, picture_url, user_id, line_account_id)
              VALUES ('friend-1', 'U1', 'ユーザーA', 'https://example.com/a.jpg', 'user-1', 'account-1'),
                     ('friend-2', 'U2', 'ユーザーB', NULL, 'user-1', 'account-2')`).run();
  return db;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            async run() {
              const result = statement.run(...params);
              return { success: true, results: [], meta: { changes: result.changes } };
            },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
            async all<T>() { return { success: true, results: statement.all(...params) as T[], meta: {} }; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('configurable mileage rules', () => {
  let sqlite: Database.Database;
  let db: D1Database;

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(FIXED_NOW);
    sqlite = setupSqlite();
    db = asD1(sqlite);
  });

  afterEach(() => {
    sqlite.close();
    vi.useRealTimers();
  });

  it('enforces the message daily cap across two LINE accounts for one user', async () => {
    for (let index = 0; index < 6; index += 1) {
      await applyMileageRulesForEvent(db, {
        eventType: 'message_received',
        source: 'line',
        sourceEventId: `message-${index}`,
        friendId: index % 2 === 0 ? 'friend-1' : 'friend-2',
        occurredAt: `2026-08-09T10:0${index}:00.000+09:00`,
      });
    }
    const queue = await processPendingMileageEvents(db, { now: '2026-08-10T10:10:00.000+09:00' });

    const summary = await getMileageSummaryForFriend(db, 'friend-1');
    expect(summary.available).toBe(5);
    expect(queue).toMatchObject({ processed: 6, granted: 5, failed: 0 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM engagement_events`).get()).toEqual({ count: 6 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger`).get()).toEqual({ count: 5 });
  });

  it('awards the same tracked link once per day and the same form once overall', async () => {
    for (const id of ['click-1', 'click-2']) {
      await applyMileageRulesForEvent(db, {
        eventType: 'link_clicked', source: 'tracked_link', sourceEventId: id,
        friendId: 'friend-1', subjectKey: 'link-1', occurredAt: '2026-08-09T12:00:00.000+09:00',
      });
    }
    for (const id of ['form-1', 'form-2']) {
      await applyMileageRulesForEvent(db, {
        eventType: 'form_submitted', source: 'form', sourceEventId: id,
        friendId: 'friend-2', subjectKey: 'form-A', occurredAt: `2026-08-${id === 'form-1' ? '09' : '10'}T12:00:00.000+09:00`,
      });
    }
    await processPendingMileageEvents(db, { now: '2026-08-10T13:00:00.000+09:00' });

    const summary = await getMileageSummaryForFriend(db, 'friend-2');
    expect(summary.available).toBe(12);
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM engagement_events`).get()).toEqual({ count: 4 });
    expect(sqlite.prepare(`SELECT COUNT(*) AS count FROM mileage_ledger`).get()).toEqual({ count: 2 });
  });

  it('builds one cross-account ranking row and respects edited rule amounts', async () => {
    await updateMileageRule(db, 'builtin-booking-created', { amount: 25 });
    await applyMileageRulesForEvent(db, {
      eventType: 'message_received', source: 'line', sourceEventId: 'message-1',
      friendId: 'friend-1', occurredAt: '2026-08-09T10:00:00.000+09:00',
    });
    await applyMileageRulesForEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'booking-1',
      friendId: 'friend-2', occurredAt: '2026-08-09T11:00:00.000+09:00',
    });
    await processPendingMileageEvents(db, { now: '2026-08-10T12:00:00.000+09:00' });

    const overview = await getMileageAdminOverview(db);
    const member = overview.members.find((item) => item.identityKey === 'user:user-1');
    expect(member).toMatchObject({
      available: 26,
      accountCount: 2,
      actionCount: 2,
      messageCount: 1,
      bookingCount: 1,
    });
    expect(member?.accountNames).toEqual(expect.arrayContaining(['公式A', '公式B']));

    const selfInsights = await getMileageSelfInsights(db, 'friend-1');
    expect(selfInsights).toMatchObject({
      accountCount: 2,
      rewardedActions: 2,
      referralMiles: 0,
      qualityReferralCount: 0,
      lastEarnedAt: '2026-08-09T11:00:00.000+09:00',
    });
  });

  it('shows only incomplete webinar mileage opportunities for the current LINE account', async () => {
    sqlite.prepare(`UPDATE line_accounts SET liff_id = '2000000000-TestLiff' WHERE id = 'account-1'`).run();
    sqlite.prepare(
      `INSERT INTO webinars
         (id, account_id, title, slug, status, duration_seconds, schedule_json,
          cta_json, created_at, updated_at)
       VALUES ('webinar-1', 'account-1', 'AI活用ウェビナー', 'ai-webinar', 'active',
               1263, '[]', '{"label":"詳しく見る","url":"https://example.com"}',
               '2026-08-01T10:00:00.000+09:00', '2026-08-09T10:00:00.000+09:00'),
              ('webinar-other', 'account-2', '別アカウント配信', 'other-webinar', 'active',
               1263, '[]', NULL,
               '2026-08-01T10:00:00.000+09:00', '2026-08-09T11:00:00.000+09:00')`,
    ).run();

    const fresh = await getMileageEarningOpportunitiesForFriend(db, 'friend-1', {
      now: '2026-08-10T10:00:00.000+09:00',
    });
    const freshWebinar = fresh.find((item) => item.type === 'webinar');
    const registeredAccount = fresh.find((item) => item.id === 'friend-add:account-1');
    expect(fresh).toHaveLength(2);
    expect(registeredAccount).toMatchObject({
      completed: true,
      mileageStatus: 'waiting',
      ctaLabel: '登録済み',
    });
    expect(freshWebinar).toMatchObject({
      id: 'webinar:webinar-1',
      rewardMiles: 55,
      nextRewardMiles: 5,
      progressPercent: 0,
      ctaLabel: '今すぐ参加する',
    });
    expect(freshWebinar?.description).toContain('5分視聴');
    expect(freshWebinar?.url).toContain('2000000000-TestLiff');

    sqlite.prepare(
      `INSERT INTO webinar_viewers
         (id, webinar_id, friend_id, session_start_at, joined_at, last_position_seconds)
       VALUES ('viewer-1', 'webinar-1', 'friend-1', 1,
               '2026-08-10T10:00:00.000+09:00', 400)`,
    ).run();
    const inProgress = await getMileageEarningOpportunitiesForFriend(db, 'friend-1');
    const inProgressWebinar = inProgress.find((item) => item.type === 'webinar');
    expect(inProgressWebinar).toMatchObject({
      rewardMiles: 50,
      nextRewardMiles: 10,
      ctaLabel: '続きから参加する',
    });
    expect(inProgressWebinar?.description).toContain('続きからあと約9分');

    sqlite.prepare(
      `UPDATE webinar_viewers
          SET last_position_seconds = 1263,
              cta_clicked_at = '2026-08-10T10:20:00.000+09:00'
        WHERE id = 'viewer-1'`,
    ).run();
    const completed = await getMileageEarningOpportunitiesForFriend(db, 'friend-1');
    expect(completed.filter((item) => item.type === 'webinar')).toEqual([]);
    expect(completed.filter((item) => item.type === 'friend_add')).toHaveLength(1);
  });

  it('shows one friend-add mileage mission for each active unregistered LINE account', async () => {
    sqlite.prepare(
      `INSERT INTO line_accounts
         (id, channel_id, name, channel_access_token, channel_secret, liff_id, display_order)
       VALUES ('account-3', 'channel-3', '公式C', 'token', 'secret',
               '2000000000-FriendC', 3)`,
    ).run();

    const opportunities = await getMileageEarningOpportunitiesForFriend(db, 'friend-1');
    expect(opportunities).toHaveLength(1);
    expect(opportunities[0]).toMatchObject({
      id: 'friend-add:account-3',
      type: 'friend_add',
      title: '公式Cを友だち追加',
      rewardMiles: 5,
      nextRewardMiles: 5,
      progressPercent: 0,
      ctaLabel: '友だち追加する',
    });
    expect(opportunities[0].description).toContain('4アカウント分のマイルを合算');
    expect(opportunities[0].url).toContain('2000000000-FriendC');

    sqlite.prepare(
      `INSERT INTO friends
         (id, line_user_id, display_name, user_id, line_account_id, is_following)
       VALUES ('friend-3', 'U3', 'ユーザーC', 'user-1', 'account-3', 1)`,
    ).run();
    const registered = await getMileageEarningOpportunitiesForFriend(db, 'friend-1');
    expect(registered).toHaveLength(1);
    expect(registered[0]).toMatchObject({
      id: 'friend-add:account-3',
      completed: true,
      mileageStatus: 'waiting',
      creditedMiles: 0,
      ctaLabel: '登録済み',
    });

    await applyMileageRulesForEvent(db, {
      eventType: 'friend_registered',
      source: 'line_relationship',
      sourceEventId: 'friend-3:friend_registered:2026-08-10T10:00:00.000+09:00',
      friendId: 'friend-3',
      occurredAt: '2026-08-10T10:00:00.000+09:00',
    });
    await processPendingMileageEvents(db, { now: '2026-08-10T10:05:00.000+09:00' });
    const credited = await getMileageEarningOpportunitiesForFriend(db, 'friend-1');
    expect(credited[0]).toMatchObject({
      completed: true,
      mileageStatus: 'credited',
      creditedMiles: 5,
    });
    expect(credited[0].description).toContain('+5 mile 加算済み');
  });

  it('keeps ingestion asynchronous and applies a configured tag reward and tier multiplier', async () => {
    sqlite.prepare(
      `INSERT INTO tags
         (id, name, color, mileage_reward, mileage_multiplier_bps, mileage_multiplier_priority)
       VALUES ('tier-gold', 'Gold会員', '#F59E0B', 20, 15000, 10)`,
    ).run();
    await addTagToFriend(db, 'friend-1', 'tier-gold');
    await applyMileageRulesForEvent(db, {
      eventType: 'form_submitted', source: 'form', sourceEventId: 'form-tier',
      friendId: 'friend-2', subjectKey: 'form-tier', occurredAt: '2026-08-10T10:00:00.000+09:00',
    });

    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(0);
    const queue = await processPendingMileageEvents(db, { now: '2026-08-10T10:05:00.000+09:00' });
    expect(queue).toMatchObject({ processed: 2, granted: 2, failed: 0 });
    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(35);

    const formLedger = sqlite.prepare(
      `SELECT amount, json_extract(metadata, '$.baseAmount') AS base_amount,
              json_extract(metadata, '$.multiplierBps') AS multiplier_bps
         FROM mileage_ledger WHERE source_event_id = 'form-tier'`,
    ).get();
    expect(formLedger).toEqual({ amount: 15, base_amount: 10, multiplier_bps: 15000 });
  });

  it('rewards registration and continuous following once without tier multiplication', async () => {
    sqlite.prepare(
      `UPDATE friends
          SET is_following = 1,
              first_followed_at = '2026-05-01T10:00:00.000+09:00',
              current_follow_started_at = '2026-05-01T10:00:00.000+09:00',
              last_followed_at = '2026-05-01T10:00:00.000+09:00'
        WHERE id = 'friend-1'`,
    ).run();
    sqlite.prepare(
      `INSERT INTO tags
         (id, name, color, mileage_multiplier_bps, mileage_multiplier_priority)
       VALUES ('tier-loyalty', '特別会員', '#84CC16', 15000, 20)`,
    ).run();
    await addTagToFriend(db, 'friend-1', 'tier-loyalty');

    const first = await enqueueFollowingMileageMilestones(db, {
      now: '2026-08-10T10:00:00.000+09:00',
      limitPerMilestone: 100,
    });
    expect(first).toMatchObject({ eventsCreated: 4, queued: 4 });
    await processPendingMileageEvents(db, { now: '2026-08-10T10:05:00.000+09:00' });
    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(85);

    const repeated = await enqueueFollowingMileageMilestones(db, {
      now: '2026-08-10T10:10:00.000+09:00',
      limitPerMilestone: 100,
    });
    expect(repeated).toMatchObject({ eventsCreated: 0, queued: 0 });
    await processPendingMileageEvents(db, { now: '2026-08-10T10:15:00.000+09:00' });
    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(85);

    const overview = await getMileageAdminOverview(db);
    expect(overview.members.find((item) => item.identityKey === 'user:user-1')).toMatchObject({
      unfollowCount: 0,
    });
  });

  it('resets the continuous-follow streak after a block and preserves earned miles', async () => {
    sqlite.prepare(
      `UPDATE friends
          SET is_following = 1,
              first_followed_at = '2026-07-01T10:00:00.000+09:00',
              current_follow_started_at = '2026-07-01T10:00:00.000+09:00',
              last_followed_at = '2026-07-01T10:00:00.000+09:00'
        WHERE id = 'friend-1'`,
    ).run();
    await enqueueFollowingMileageMilestones(db, {
      now: '2026-08-10T10:00:00.000+09:00',
      limitPerMilestone: 100,
    });
    await processPendingMileageEvents(db, { now: '2026-08-10T10:05:00.000+09:00' });
    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(35);

    await updateFriendFollowStatus(db, 'U1', false);
    await updateFriendFollowStatus(db, 'U1', true);
    const relationship = sqlite.prepare(
      `SELECT is_following, current_follow_started_at, unfollow_count
         FROM friends WHERE id = 'friend-1'`,
    ).get() as { is_following: number; current_follow_started_at: string | null; unfollow_count: number };
    expect(relationship.is_following).toBe(1);
    expect(relationship.current_follow_started_at).not.toBe('2026-07-01T10:00:00.000+09:00');
    expect(relationship.unfollow_count).toBe(1);

    const immediatelyAfter = await enqueueFollowingMileageMilestones(db, {
      now: '2026-08-10T10:10:00.000+09:00',
      limitPerMilestone: 100,
    });
    expect(immediatelyAfter.eventsCreated).toBe(0);
    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(35);
  });

  it('rewards the introducer for referred booking, viewing, purchase, and tag quality', async () => {
    sqlite.prepare(`INSERT INTO users (id, display_name) VALUES ('user-referrer', '紹介者')`).run();
    sqlite.prepare(
      `INSERT INTO friends
         (id, line_user_id, display_name, user_id, line_account_id, created_at, updated_at)
       VALUES ('friend-referrer', 'U-REFERRER', '紹介者', 'user-referrer', 'account-1',
               '2026-07-01T10:00:00.000+09:00', '2026-07-01T10:00:00.000+09:00')`,
    ).run();
    sqlite.prepare(
      `UPDATE friends
          SET created_at = '2026-08-01T10:00:00.000+09:00',
              updated_at = '2026-08-01T10:00:00.000+09:00'
        WHERE id = 'friend-1'`,
    ).run();
    sqlite.prepare(
      `INSERT INTO affiliates (id, name, code, friend_id)
       VALUES ('affiliate-referrer', '紹介者', 'REFERRER', 'friend-referrer')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO affiliate_links
         (id, affiliate_id, ref_code, is_active, created_at)
       VALUES ('affiliate-link-referrer', 'affiliate-referrer', 'GOODREF', 1,
               '2026-08-01T09:59:00.000+09:00')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
       VALUES ('ref-touch', 'GOODREF', 'friend-1', '2026-08-01T10:00:01.000+09:00')`,
    ).run();

    for (const sourceEventId of ['booking-quality-1', 'booking-quality-2']) {
      await applyMileageRulesForEvent(db, {
        eventType: 'booking_created', source: 'booking', sourceEventId,
        friendId: 'friend-1', occurredAt: '2026-08-05T10:00:00.000+09:00',
      });
    }
    for (const sourceEventId of ['watch-quality-1', 'watch-quality-2']) {
      await applyMileageRulesForEvent(db, {
        eventType: 'webinar_completed', source: 'webinar', sourceEventId,
        friendId: 'friend-1', subjectKey: 'webinar-quality',
        occurredAt: '2026-08-06T10:00:00.000+09:00',
      });
    }
    for (const sourceEventId of ['purchase-quality-1', 'purchase-quality-2']) {
      await applyMileageRulesForEvent(db, {
        eventType: 'purchase_completed', source: 'stripe', sourceEventId,
        friendId: 'friend-1', subjectKey: sourceEventId,
        occurredAt: '2026-08-07T10:00:00.000+09:00',
      });
    }
    sqlite.prepare(
      `INSERT INTO tags
         (id, name, color, mileage_reward, referral_mileage_reward)
       VALUES ('seminar-attended', 'セミナー参加', '#10B981', 10, 0)`,
    ).run();
    await addTagToFriend(db, 'friend-1', 'seminar-attended');

    await processPendingMileageEvents(db, {
      now: '2026-08-10T10:00:00.000+09:00',
      limit: 100,
    });
    expect((await getMileageSummaryForFriend(db, 'friend-referrer')).available).toBe(180);

    sqlite.prepare(
      `UPDATE tags SET referral_mileage_reward = 25 WHERE id = 'seminar-attended'`,
    ).run();
    expect(await enqueueHistoricTagMileage(db, 'seminar-attended')).toBeGreaterThan(0);
    await processPendingMileageEvents(db, {
      now: '2026-08-10T10:05:00.000+09:00',
      limit: 100,
    });
    const referrerSummary = await getMileageSummaryForFriend(db, 'friend-referrer');
    expect(referrerSummary.available).toBe(205);

    const referralEntries = sqlite.prepare(
      `SELECT amount, source, json_extract(metadata, '$.referredFriendId') AS referred_friend_id
         FROM mileage_ledger
        WHERE beneficiary_friend_id = 'friend-referrer'
        ORDER BY amount`,
    ).all();
    expect(referralEntries).toEqual([
      { amount: 25, source: 'tag_referral', referred_friend_id: 'friend-1' },
      { amount: 30, source: 'webinar', referred_friend_id: 'friend-1' },
      { amount: 50, source: 'booking', referred_friend_id: 'friend-1' },
      { amount: 100, source: 'stripe', referred_friend_id: 'friend-1' },
    ]);

    const overview = await getMileageAdminOverview(db);
    expect(overview.members.find((item) => item.identityKey === 'user:user-referrer')).toMatchObject({
      referralMiles: 205,
      qualityReferralCount: 1,
    });
    expect(await getMileageSelfInsights(db, 'friend-referrer')).toMatchObject({
      accountCount: 1,
      rewardedActions: 4,
      referralMiles: 205,
      qualityReferralCount: 1,
    });
  });

  it('does not award quality miles for a self-referral', async () => {
    sqlite.prepare(
      `INSERT INTO affiliates (id, name, code, friend_id)
       VALUES ('affiliate-self', '本人', 'SELF', 'friend-1')`,
    ).run();
    sqlite.prepare(
      `INSERT INTO affiliate_links (id, affiliate_id, ref_code, is_active, created_at)
       VALUES ('affiliate-link-self', 'affiliate-self', 'SELFREF', 1, '2026-08-01')`,
    ).run();
    sqlite.prepare(
      `UPDATE friends SET created_at = '2026-08-01T10:00:00.000+09:00' WHERE id = 'friend-1'`,
    ).run();
    sqlite.prepare(
      `INSERT INTO ref_tracking (id, ref_code, friend_id, created_at)
       VALUES ('self-touch', 'SELFREF', 'friend-1', '2026-08-01T10:00:01.000+09:00')`,
    ).run();

    await applyMileageRulesForEvent(db, {
      eventType: 'booking_created', source: 'booking', sourceEventId: 'self-booking',
      friendId: 'friend-1', occurredAt: '2026-08-02T10:00:00.000+09:00',
    });
    await processPendingMileageEvents(db, { now: '2026-08-10T10:00:00.000+09:00' });
    expect((await getMileageSummaryForFriend(db, 'friend-1')).available).toBe(20);
  });
});
