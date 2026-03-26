import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextResponse } from 'next/server'
import { getCookieValue, SESSION_COOKIE_NAME } from '@/lib/auth'

interface EventRow {
  id: string
  type: string
  data: string
  created_at: string
}

async function validateSession(
  db: D1Database,
  sessionId: string,
): Promise<boolean> {
  const result = await db
    .prepare(
      "SELECT id FROM sessions WHERE id = ? AND expires_at > datetime('now')",
    )
    .bind(sessionId)
    .first()
  return result !== null
}

// OpenNext runs all routes on Cloudflare Workers (edge by default)
const MAX_LIFETIME_MS = 55_000 // 55s, below CF 60s limit
const POLL_INTERVAL_MS = 5_000

export async function GET(request: Request) {
  const cookieHeader = request.headers.get('cookie')
  const sessionId = getCookieValue(cookieHeader, SESSION_COOKIE_NAME)

  if (!sessionId) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { env } = getCloudflareContext()
  const isAuthenticated = await validateSession(env.DB, sessionId)

  if (!isAuthenticated) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const encoder = new TextEncoder()
  let closed = false

  const stream = new ReadableStream({
    async start(controller) {
      controller.enqueue(encoder.encode('event: connected\ndata: {}\n\n'))

      const startTime = Date.now()

      const poll = async () => {
        if (closed || Date.now() - startTime > MAX_LIFETIME_MS) {
          controller.enqueue(encoder.encode('event: reconnect\ndata: {}\n\n'))
          controller.close()
          return
        }

        try {
          const events = await env.DB.prepare(
            "SELECT id, sender_type as type, content as data, created_at FROM message_logs WHERE created_at > datetime('now', '-10 seconds') ORDER BY created_at DESC LIMIT 20",
          ).all<EventRow>()

          if (events.results.length > 0) {
            for (const event of events.results) {
              const payload = JSON.stringify({
                id: event.id,
                type: event.type,
                data: event.data,
                createdAt: event.created_at,
              })
              controller.enqueue(
                encoder.encode(`event: message\ndata: ${payload}\n\n`),
              )
            }
          }
        } catch {
          // Silently continue on poll error
        }

        setTimeout(poll, POLL_INTERVAL_MS)
      }

      poll()
    },
    cancel() {
      closed = true
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    },
  })
}
