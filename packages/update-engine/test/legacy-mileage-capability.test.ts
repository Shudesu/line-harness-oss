import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { applyD1Migrations } from '../src/migrations.js';

const name = '062_mileage_admin_and_activity_rules.sql';
const source = readFileSync(new URL(`../../db/migrations/${name}`, import.meta.url));
const checksum = `sha256:${createHash('sha256').update(source).digest('hex')}`;
const options = {
  creds: { accountId: 'fixture-account', apiToken: 'fixture-token' }, databaseId: 'fixture-db',
  names: [name], migrations: new Map([[name, source]]),
};

describe('legacy mileage target capability', () => {
  it('does not start historical replay when the target Worker cannot claim held history', async () => {
    const execute = vi.fn(async (_opts: { sql: string }) => ({ success: true, result: [{ success: true, results: [] }] }));
    await expect(applyD1Migrations({ ...options, execute })).rejects.toThrow('legacy_mileage_projection_version=1');
    const sql = execute.mock.calls.map(call => (call[0] as {sql: string}).sql);
    expect(sql).toHaveLength(2); // Ledger existence and checksum lookup only.
    expect(sql.join('\n')).not.toMatch(/ALTER TABLE mileage_ledger|INSERT|legacy_mileage_claims/i);
  });

  it('keeps matching-checksum updates to older targets as no-ops', async () => {
    const execute = vi.fn(async ({sql}: {sql: string}) => ({
      success: true, result: [{ success: true, results: sql.startsWith('SELECT checksum') ? [{checksum}]
        : sql.includes('claims_table') ? [{claims_table: 0}] : [] }],
    }));
    const result = await applyD1Migrations({ ...options, execute });
    expect(result).toEqual([{name, alreadyApplied: true, executedStatements: 0, skippedStatements: 0}]);
    expect(execute).toHaveBeenCalledTimes(3);
  });

  it('does not strand existing held claims behind a matching checksum when selecting an old Worker', async () => {
    const execute = vi.fn(async ({sql}: {sql: string}) => ({
      success: true, result: [{ success: true, results:
        sql.startsWith('SELECT checksum') ? [{checksum}] : sql.includes('claims_table') ? [{claims_table: 1}]
          : sql.includes('AS unfinished') ? [{unfinished: 1}] : [],
      }],
    }));
    await expect(applyD1Migrations({ ...options, execute })).rejects.toThrow('handoff is unfinished');
    expect(execute.mock.calls.every(([input]) => !input.sql.startsWith('INSERT'))).toBe(true);
  });

  it('rejects changed or renamed historical SQL before contacting D1', async () => {
    const execute = vi.fn();
    await expect(applyD1Migrations({ ...options, execute, legacyMileageProjectionVersion: 1,
      migrations: new Map([[name, Buffer.concat([source, Buffer.from('\n-- changed')])]]),
    })).rejects.toThrow(/unknown historical mileage SQL/);
    const renamed = '062_renamed_history.sql';
    await expect(applyD1Migrations({ ...options, execute, legacyMileageProjectionVersion: 1,
      names: [renamed], migrations: new Map([[renamed, source]]),
    })).rejects.toThrow(/unknown historical mileage SQL|Unsupported legacy mileage/);
    expect(execute).not.toHaveBeenCalled();
  });
});
