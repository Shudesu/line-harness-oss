import type { UpdateEvent } from '@line-harness/update-engine'

/**
 * Folds the raw update event log into display rows: one row per step
 * instead of one per state change, completed migrations collapsed into a
 * single count, and the informational `requires_secrets` event attached to
 * the Pre-flight row. Rows keep the order in which they first appeared.
 */

export const REQUIRES_SECRETS_PREFIX = 'requires_secrets:'
const ALREADY_APPLIED_SUFFIX = ' (already applied)'
const SUMMARY_KEY = 'migration-summary'

export type ProgressRow =
  | {
      kind: 'step'
      key: string
      step: UpdateEvent['step']
      status: UpdateEvent['status']
      name?: string
      error?: string
      secrets?: string[]
    }
  | { kind: 'migration-summary'; key: string; total: number; skipped: number }

type StepRow = Extract<ProgressRow, { kind: 'step' }>

interface MigrationEntry {
  kind: 'migration'
  key: string
  name: string
  status: UpdateEvent['status']
  error?: string
  alreadyApplied: boolean
}

type Entry = StepRow | MigrationEntry

const rowKey = (step: UpdateEvent['step'], name: string) =>
  JSON.stringify([step, name])

export function buildProgressRows(
  events: readonly UpdateEvent[],
): ProgressRow[] {
  const order: Entry[] = []
  const byKey = new Map<string, Entry>()

  const ensure = <T extends Entry>(key: string, create: () => T): T => {
    const found = byKey.get(key)
    if (found) return found as T
    const created = create()
    byKey.set(key, created)
    order.push(created)
    return created
  }

  for (const e of events) {
    if (e.step === 'preflight' && e.name?.startsWith(REQUIRES_SECRETS_PREFIX)) {
      const key = rowKey('preflight', '')
      const entry = ensure<StepRow>(key, () => ({
        kind: 'step',
        key,
        step: 'preflight',
        status: e.status,
      }))
      const incoming = e.name
        .slice(REQUIRES_SECRETS_PREFIX.length)
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      entry.secrets = [...new Set([...(entry.secrets ?? []), ...incoming])]
      continue
    }

    if (e.step === 'migration') {
      // Coupled to apply.ts: `running` reports the bare name and `done`
      // appends this marker for skips, so both have to key on the base name.
      const raw = e.name ?? ''
      const alreadyApplied = raw.endsWith(ALREADY_APPLIED_SUFFIX)
      const name = alreadyApplied
        ? raw.slice(0, -ALREADY_APPLIED_SUFFIX.length)
        : raw
      const key = rowKey('migration', name)
      const entry = ensure<MigrationEntry>(key, () => ({
        kind: 'migration',
        key,
        name,
        status: e.status,
        alreadyApplied: false,
      }))
      entry.status = e.status
      if (alreadyApplied) entry.alreadyApplied = true
      if (e.error) entry.error = e.error
      continue
    }

    const key = rowKey(e.step, e.name ?? '')
    const entry = ensure<StepRow>(key, () => ({
      kind: 'step',
      key,
      step: e.step,
      status: e.status,
      name: e.name,
    }))
    entry.status = e.status
    if (e.name) entry.name = e.name
    // Last non-empty error wins rather than the newest event: rollback
    // reports its cause on `running` and carries none on `done`.
    if (e.error) entry.error = e.error
  }

  const rows: ProgressRow[] = []
  let summary: Extract<ProgressRow, { kind: 'migration-summary' }> | null = null

  for (const entry of order) {
    if (entry.kind === 'step') {
      rows.push(entry)
      continue
    }
    if (entry.status !== 'done') {
      rows.push({
        kind: 'step',
        key: entry.key,
        step: 'migration',
        status: entry.status,
        name: entry.name,
        error: entry.error,
      })
      continue
    }
    if (!summary) {
      summary = { kind: SUMMARY_KEY, key: SUMMARY_KEY, total: 0, skipped: 0 }
      rows.push(summary)
    }
    summary.total += 1
    if (entry.alreadyApplied) summary.skipped += 1
  }

  return rows
}
