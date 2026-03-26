'use client'

import { useState, useEffect, useCallback, useRef } from 'react'

interface EventSourceMessage {
  id: string
  type: string
  data: string
  createdAt: string
}

interface UseEventSourceOptions {
  url: string
  maxRetries?: number
}

const MAX_RETRIES_DEFAULT = 5
const MAX_BACKOFF_MS = 30_000

export function useEventSource({
  url,
  maxRetries = MAX_RETRIES_DEFAULT,
}: UseEventSourceOptions) {
  const [messages, setMessages] = useState<EventSourceMessage[]>([])
  const [connected, setConnected] = useState(false)
  const retriesRef = useRef(0)
  const eventSourceRef = useRef<EventSource | null>(null)

  const connect = useCallback(() => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close()
    }

    const es = new EventSource(url)
    eventSourceRef.current = es

    es.addEventListener('connected', () => {
      setConnected(true)
      retriesRef.current = 0
    })

    es.addEventListener('message', (event) => {
      try {
        const parsed = JSON.parse(event.data) as EventSourceMessage
        setMessages((prev) => [parsed, ...prev].slice(0, 50))
      } catch {
        // Skip malformed messages
      }
    })

    es.addEventListener('reconnect', () => {
      es.close()
      setConnected(false)
      setTimeout(connect, 100)
    })

    es.onerror = () => {
      es.close()
      setConnected(false)

      if (retriesRef.current < maxRetries) {
        const delay = Math.min(
          1000 * Math.pow(2, retriesRef.current),
          MAX_BACKOFF_MS,
        )
        retriesRef.current++
        setTimeout(connect, delay)
      }
    }
  }, [url, maxRetries])

  useEffect(() => {
    connect()
    return () => {
      eventSourceRef.current?.close()
    }
  }, [connect])

  return { messages, connected }
}
