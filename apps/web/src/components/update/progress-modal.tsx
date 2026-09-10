'use client'

import { useEffect, useId, useMemo, useState } from 'react'
import { openUpdateStream, getUpdateStatus } from '@/lib/update-client'
import type { UpdateEvent } from '@line-harness/update-engine'
import { buildProgressRows } from './progress-rows'
import { ProgressModalView, type UpdateFinalState } from './progress-modal-view'

/**
 * ProgressModal — live timeline for an in-flight update.
 *
 * Subscribes to `GET /admin/update/stream/:id` (SSE) via the update-client
 * helper and groups `progress` events into phase rows and migration details. When a `complete` frame
 * lands the modal pivots to a terminal panel (success / rolled_back / failed)
 * with a 閉じる button that calls `onClose`.
 *
 * Fallback to polling
 * -------------------
 * EventSource cannot send custom headers, but the Worker SSE route currently
 * gates on `x-admin-api-key` (see Phase 6 KNOWN LIMITATION in update-client).
 * To keep the modal usable until Phase 9 fixes the auth, we wire `es.onerror`
 * to fall back to a 1500ms polling loop against `getUpdateStatus` which DOES
 * send the admin key. The visual difference is a small `(polling)` badge in
 * the header so operators know which transport is live.
 *
 * Cleanup
 * -------
 * The effect's cleanup closes the EventSource and clears any pending poll
 * timer. We also flip a local `cancelled` flag so a poll already in flight
 * cannot reschedule itself after unmount (avoids the "set state after
 * unmount" warning + a timer leak on fast modal close).
 */
type FinalState = UpdateFinalState

export function ProgressModal({
  updateId,
  onClose,
}: {
  updateId: string
  onClose: () => void
}) {
  const titleId = useId()
  const [events, setEvents] = useState<UpdateEvent[]>([])
  const [final, setFinal] = useState<FinalState | null>(null)
  const [mode, setMode] = useState<'sse' | 'polling'>('sse')
  const rows = useMemo(() => buildProgressRows(events), [events])

  useEffect(() => {
    let es: EventSource | null = null
    let pollTimer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let completed = false

    function startPolling() {
      setMode('polling')
      const poll = async () => {
        if (cancelled) return
        try {
          const status = await getUpdateStatus(updateId)
          if (cancelled) return
          setEvents(status.events as UpdateEvent[])
          if (status.status !== 'running') {
            setFinal({
              status: status.status as FinalState['status'],
              error: status.error,
            })
            return
          }
          pollTimer = setTimeout(poll, 1500)
        } catch {
          // Transient failure (network blip, 5xx). Back off slightly and
          // retry — don't surface the error until the modal explicitly
          // gives up. The snapshot row is durable on the server.
          if (cancelled) return
          pollTimer = setTimeout(poll, 3000)
        }
      }
      void poll()
    }

    try {
      es = openUpdateStream(
        updateId,
        (e) => {
          if (cancelled) return
          setEvents((cur) => [...cur, e as UpdateEvent])
        },
        (f) => {
          if (cancelled) return
          completed = true
          setFinal(f as FinalState)
        },
      )
      es.onerror = (err) => {
        // EventSource fires onerror both for "couldn't connect" (real failure
        // → polling fallback) and for "stream closed normally after complete"
        // (the orchestrator finished, we should NOT degrade to polling).
        // The `completed` flag distinguishes them.
        if (cancelled || completed) return
        console.warn('[update] SSE failed, falling back to polling', err)
        es?.close()
        es = null
        startPolling()
      }
    } catch (e) {
      console.warn('[update] EventSource not available, polling', e)
      startPolling()
    }

    return () => {
      cancelled = true
      es?.close()
      if (pollTimer) clearTimeout(pollTimer)
    }
  }, [updateId])

  return <ProgressModalView rows={rows} final={final} mode={mode} titleId={titleId} onClose={onClose} />
}
