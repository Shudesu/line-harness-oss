import { beforeEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createForm, updateForm } from '../src/forms.js';

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const benignMigrationError = /duplicate column name|already exists/i;

function setupDb(): Database.Database {
  const sqlite = new Database(':memory:');
  const apply = (sql: string): void => {
    for (const statement of sql.split(/;\s*(?:\r?\n|$)/).map((item) => item.trim()).filter(Boolean)) {
      try {
        sqlite.exec(statement);
      } catch (error) {
        if (!benignMigrationError.test(error instanceof Error ? error.message : String(error))) throw error;
      }
    }
  };
  apply(readFileSync(join(packageRoot, 'schema.sql'), 'utf8'));
  for (const file of readdirSync(join(packageRoot, 'migrations')).filter((name) => name.endsWith('.sql')).sort()) {
    apply(readFileSync(join(packageRoot, 'migrations', file), 'utf8'));
  }
  return sqlite;
}

function asD1(sqlite: Database.Database): D1Database {
  return {
    prepare(query: string) {
      return {
        bind(...params: unknown[]) {
          const statement = sqlite.prepare(query);
          return {
            async run() { statement.run(...params); return { results: [], success: true, meta: {} }; },
            async first<T>() { return (statement.get(...params) as T) ?? null; },
          };
        },
      };
    },
  } as unknown as D1Database;
}

describe('form submit message toggle', () => {
  let db: D1Database;

  beforeEach(() => {
    db = asD1(setupDb());
  });

  test('persists disabled on create and can re-enable it on update', async () => {
    const form = await createForm(db, {
      name: '見積もり依頼',
      fields: '[]',
      sendSubmitMessage: false,
    });
    expect(form.send_submit_message).toBe(0);

    const updated = await updateForm(db, form.id, { sendSubmitMessage: true });
    expect(updated?.send_submit_message).toBe(1);
  });

  test('keeps existing form behavior enabled by default', async () => {
    const form = await createForm(db, { name: '既存フォーム', fields: '[]' });
    expect(form.send_submit_message).toBe(1);
  });
});
