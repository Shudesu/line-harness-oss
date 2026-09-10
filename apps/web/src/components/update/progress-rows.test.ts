import { describe, expect, test } from 'vitest'
import type { UpdateEvent } from '@line-harness/update-engine'
import { buildProgressRows } from './progress-rows'

describe('buildProgressRows', () => {
  test('keeps first-seen phase order and updates running rows in place', () => {
    const rows = buildProgressRows([
      { step: 'worker', status: 'running' }, { step: 'admin', status: 'pending' },
      { step: 'worker', status: 'done' }, { step: 'admin', status: 'done' },
    ])
    expect(rows.map((row) => row.kind === 'step' && [row.step, row.status])).toEqual([
      ['worker', 'done'], ['admin', 'done'],
    ])
  })

  test('deduplicates completion events while retaining applied, skipped and adopted evidence', () => {
    const events: UpdateEvent[] = [
      { step: 'migration', status: 'running', name: '001_a.sql' },
      { step: 'migration', status: 'done', name: '001_a.sql' },
      { step: 'migration', status: 'running', name: '002_b.sql' },
      { step: 'migration', status: 'done', name: '002_b.sql (already applied)' },
      { step: 'migration', status: 'running', name: '003_c.sql' },
      { step: 'migration', status: 'done', name: '003_c.sql (adopted, not executed)' },
    ]
    const rows = buildProgressRows([...events, ...events])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ kind: 'migration-summary', total: 3, applied: 1, skipped: 1, adopted: 1 })
    if (rows[0].kind !== 'migration-summary') throw new Error('missing summary')
    expect(rows[0].completed.map((row) => [row.name, row.outcome])).toEqual([
      ['001_a.sql', 'applied'], ['002_b.sql', 'skipped'], ['003_c.sql', 'adopted'],
    ])
  })

  test('keeps pending, running and failed migrations individually with their errors', () => {
    const rows = buildProgressRows([
      { step: 'migration', status: 'done', name: '001.sql' },
      { step: 'migration', status: 'running', name: '002.sql' },
      { step: 'migration', status: 'failed', name: '002.sql', error: 'constraint failed' },
      { step: 'migration', status: 'running', name: '003.sql' },
      { step: 'migration', status: 'pending', name: '004.sql' },
    ])
    expect(rows).toHaveLength(4)
    expect(rows[1]).toMatchObject({ kind: 'step', name: '002.sql', status: 'failed', errors: ['constraint failed'] })
    expect(rows[2]).toMatchObject({ name: '003.sql', status: 'running' })
    expect(rows[3]).toMatchObject({ name: '004.sql', status: 'pending' })
  })

  test('does not discard a failed attempt when its retry finishes', () => {
    const rows = buildProgressRows([
      { step: 'migration', status: 'failed', name: '001.sql', error: 'first failure' },
      { step: 'migration', status: 'running', name: '001.sql' },
      { step: 'migration', status: 'done', name: '001.sql' },
    ])
    expect(rows[0]).toMatchObject({ kind: 'migration-summary', total: 1, completed: [{ errors: ['first failure'] }] })
  })

  test('uses the full filename, not the shared migration number', () => {
    expect(buildProgressRows([
      { step: 'migration', status: 'done', name: '072_broadcast_last_error.sql' },
      { step: 'migration', status: 'done', name: '072_health_logs_composite_index.sql' },
    ])[0]).toMatchObject({ total: 2, applied: 2 })
  })

  test('merges required secret names without regressing preflight status', () => {
    const rows = buildProgressRows([
      { step: 'preflight', status: 'running' },
      { step: 'preflight', status: 'done' },
      { step: 'preflight', status: 'running', name: 'requires_secrets: A, B,,A' },
      { step: 'preflight', status: 'running', name: 'requires_secrets:B,C' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ status: 'done', secrets: ['A', 'B', 'C'], notes: [] })
  })

  test('preserves rollback causes across repeated running and empty done events', () => {
    const rows = buildProgressRows([
      { step: 'rollback', status: 'running', error: 'health probe failed' },
      { step: 'rollback', status: 'running' },
      { step: 'rollback', status: 'failed', error: 'snapshot unavailable' },
      { step: 'rollback', status: 'done' },
    ])
    expect(rows[0]).toMatchObject({ status: 'done', errors: ['health probe failed', 'snapshot unavailable'] })
  })

  test('folds a skipped LIFF phase into its existing phase row and keeps the reason', () => {
    const rows = buildProgressRows([
      { step: 'liff', status: 'running' },
      { step: 'liff', status: 'done', name: 'skipped (worker-assets install)' },
    ])
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ step: 'liff', status: 'done', notes: ['skipped (worker-assets install)'] })
  })

  test('retains earlier adoption evidence while counting the latest result once', () => {
    expect(buildProgressRows([
      { step: 'migration', status: 'done', name: '027.sql (adopted, not executed)' },
      { step: 'migration', status: 'done', name: '027.sql (already applied)' },
    ])[0]).toMatchObject({ total: 1, adopted: 0, skipped: 1, completed: [{ outcomeHistory: ['adopted', 'skipped'] }] })
  })

  test('does not mutate input or invent a shared identity for unnamed migrations', () => {
    const events = Object.freeze([
      Object.freeze({ step: 'migration', status: 'running' } as const),
      Object.freeze({ step: 'migration', status: 'failed', error: 'unknown migration' } as const),
    ])
    expect(buildProgressRows(events)).toHaveLength(2)
    expect(buildProgressRows([])).toEqual([])
  })

  test('collapses the reported 80-migration case without losing any filenames', () => {
    const events: UpdateEvent[] = Array.from({ length: 80 }, (_, i) => [
      { step: 'migration', status: 'running', name: `${i}_migration.sql` },
      { step: 'migration', status: 'done', name: `${i}_migration.sql (already applied)` },
    ] as UpdateEvent[]).flat()
    const rows = buildProgressRows(events)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({ total: 80, skipped: 80 })
    if (rows[0].kind !== 'migration-summary') throw new Error('missing summary')
    expect(rows[0].completed.map((row) => row.name)).toEqual(Array.from({ length: 80 }, (_, i) => `${i}_migration.sql`))
  })
})
