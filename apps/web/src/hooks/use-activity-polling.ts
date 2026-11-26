'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { browserPollingEnvironment, createActivityPoller, POLLING_RESUME_EVENT, type PollingState } from '../lib/activity-polling'

export function useActivityPolling<T>(options: {
  intervalMs: number
  load: (signal: AbortSignal) => Promise<T>
  onData: (value: T) => void
  onError: (error: unknown) => void
  refreshEvent?: string
  /** Debounce refresh-event bursts (e.g. heavy aggregates fired per keystroke/send). */
  eventDebounceMs?: number
  /** Change only when the request's resource/account changes, not on render. */
  requestKey?: string
}) {
  const callbacks = useRef(options)
  callbacks.current = options
  const [state, setState] = useState<PollingState>({ reason: 'active', fetching: true })
  useEffect(() => {
    const requestKey = options.requestKey
    const currentScope = () => callbacks.current.requestKey === requestKey
    const poller = createActivityPoller({
      environment: browserPollingEnvironment(document, window),
      intervalMs: options.intervalMs,
      load: (signal) => currentScope()
        ? callbacks.current.load(signal)
        : Promise.reject(new DOMException('Request scope changed', 'AbortError')),
      onData: (value) => { if (currentScope()) callbacks.current.onData(value) },
      onError: (error) => { if (currentScope()) callbacks.current.onError(error) },
      onState: (state) => { if (currentScope()) setState(state) },
    })
    let timer: number | null = null
    const onRefresh = () => {
      const debounceMs = callbacks.current.eventDebounceMs ?? 0
      if (!debounceMs) { poller.refresh(); return }
      // 連発した refresh イベントは最後の1回だけ発火させる
      if (timer !== null) window.clearTimeout(timer)
      timer = window.setTimeout(() => { timer = null; poller.refresh() }, debounceMs)
    }
    if (options.refreshEvent) window.addEventListener(options.refreshEvent, onRefresh)
    return () => {
      poller.dispose()
      if (timer !== null) window.clearTimeout(timer)
      if (options.refreshEvent) window.removeEventListener(options.refreshEvent, onRefresh)
    }
  }, [options.intervalMs, options.refreshEvent, options.requestKey])
  // A single explicit resume applies to both the inbox and the sidebar badge.
  const resume = useCallback(() => window.dispatchEvent(new Event(POLLING_RESUME_EVENT)), [])
  return { ...state, resume }
}
