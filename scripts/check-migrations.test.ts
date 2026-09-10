import { describe, expect, it } from 'vitest';
import {
  POLICY_CUTOFF_PREFIX,
  checkMigration,
  filterMigrationsByPolicy,
} from './check-migrations';

describe('checkMigration', () => {
  it('allows complete CREATE TRIGGER bodies', () => {
    const result = checkMigration(
      'CREATE TRIGGER audit AFTER INSERT ON friends BEGIN INSERT INTO logs VALUES (NEW.id); END;',
    );
    expect(result).toEqual({ ok: true });
  });

  it.each([
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1;',
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1 END;',
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT CASE WHEN 1 THEN 2; END;',
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN END;',
    'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END CREATE TABLE b (id);',
  ])('rejects structurally malformed triggers: %s', (sql) => {
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toContain('CREATE TRIGGER');
  });

  it('still applies additive rules to SQL following a trigger', () => {
    const trigger = 'CREATE TRIGGER t AFTER INSERT ON a BEGIN SELECT 1; END;';
    const result = checkMigration(`${trigger} ALTER TABLE a ADD COLUMN required TEXT NOT NULL;`);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toContain('NOT NULL');
  });

  it('does not let a comment marker inside a string hide destructive SQL', () => {
    const result = checkMigration("SELECT '--'; DROP TABLE foo;");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toContain('DROP TABLE');
  });

  it('ignores block comments without merging adjacent keywords', () => {
    expect(checkMigration('/* DROP TABLE foo; */ CREATE TABLE foo (id INTEGER);')).toEqual({ ok: true });
    const result = checkMigration('DROP/**/TABLE foo;');
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toContain('DROP TABLE');
  });

  it('reports unterminated quotes and comments through the library result', () => {
    expect(checkMigration("SELECT 'unfinished;").ok).toBe(false);
    expect(checkMigration('CREATE TABLE foo (id); /* unfinished').ok).toBe(false);
  });
  it('allows CREATE TABLE', () => {
    const sql = `CREATE TABLE foo (id INTEGER PRIMARY KEY, name TEXT);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows ALTER TABLE ADD COLUMN with DEFAULT', () => {
    const sql = `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'pending';`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows ALTER TABLE ADD COLUMN with NULL (no NOT NULL)', () => {
    const sql = `ALTER TABLE foo ADD COLUMN nickname TEXT;`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows CREATE INDEX', () => {
    const sql = `CREATE INDEX idx_foo_name ON foo (name);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('allows INSERT seed data', () => {
    const sql = `INSERT INTO foo (id, name) VALUES (1, 'seed');`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('blocks DROP TABLE', () => {
    const sql = `DROP TABLE foo;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP TABLE/i);
  });

  it('blocks DROP COLUMN', () => {
    const sql = `ALTER TABLE foo DROP COLUMN name;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/DROP COLUMN/i);
  });

  it('blocks RENAME TABLE (ALTER TABLE x RENAME TO y)', () => {
    const sql = `ALTER TABLE foo RENAME TO bar;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME/i);
  });

  it('blocks RENAME COLUMN', () => {
    const sql = `ALTER TABLE foo RENAME COLUMN old_name TO new_name;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/RENAME COLUMN/i);
  });

  it('blocks ALTER COLUMN TYPE', () => {
    const sql = `ALTER TABLE foo ALTER COLUMN id TYPE INTEGER;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/ALTER COLUMN TYPE/i);
  });

  it('blocks NOT NULL without default', () => {
    const sql = `ALTER TABLE foo ADD COLUMN required_field TEXT NOT NULL;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/NOT NULL/i);
  });

  it('allows NOT NULL with DEFAULT', () => {
    const sql = `ALTER TABLE foo ADD COLUMN status TEXT NOT NULL DEFAULT 'active';`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('blocks ADD UNIQUE constraint (inline)', () => {
    const sql = `ALTER TABLE foo ADD UNIQUE (email);`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('blocks ADD CONSTRAINT UNIQUE', () => {
    const sql = `ALTER TABLE foo ADD CONSTRAINT foo_email_unique UNIQUE (email);`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.violation).toMatch(/UNIQUE/i);
  });

  it('ignores -- line comments (DROP TABLE in comment is OK)', () => {
    const sql = `-- DROP TABLE foo;\nCREATE TABLE bar (id INTEGER);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('ignores comments mentioning forbidden constructs', () => {
    const sql = `-- This adds a column. We must NOT NULL would be bad without default.\nALTER TABLE foo ADD COLUMN x TEXT;`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('returns first violation if multiple', () => {
    const sql = `DROP TABLE foo;\nDROP TABLE bar;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
  });

  it('allows CREATE UNIQUE INDEX (this is index, not ADD UNIQUE constraint)', () => {
    const sql = `CREATE UNIQUE INDEX idx_foo_email ON foo (email);`;
    expect(checkMigration(sql)).toEqual({ ok: true });
  });

  it('handles case-insensitive matching', () => {
    const sql = `drop table foo;`;
    const result = checkMigration(sql);
    expect(result.ok).toBe(false);
  });
});

describe('filterMigrationsByPolicy', () => {
  const sample = [
    '001_round2.sql',
    '027_dedup_delivery.sql',
    '029_account_management_v2.sql',
    '040_events_multi_account.sql',
    '041_update_history.sql',
    '042_future.sql',
  ];

  it('returns only files with prefix >= POLICY_CUTOFF_PREFIX by default', () => {
    expect(POLICY_CUTOFF_PREFIX).toBe('041');
    expect(filterMigrationsByPolicy(sample)).toEqual([
      '041_update_history.sql',
      '042_future.sql',
    ]);
  });

  it('returns only files with prefix >= POLICY_CUTOFF_PREFIX when all is false', () => {
    expect(filterMigrationsByPolicy(sample, { all: false })).toEqual([
      '041_update_history.sql',
      '042_future.sql',
    ]);
  });

  it('returns all files when all flag is true', () => {
    expect(filterMigrationsByPolicy(sample, { all: true })).toEqual(sample);
  });

  it('excludes the pre-existing 027 / 029 violations under the default cutoff', () => {
    const filtered = filterMigrationsByPolicy(sample);
    expect(filtered).not.toContain('027_dedup_delivery.sql');
    expect(filtered).not.toContain('029_account_management_v2.sql');
  });

  it('returns an empty array when no files meet the cutoff', () => {
    expect(filterMigrationsByPolicy(['001_a.sql', '010_b.sql'])).toEqual([]);
  });
});
