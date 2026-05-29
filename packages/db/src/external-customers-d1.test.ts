import { Miniflare } from 'miniflare';
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import {
  linkFriendToExternalCustomer,
  listExternalCustomerLinksForFriend,
  normalizeEmail,
  normalizePhone,
  resetExternalCustomerSchemaCacheForTest,
  searchExternalCustomerProfiles,
  unlinkFriendFromExternalCustomer,
  upsertExternalCustomerProfile,
} from './index.js';

const mf = new Miniflare({
  modules: true,
  script: 'export default { fetch() { return new Response("ok") } }',
  d1Databases: ['DB'],
});

let db: D1Database;

async function resetDb() {
  db = await mf.getD1Database('DB');
  resetExternalCustomerSchemaCacheForTest(db);
  await db.batch([
    db.prepare('DROP TABLE IF EXISTS customer_notes'),
    db.prepare('DROP TABLE IF EXISTS friend_external_customer_links'),
    db.prepare('DROP TABLE IF EXISTS external_customer_profiles'),
    db.prepare('DROP TABLE IF EXISTS friends'),
  ]);
  await db.batch([
    db.prepare(
      `CREATE TABLE friends (
        id TEXT PRIMARY KEY,
        line_user_id TEXT UNIQUE NOT NULL,
        display_name TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      )`,
    ),
  ]);
  await db
    .prepare(`INSERT INTO friends (id, line_user_id, display_name) VALUES ('friend_1', 'Ucustomer1', 'LINE顧客')`)
    .run();
}

afterAll(() => mf.dispose());

describe('external customers — D1 integration', () => {
  beforeEach(resetDb);

  it('normalizes phone and email before storage/search', () => {
    expect(normalizePhone('090-1234-5678')).toBe('09012345678');
    expect(normalizePhone(' 03 1234 5678 ')).toBe('0312345678');
    expect(normalizeEmail(' TEST@Example.COM ')).toBe('test@example.com');
  });

  it('upserts by source + externalId and does not create duplicates', async () => {
    const first = await upsertExternalCustomerProfile(db, {
      source: 'legacy_csv',
      externalId: 'cust_001',
      name: '山田 太郎',
      phone: '090-1111-2222',
      email: 'YAMADA@example.com',
      metadata: { rank: 'gold' },
    });
    const second = await upsertExternalCustomerProfile(db, {
      source: 'legacy_csv',
      externalId: 'cust_001',
      name: '山田 太郎 更新',
      phone: '09011112222',
      email: 'yamada@example.com',
      metadata: { rank: 'platinum' },
    });

    expect(second.id).toBe(first.id);
    expect(second.name).toBe('山田 太郎 更新');
    expect(second.phone).toBe('09011112222');
    expect(second.email).toBe('yamada@example.com');

    const rows = await searchExternalCustomerProfiles(db, { query: '山田' });
    expect(rows).toHaveLength(1);
  });

  it('allows multiple customers without externalId and searches by phone/email/name', async () => {
    await upsertExternalCustomerProfile(db, {
      source: 'manual',
      name: '佐藤 花子',
      phone: '080-2222-3333',
      email: 'sato@example.com',
    });
    await upsertExternalCustomerProfile(db, {
      source: 'manual',
      name: '佐藤 次郎',
      phone: '080-9999-3333',
      email: 'jiro@example.com',
    });

    expect(await searchExternalCustomerProfiles(db, { query: '佐藤' })).toHaveLength(2);
    expect(await searchExternalCustomerProfiles(db, { query: '08022223333' })).toHaveLength(1);
    expect(await searchExternalCustomerProfiles(db, { query: 'SATO@EXAMPLE.COM' })).toHaveLength(1);
  });

  it('links friend and external customer idempotently', async () => {
    const customer = await upsertExternalCustomerProfile(db, {
      source: 'legacy_csv',
      externalId: 'cust_002',
      name: '田中 一郎',
    });

    const first = await linkFriendToExternalCustomer(db, {
      friendId: 'friend_1',
      externalCustomerId: customer.id,
      linkMethod: 'manual',
    });
    const second = await linkFriendToExternalCustomer(db, {
      friendId: 'friend_1',
      externalCustomerId: customer.id,
      linkMethod: 'manual',
    });

    expect(second.id).toBe(first.id);
    const links = await listExternalCustomerLinksForFriend(db, 'friend_1');
    expect(links).toHaveLength(1);
    expect(links[0].customer.name).toBe('田中 一郎');
  });

  it('unlinks friend and external customer', async () => {
    const customer = await upsertExternalCustomerProfile(db, {
      source: 'legacy_csv',
      externalId: 'cust_003',
      name: '鈴木 三郎',
    });
    await linkFriendToExternalCustomer(db, {
      friendId: 'friend_1',
      externalCustomerId: customer.id,
    });

    await unlinkFriendFromExternalCustomer(db, 'friend_1', customer.id);

    const links = await listExternalCustomerLinksForFriend(db, 'friend_1');
    expect(links).toHaveLength(0);
  });
});
