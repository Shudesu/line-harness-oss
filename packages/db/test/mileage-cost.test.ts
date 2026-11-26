import { expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { getMileageSummaryForFriend } from '../src/mileage.js';

type Query = { sql: string; params: unknown[] };
async function capture(friend: string): Promise<Query[]> {
  const queries: Query[] = [];
  const db = { prepare(sql: string) { return { bind(...params: unknown[]) {
    return {
      async run() { queries.push({ sql, params }); return { success: true }; },
      async first() {
        queries.push({ sql, params });
        return { program_name: 'Synthetic', available: 0, pending: 0, lifetime_earned: 0, spent: 0 };
      },
    };
  } }; } } as unknown as D1Database;
  await getMileageSummaryForFriend(db, friend);
  return queries;
}

it('keeps wallet cost independent of unrelated data at 1x, 100x and 1000x', async () => {
  const queries = await capture('target');
  const emptyQueries = await capture('empty');
  // One idempotent program-bootstrap statement and one aggregate. New fan-out
  // must be explicitly reviewed, even if each individual query uses an index.
  expect(queries).toHaveLength(2);
  expect(emptyQueries).toHaveLength(2);
  const result = spawnSync('python3', [fileURLToPath(new URL('./helpers/wallet-cost-probe.py', import.meta.url))], {
    input: JSON.stringify({ schema: readFileSync(new URL('../bootstrap.sql', import.meta.url), 'utf8'),
      queries, empty_queries: emptyQueries }), encoding: 'utf8', timeout: 120_000, maxBuffer: 2_000_000,
  });
  expect(result.error, result.stderr).toBeUndefined();
  expect(result.status, result.stderr).toBe(0);
  const report = JSON.parse(result.stdout);
  expect(report.unit).toBe('sqlite_vm_instructions_not_d1_rows');
  expect(report.unrelated_growth.map((r: { scale: number }) => r.scale)).toEqual([1, 100, 1000]);
  console.info('wallet-cost-report', JSON.stringify({ unit: report.unit, sqlite: report.sqlite_version,
    unrelated: report.unrelated_growth.map((r: any) => ({ scale: r.scale, vm: r.target.vm_instructions_approx, emptyVm: r.empty.vm_instructions_approx })),
    ownHistory: report.own_history_growth.map((r: any) => ({ scale: r.scale, vm: r.vm_instructions_approx })),
    missingIndexVm: report.missing_index_control.vm_instructions_approx,
  }));
}, 130_000);
