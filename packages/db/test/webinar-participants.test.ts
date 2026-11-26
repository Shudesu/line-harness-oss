import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import Database from 'better-sqlite3';
import { getWebinarParticipantStats } from '../src/webinars.js';

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(sql: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(sql);
          return {
            async all<T>() {
              return { success: true, results: statement.all(...params) as T[], meta: {} };
            },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('getWebinarParticipantStats', () => {
  let sqlite: Database.Database;

  beforeEach(() => {
    sqlite = new Database(':memory:');
    sqlite.exec(`
      CREATE TABLE friends (
        id TEXT PRIMARY KEY, display_name TEXT, picture_url TEXT
      );
      CREATE TABLE webinars (
        id TEXT PRIMARY KEY, created_at TEXT NOT NULL
      );
      CREATE TABLE webinar_viewers (
        id TEXT PRIMARY KEY, webinar_id TEXT NOT NULL, friend_id TEXT NOT NULL,
        session_start_at INTEGER NOT NULL, joined_at TEXT NOT NULL,
        last_position_seconds INTEGER NOT NULL DEFAULT 0, cta_clicked_at TEXT
      );
      CREATE TABLE webinar_registrations (
        id TEXT PRIMARY KEY, webinar_id TEXT NOT NULL, friend_id TEXT NOT NULL
      );
      CREATE TABLE webinar_ctas (
        id TEXT PRIMARY KEY, webinar_id TEXT NOT NULL, form_id TEXT
      );
      CREATE TABLE form_submissions (
        id TEXT PRIMARY KEY, form_id TEXT NOT NULL, friend_id TEXT, created_at TEXT NOT NULL
      );

      INSERT INTO friends VALUES ('friend-shu', 'Shu', 'https://example.com/shu.jpg');
      INSERT INTO webinars VALUES ('webinar-1', '2026-08-01T00:00:00+09:00');
      INSERT INTO webinar_registrations VALUES ('reg-1', 'webinar-1', 'friend-shu');
      INSERT INTO webinar_ctas VALUES ('cta-1', 'webinar-1', 'form-1');

      INSERT INTO webinar_viewers VALUES
        ('old', 'webinar-1', 'friend-shu', 100,
         '2026-08-06T09:30:01+09:00', 1263, '2026-08-06T09:36:00+09:00'),
        ('latest', 'webinar-1', 'friend-shu', 200,
         '2026-08-14T01:32:06+09:00', 276, NULL);

      INSERT INTO form_submissions VALUES
        ('old-form', 'form-1', 'friend-shu', '2026-08-06T09:37:00+09:00');
    `);
  });

  afterEach(() => sqlite.close());

  it('参加回数は全期間だが視聴・CTA・フォームは最新回だけを返す', async () => {
    const participants = await getWebinarParticipantStats(asD1(sqlite), 'webinar-1', 200);

    expect(participants).toEqual([
      expect.objectContaining({
        friend_id: 'friend-shu',
        sessions: 2,
        first_joined_at: '2026-08-06T09:30:01+09:00',
        latest_joined_at: '2026-08-14T01:32:06+09:00',
        latest_watched_seconds: 276,
        cta_clicked_at: null,
        registered: 1,
        form_submitted_at: null,
      }),
    ]);
  });
});
