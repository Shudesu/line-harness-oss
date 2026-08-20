import { describe, expect, test } from 'vitest';
import type { ProgressRow } from './progress-rows.js';
import { buildProgressRows } from './progress-rows.js';

function labels(rows: ProgressRow[]): string[] {
  return rows.map((r) =>
    r.kind === 'migration-summary'
      ? `migration-summary:${r.total}/${r.skipped}`
      : `${r.step}:${r.status}${r.name ? `:${r.name}` : ''}`,
  );
}

describe('buildProgressRows', () => {
  test('running and done fold into one row per step, in first-seen order', () => {
    const rows = buildProgressRows([
      { step: 'worker', status: 'running' },
      { step: 'admin', status: 'running' },
      { step: 'worker', status: 'done' },
      { step: 'admin', status: 'done' },
    ]);
    expect(labels(rows)).toEqual(['worker:done', 'admin:done']);
  });

  test('completed migrations collapse into one row, skip marker included', () => {
    const rows = buildProgressRows([
      { step: 'migration', status: 'running', name: '001_a.sql' },
      { step: 'migration', status: 'done', name: '001_a.sql (already applied)' },
      { step: 'migration', status: 'running', name: '002_b.sql' },
      { step: 'migration', status: 'done', name: '002_b.sql' },
    ]);
    expect(rows).toEqual([
      {
        kind: 'migration-summary',
        key: 'migration-summary',
        total: 2,
        skipped: 1,
      },
    ]);
  });

  test('running and failed migrations keep an individual row', () => {
    const rows = buildProgressRows([
      { step: 'migration', status: 'running', name: '001_a.sql' },
      { step: 'migration', status: 'failed', name: '001_a.sql', error: 'blip' },
      { step: 'migration', status: 'running', name: '001_a.sql' },
      { step: 'migration', status: 'done', name: '001_a.sql' },
      { step: 'migration', status: 'running', name: '002_b.sql' },
      { step: 'migration', status: 'failed', name: '003_c.sql', error: 'boom' },
    ]);
    expect(labels(rows)).toEqual([
      'migration-summary:1/0',
      'migration:running:002_b.sql',
      'migration:failed:003_c.sql',
    ]);
    expect(rows[2]).toMatchObject({ error: 'boom' });
  });

  test('requires_secrets joins the Pre-flight row without moving its status', () => {
    const rows = buildProgressRows([
      { step: 'preflight', status: 'running' },
      { step: 'preflight', status: 'done' },
      {
        step: 'preflight',
        status: 'running',
        name: 'requires_secrets:ADMIN_ORIGIN,LIFF_ID',
      },
    ]);
    expect(labels(rows)).toEqual(['preflight:done']);
    expect(rows[0]).toMatchObject({ secrets: ['ADMIN_ORIGIN', 'LIFF_ID'] });
  });

  test('rollback keeps the cause it reported on the running event', () => {
    const rows = buildProgressRows([
      { step: 'rollback', status: 'running', error: 'health probe 503' },
      { step: 'rollback', status: 'done' },
    ]);
    expect(labels(rows)).toEqual(['rollback:done']);
    expect(rows[0]).toMatchObject({ error: 'health probe 503' });
  });
});
