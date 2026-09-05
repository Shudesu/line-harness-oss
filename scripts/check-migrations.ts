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
    label: 'CREATE TRIGGER is unsupported by the safe statement splitter',
    pattern: /\bCREATE\s+(?:TEMP(?:ORARY)?\s+)?TRIGGER\b/i,
  },
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

/**
 * Strip `--` line comments. Block comments (`/* ... *\/`) are rare in
 * D1 migrations and ignored for now; if they appear we still get correct
 * results because the rules match real DDL anyway. Keeping the stripper
 * simple avoids accidentally hiding real code inside `/* ... *\/`.
 */
function stripLineComments(sql: string): string {
  return sql
    .split('\n')
    .map((line) => {
      const idx = line.indexOf('--');
      return idx === -1 ? line : line.slice(0, idx);
    })
    .join('\n');
}

export function checkMigration(sql: string): CheckResult {
  const stripped = stripLineComments(sql);
  for (const rule of RULES) {
    const m = stripped.match(rule.pattern);
    if (m) {
      return { ok: false, violation: `${rule.label} (matched: "${m[0].trim()}")` };
    }
  }
  return { ok: true };
}

// ─── CLI ──────────────────────────────────────────────────────────────────────

const DEFAULT_MIGRATIONS_DIR = 'packages/db/migrations';

/**
 * The additive-only Migration Policy (CONTRIBUTING.md) is forward-looking:
 * it applies to migrations numbered >= this prefix. Earlier migrations have
 * already been applied to production D1 and cannot be rewritten — they are
 * grandfathered. Bump this only when starting a new policy era.
 *
 * String comparison works here because migration prefixes are numeric and
 * zero-padded (`001`..`041`..), so lexicographic order matches numeric order.
 */
export const POLICY_CUTOFF_PREFIX = '041';

/**
 * Filter the list of migration filenames (basenames, not full paths) to those
 * that fall under the active policy. With `all = true`, returns the input
 * unchanged (escape hatch for ad-hoc full scans).
 *
 * Files whose name starts with a prefix >= POLICY_CUTOFF_PREFIX pass. Files
 * with non-numeric or shorter prefixes pass through too (the comparison is
 * lexicographic and any newer naming scheme is assumed in-policy until we
 * decide otherwise).
 */
export function filterMigrationsByPolicy(
  names: string[],
  options: { all?: boolean } = {},
): string[] {
  if (options.all) return names;
  return names.filter((name) => name >= POLICY_CUTOFF_PREFIX);
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
