#!/usr/bin/env tsx
/**
 * Migration safety static analysis.
 *
 * Enforces the additive-only migration policy (see CONTRIBUTING.md).
 * Scans SQL migration files for forbidden destructive constructs:
 *
 *   - DROP TABLE
 *   - DROP COLUMN
 *   - ALTER COLUMN ... TYPE ...
 *   - ALTER TABLE ... RENAME TO ... (rename table)
 *   - RENAME COLUMN
 *   - ADD COLUMN ... NOT NULL  (without DEFAULT after NOT NULL)
 *   - ADD UNIQUE / ADD CONSTRAINT ... UNIQUE
 *
 * Allowed:
 *   - CREATE TABLE
 *   - ALTER TABLE ... ADD COLUMN  (NULL or with DEFAULT)
 *   - CREATE [UNIQUE] INDEX
 *   - CREATE TRIGGER (complete BEGIN ... END body)
 *   - INSERT (seed data)
 *
 * Library API:
 *   checkMigration(sql) → { ok: true } | { ok: false, violation: string }
 *
 * CLI:
 *   tsx scripts/check-migrations.ts [--all] [file.sql ...]
 *
 * - No args → scans packages/db/migrations/*.sql, filtered to files whose
 *   numeric prefix is >= POLICY_CUTOFF_PREFIX (older migrations are
 *   grandfathered; the additive-only policy is forward-looking — see
 *   CONTRIBUTING.md §Migration Policy).
 * - `--all` → scans all .sql files in the default directory, no cutoff.
 *   Escape hatch for ad-hoc analysis. Cannot be combined with explicit
 *   file args (file args always bypass the cutoff anyway).
 * - With file args → checks the listed files exactly (bypasses cutoff).
 * - Prints "[FAIL] <file>: <violation>" per bad file, summary, exit 1
 * - Prints "OK — N migrations pass." on success
 */

import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { argv, exit, stderr, stdout } from 'node:process';
import {
  GRANDFATHERED_CUTOFF_PREFIX,
  isGrandfatheredMigration,
} from '../packages/update-engine/src/migrations.js';
import {
  splitSqlStatements,
  stripSqlComments,
} from '../packages/update-engine/src/sql-statements.js';

export type CheckResult = { ok: true } | { ok: false; violation: string };

interface Rule {
  // Human-readable violation prefix; the matched text is appended for context.
  label: string;
  // Matches against the comment-stripped SQL. Use case-insensitive regex.
  pattern: RegExp;
}

// Order matters: more specific rules first so messages are useful.
const RULES: Rule[] = [
  {
    label: 'DROP TABLE is forbidden (additive-only migrations)',
    pattern: /\bDROP\s+TABLE\b/i,
  },
  {
    label: 'DROP COLUMN is forbidden (additive-only migrations)',
    pattern: /\bDROP\s+COLUMN\b/i,
  },
  {
    label: 'RENAME COLUMN is forbidden (additive-only migrations)',
    pattern: /\bRENAME\s+COLUMN\b/i,
  },
  {
    label: 'ALTER COLUMN TYPE is forbidden (additive-only migrations)',
    // `ALTER COLUMN <name> TYPE <type>` and variants.
    pattern: /\bALTER\s+COLUMN\s+\S+\s+TYPE\b/i,
  },
  {
    label: 'RENAME TABLE is forbidden (additive-only migrations)',
    // `ALTER TABLE x RENAME TO y` — distinct from RENAME COLUMN.
    pattern: /\bALTER\s+TABLE\s+\S+\s+RENAME\s+TO\b/i,
  },
  {
    label:
      'ADD COLUMN ... NOT NULL without DEFAULT is forbidden (would break existing rows)',
    // Match `ADD COLUMN <name> <type...> NOT NULL` not followed by DEFAULT
    // on the same column definition (i.e. before the next `,` `;` or end).
    // The DEFAULT must come after NOT NULL on the same column def.
    pattern: /\bADD\s+COLUMN\s+\S+[^,;]*?\bNOT\s+NULL\b(?![^,;]*\bDEFAULT\b)/i,
  },
  {
    label: 'ADD UNIQUE constraint is forbidden (may violate existing rows)',
    // `ADD UNIQUE (...)` — explicit unique constraint via ALTER TABLE.
    // Note: `CREATE UNIQUE INDEX` is intentionally allowed (separate path).
    pattern: /\bADD\s+UNIQUE\b/i,
  },
  {
    label: 'ADD CONSTRAINT ... UNIQUE is forbidden (may violate existing rows)',
    pattern: /\bADD\s+CONSTRAINT\s+\S+\s+UNIQUE\b/i,
  },
];

export function checkMigration(sql: string): CheckResult {
  try {
    const stripped = stripSqlComments(sql);
    for (const rule of RULES) {
      const m = stripped.match(rule.pattern);
      if (m) {
        return { ok: false, violation: `${rule.label} (matched: "${m[0].trim()}")` };
      }
    }
    // Use the update engine's structural validation as well as policy rules:
    // CI must reject a malformed trigger before the updater can touch D1.
    splitSqlStatements(sql);
    return { ok: true };
  } catch (error) {
    return { ok: false, violation: error instanceof Error ? error.message : String(error) };
  }
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const DEFAULT_MIGRATIONS_DIR = 'packages/db/migrations';

/**
 * The additive-only Migration Policy (CONTRIBUTING.md) is forward-looking:
 * it applies to migrations numbered >= this prefix. Earlier migrations have
 * already been applied to production D1 and cannot be rewritten — they are
 * grandfathered. Bump this only when starting a new policy era.
 *
 * 単一ソースは packages/update-engine/src/migrations.ts の
 * GRANDFATHERED_CUTOFF_PREFIX (update-engine は「grandfathered かつ破壊的」な
 * migration を adoption 時に実行せず記録のみで通すため、境界がずれると
 * CI の合格範囲とエンジンの実行範囲が乖離する)。このスクリプトはリポ専用
 * (OSS 同期から除外) なので、published パッケージ側を import できる。
 */
export const POLICY_CUTOFF_PREFIX = GRANDFATHERED_CUTOFF_PREFIX;

/**
 * Filter the list of migration filenames (basenames, not full paths) to those
 * that fall under the active policy. With `all = true`, returns the input
 * unchanged (escape hatch for ad-hoc full scans).
 *
 * 判定はエンジンの isGrandfatheredMigration と同一 (単一ソース):
 * 3桁数字プレフィックスがカットオフ未満のものだけ免除。非数値・桁違いの
 * 命名はポリシー対象として必ずスキャンする — エンジン側も同じ判定で
 * splitSqlStatements の破壊ガードに回すため、「CI は素通りするのに更新は
 * 全環境で throw する」という非対称を作らない。
 */
export function filterMigrationsByPolicy(
  names: string[],
  options: { all?: boolean } = {},
): string[] {
  if (options.all) return names;
  return names.filter((name) => !isGrandfatheredMigration(name));
}

function listDefaultMigrations(options: { all?: boolean } = {}): string[] {
  const dir = resolve(DEFAULT_MIGRATIONS_DIR);
  const allNames = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const names = filterMigrationsByPolicy(allNames, options);
  return names.map((f) => join(dir, f));
}

function main(rawArgs: string[]): void {
  const all = rawArgs.includes('--all');
  const fileArgs = rawArgs.filter((a) => a !== '--all');

  const usingDefaults = fileArgs.length === 0;
  const files = usingDefaults ? listDefaultMigrations({ all }) : fileArgs;

  if (usingDefaults) {
    stdout.write(
      `Policy: additive-only applied to migrations >= ${POLICY_CUTOFF_PREFIX} (CONTRIBUTING.md §Migration Policy).\n` +
        `Older migrations grandfathered. Run with --all to override.\n`,
    );
  }

  if (files.length === 0) {
    stderr.write('check-migrations: no migration files found\n');
    exit(1);
  }

  const failures: { file: string; violation: string }[] = [];
  for (const file of files) {
    const sql = readFileSync(file, 'utf8');
    const result = checkMigration(sql);
    if (!result.ok) {
      failures.push({ file, violation: result.violation });
      stdout.write(`[FAIL] ${file}: ${result.violation}\n`);
    }
  }

  if (failures.length > 0) {
    stdout.write(`\n${failures.length} of ${files.length} migrations failed safety check.\n`);
    exit(1);
  }

  stdout.write(`OK — ${files.length} migrations pass.\n`);
}

const isCliEntry = (() => {
  if (!argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === argv[1];
  } catch {
    return false;
  }
})();

if (isCliEntry) {
  try {
    main(argv.slice(2));
  } catch (err) {
    stderr.write(`check-migrations: ${(err as Error).message}\n`);
    exit(1);
  }
}
