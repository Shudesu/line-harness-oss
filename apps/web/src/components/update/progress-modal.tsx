'use client'

import { useEffect, useState } from 'react'
import { openUpdateStream, getUpdateStatus } from '@/lib/update-client'
import type { UpdateEvent } from '@line-harness/update-engine'

/**
 * ProgressModal — live timeline for an in-flight update.
 *
 * Subscribes to `GET /admin/update/stream/:id` (SSE) via the update-client
 * helper and renders each `progress` event as a row. When a `complete` frame
 * lands the modal pivots to a terminal panel (success / rolled_back / failed)
 * with a 閉じる button that calls `onClose`.
 *
 * Fallback to polling
 * -------------------
 * SSE now uses the same HttpOnly admin session cookie as the rest of the
 * dashboard (`withCredentials: true`). We still wire `es.onerror` to fall back
 * to a 1500ms polling loop against `getUpdateStatus` so transient network or
 * browser EventSource issues do not leave the modal stuck. The visual
 * difference is a small `(polling)` badge in the header so operators know
 * which transport is live.
 *
 * Cleanup
 * -------
 * The effect's cleanup closes the EventSource and clears any pending poll
 * timer. We also flip a local `cancelled` flag so a poll already in flight
 * cannot reschedule itself after unmount (avoids the "set state after
 * unmount" warning + a timer leak on fast modal close).
 */
interface FinalState {
  status: 'success' | 'rolled_back' | 'failed'
  error: string | null
}

export function ProgressModal({
  updateId,
  onClose,
}: {
  updateId: string
  onClose: () => void
}) {
  const [events, setEvents] = useState<UpdateEvent[]>([])
  const [final, setFinal] = useState<FinalState | null>(null)
  const [mode, setMode] = useState<'sse' | 'polling'>('sse')

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

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold mb-3">
          アップデート中{' '}
          {mode === 'polling' && (
            <span className="text-xs text-gray-500">(polling)</span>
          )}
        </h2>
        <ul className="space-y-1 font-mono text-sm">
          {events.length === 0 && (
            <li className="text-gray-500">接続中...</li>
          )}
          {events.map((e, i) => (
            <li key={i} className="flex items-center gap-2">
              <span className="w-5 inline-block">{iconFor(e.status)}</span>
              <span>
                {labelFor(e.step)}
                {e.name ? ` — ${e.name}` : ''}
                {e.error ? ` (${e.error})` : ''}
              </span>
            </li>
          ))}
        </ul>
        {final && (
          <div className="mt-4 p-3 rounded bg-gray-50">
            {final.status === 'success' && (
              <p className="text-green-700 font-semibold">完了しました 🎉</p>
            )}
            {final.status === 'rolled_back' && (
              <p className="text-amber-700">
                失敗。前バージョンに復旧済み。
                {final.error && (
                  <span className="block text-xs mt-1 text-gray-600">
                    {final.error}
                  </span>
                )}
              </p>
            )}
            {final.status === 'failed' && (
              <p className="text-red-700">
                失敗 + 復旧失敗。手動対応が必要です。
                {final.error && (
                  <span className="block text-xs mt-1 text-gray-600">
                    {final.error}
                  </span>
                )}
              </p>
            )}
            <button
              type="button"
              onClick={onClose}
              className="mt-3 text-sm px-3 py-1 rounded bg-gray-200 hover:bg-gray-300"
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function iconFor(s: UpdateEvent['status']): string {
  if (s === 'done') return '✓'
  if (s === 'running') return '⏳'
  if (s === 'failed') return '✗'
  return '○'
}

function labelFor(step: UpdateEvent['step']): string {
  const map: Record<UpdateEvent['step'], string> = {
    preflight: 'Pre-flight',
    migration: 'Migration',
    worker: 'Worker デプロイ',
    admin: 'Admin デプロイ',
    liff: 'LIFF デプロイ',
    verify: 'ヘルスチェック',
    rollback: 'Rollback',
    complete: '完了',
  }
  return map[step] ?? step
}
