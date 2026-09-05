import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import Database from 'better-sqlite3';
import { describe, expect, it } from 'vitest';
import { applyD1Migrations } from '../src/migrations.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = join(HERE, '..', '..', '..');
const MIGRATIONS_DIR = join(REPO, 'packages', 'db', 'migrations');
const creds = { accountId: 'test', apiToken: 'test' };

const allMigrationNames = readdirSync(MIGRATIONS_DIR)
  // v0.14.1's base schema already contains the final 001-036 structures,
  // including two historical table-rebuild migrations. Replaying those
  // destructive files would be less safe than using the supported additive
  // bridge, which starts at the first feature missing from that base schema.
  .filter((name) => /^(?:03[7-9]|0[4-9][0-9]|[1-9][0-9][0-9])_.*\.sql$/.test(name))
  .sort();
const allMigrations = new Map(
  allMigrationNames.map((name) => [
    name,
    readFileSync(join(MIGRATIONS_DIR, name)),
  ]),
);

type SqliteExecutor = NonNullable<Parameters<typeof applyD1Migrations>[0]['execute']>;

function sqliteExecutor(db: Database.Database): SqliteExecutor {
  return (async (opts: { sql: string; params?: any[] }) => {
    const statement = db.prepare(opts.sql);
    const params = opts.params ?? [];
    if (statement.reader) {
      return {
        success: true,
        result: [{ success: true, results: statement.all(...params) }],
      };
    }
    statement.run(...params);
    return { success: true, result: [{ success: true, results: [] }] };
  }) as SqliteExecutor;
}

function taggedSql(tag: string, path: string): string {
  return execFileSync('git', ['show', `${tag}:${path}`], {
    cwd: REPO,
    encoding: 'utf8',
  });
}

function taggedMigrationNames(tag: string): string[] {
  return execFileSync(
    'git',
    ['ls-tree', '-r', '--name-only', tag, 'packages/db/migrations'],
    { cwd: REPO, encoding: 'utf8' },
  )
    .trim()
    .split('\n')
    .filter((path) => path.endsWith('.sql'))
    .sort();
}

function createHistoricalDb(tag: string): Database.Database {
  const db = new Database(':memory:');
  const bootstrapPath = tag === 'v0.14.1'
    ? 'packages/db/schema.sql'
    : 'packages/db/bootstrap.sql';
  db.exec(taggedSql(tag, bootstrapPath));
  if (tag === 'v0.14.1') {
    // v0.14.1 setup ran schema.sql and then every migration available at
    // that tag. Reproduce its old whole-file/benign-error behavior so this
    // fixture represents an installed database, not schema.sql in isolation.
    for (const path of taggedMigrationNames(tag)) {
      try {
        db.transaction(() => db.exec(taggedSql(tag, path)))();
      } catch (error) {
        const message = error instanceof Error ? error.message.toLowerCase() : String(error);
        if (!message.includes('duplicate column') && !message.includes('already exists')) {
          throw error;
        }
      }
    }
  }
  return db;
}

async function applyAll(db: Database.Database): Promise<void> {
  await applyD1Migrations({
    creds,
    databaseId: 'local',
    names: allMigrationNames,
    migrations: allMigrations,
    execute: sqliteExecutor(db),
  });
}

function assertLatestSchema(db: Database.Database): void {
  const trackedLinkColumns = db
    .prepare('PRAGMA table_info(tracked_links)')
    .all() as Array<{ name: string }>;
  const broadcastColumns = db
    .prepare('PRAGMA table_info(broadcasts)')
    .all() as Array<{ name: string }>;
  const richMenuColumns = db
    .prepare('PRAGMA table_info(rich_menu_groups)')
    .all() as Array<{ name: string }>;

  expect(trackedLinkColumns.map((column) => column.name)).toEqual(
    expect.arrayContaining(['line_account_id', 'dedup_key']),
  );
  expect(broadcastColumns.map((column) => column.name)).toContain('track_links');
  expect(richMenuColumns.map((column) => column.name)).toContain('selected');
  expect(
    db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='webinars'").get(),
  ).toBeTruthy();
  expect(
    db.prepare('SELECT COUNT(*) AS count FROM _line_harness_migrations').get(),
  ).toEqual({ count: allMigrationNames.length });
}

describe('safe upgrade matrix', () => {
  for (const tag of [
    'v0.14.1',
    'v0.15.0',
    'v0.16.0',
    'v0.17.0',
    'v0.18.0',
    'v0.18.1',
  ]) {
    it(`${tag} database reaches the latest schema`, async () => {
      const db = createHistoricalDb(tag);
      try {
        db.exec(
          "INSERT INTO friends (id, line_user_id, display_name) VALUES ('sentinel-friend', 'U-sentinel', 'preserve me')",
        );
        db.exec(
          "INSERT INTO broadcasts (id, title, message_type, message_content, target_type, status) VALUES ('sentinel-broadcast', 'preserve me', 'text', 'hello', 'all', 'draft')",
        );
        await applyAll(db);
        assertLatestSchema(db);
        expect(db.prepare("SELECT display_name FROM friends WHERE id='sentinel-friend'").get()).toEqual(
          { display_name: 'preserve me' },
        );
        expect(db.prepare("SELECT title FROM broadcasts WHERE id='sentinel-broadcast'").get()).toEqual(
          { title: 'preserve me' },
        );
        // A retry must use the checksum ledger and remain a no-op.
        await applyAll(db);
        assertLatestSchema(db);
      } finally {
        db.close();
      }
    });
  }

  for (const [version, lastMigration] of [
    ['v0.19.0', '056_webinar_registrations.sql'],
    ['v0.20.0', '066_referral_quality_mileage.sql'],
    ['v0.21.0', '068_media_inquiries.sql'],
    ['v0.21.1', '068_media_inquiries.sql'],
    ['v0.21.2', '069_rich_menu_selected.sql'],
  ] as const) {
    it(`${version} cumulative database reaches the latest schema`, async () => {
      const db = createHistoricalDb('v0.18.1');
      try {
        const lastIndex = allMigrationNames.indexOf(lastMigration);
        expect(lastIndex).toBeGreaterThanOrEqual(0);
        await applyD1Migrations({
          creds,
          databaseId: 'local',
          names: allMigrationNames.slice(0, lastIndex + 1),
          migrations: allMigrations,
          execute: sqliteExecutor(db),
        });
        // Historical releases did not have the new checksum ledger. Remove
        // it so the target update has to reconcile the existing schema.
        db.exec('DROP TABLE _line_harness_migrations');

        await applyAll(db);
        assertLatestSchema(db);
      } finally {
        db.close();
      }
    });
  }

  it('repairs a migration file that was only partially applied', async () => {
    const db = createHistoricalDb('v0.18.1');
    try {
      // Reproduce Issue #271: first statement exists, second statement is
      // missing. The old whole-file runner rolled both back/skipped together.
      const columns = db.prepare('PRAGMA table_info(broadcasts)').all() as Array<{ name: string }>;
      if (!columns.some((column) => column.name === 'track_links')) {
        db.exec('ALTER TABLE broadcasts ADD COLUMN track_links INTEGER NOT NULL DEFAULT 1');
      }

      await applyAll(db);
      assertLatestSchema(db);
    } finally {
      db.close();
    }
  });
});
