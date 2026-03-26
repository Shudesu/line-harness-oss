import { getSession } from '@line-crm/db'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextRequest, NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth'

export async function GET(request: NextRequest) {
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return NextResponse.json({ authenticated: false })
  }

  const { env } = getCloudflareContext()
  const session = await getSession(env.DB, sessionId)
  if (session) {
    return NextResponse.json({ authenticated: true })
  }

  return NextResponse.json({ authenticated: false })
}
