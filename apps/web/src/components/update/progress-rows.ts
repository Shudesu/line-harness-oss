import type { UpdateEvent } from '@line-harness/update-engine'

export type MigrationOutcome = 'applied' | 'skipped' | 'adopted'

export interface ProgressStepRow {
  kind: 'step'
  key: string
  step: UpdateEvent['step']
  status: UpdateEvent['status']
  name?: string
  notes: string[]
  errors: string[]
  secrets: string[]
  outcome?: MigrationOutcome
  outcomeHistory: MigrationOutcome[]
}

export interface MigrationSummaryRow {
  kind: 'migration-summary'
  key: 'migration-summary'
  total: number
  applied: number
  skipped: number
  adopted: number
  completed: ProgressStepRow[]
}

export type ProgressRow = ProgressStepRow | MigrationSummaryRow

const REQUIRES_SECRETS_PREFIX = 'requires_secrets:'
const MIGRATION_SUFFIXES: Array<[string, MigrationOutcome]> = [
  [' (already applied)', 'skipped'],
  [' (adopted, not executed)', 'adopted'],
]

function migrationName(raw: string): { name: string; outcome: MigrationOutcome } {
  for (const [suffix, outcome] of MIGRATION_SUFFIXES) {
    if (raw.endsWith(suffix)) return { name: raw.slice(0, -suffix.length), outcome }
  }
  return { name: raw, outcome: 'applied' }
}

function appendUnique<T>(list: T[], value: T | undefined): void {
  if (value !== undefined && value !== '' && !list.includes(value)) list.push(value)
}

/**
 * Adapted from community PR #282. Keep one row per phase or migration name,
 * with completed migrations in a summary whose details retain their evidence.
 * Input events remain untouched; repeated SSE/polling entries do not add counts.
 */
export function buildProgressRows(events: readonly UpdateEvent[]): ProgressRow[] {
  const entries = new Map<string, ProgressStepRow>()

  events.forEach((event, index) => {
    const migration = event.step === 'migration' ? migrationName(event.name ?? '') : null
    const key = migration
      ? JSON.stringify(migration.name ? ['migration', migration.name] : ['unnamed-migration', index])
      : event.step
    let row = entries.get(key)
    if (!row) {
      row = {
        kind: 'step', key, step: event.step, status: event.status,
        ...(migration ? { name: migration.name } : {}),
        notes: [], errors: [], secrets: [], outcomeHistory: [],
      }
      entries.set(key, row)
    }
    appendUnique(row.errors, event.error)

    if (event.step === 'preflight' && event.name?.startsWith(REQUIRES_SECRETS_PREFIX)) {
      for (const secret of event.name.slice(REQUIRES_SECRETS_PREFIX.length).split(',')) {
        appendUnique(row.secrets, secret.trim())
      }
      // Informational running events must not regress an already completed
      // preflight. A real failure still needs to remain visible.
      if (event.status === 'failed') row.status = 'failed'
      return
    }

    row.status = event.status
    if (migration) {
      if (event.status === 'done') {
        row.outcome = migration.outcome
        appendUnique(row.outcomeHistory, migration.outcome)
      }
    } else {
      appendUnique(row.notes, event.name)
    }
  })

  const rows: ProgressRow[] = []
  let summary: MigrationSummaryRow | undefined
  for (const row of entries.values()) {
    if (row.step !== 'migration' || row.status !== 'done') {
      rows.push(row)
      continue
    }
    if (!summary) {
      summary = { kind: 'migration-summary', key: 'migration-summary', total: 0, applied: 0, skipped: 0, adopted: 0, completed: [] }
      rows.push(summary)
    }
    summary.total++
    summary[row.outcome ?? 'applied']++
    summary.completed.push(row)
  }
  return rows
}
