import { getSession } from '@line-crm/db'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import type { NextRequest } from 'next/server'
import { NextResponse } from 'next/server'
import { SESSION_COOKIE_NAME } from '@/lib/auth'

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|login|api/).*)'],
}

export async function middleware(request: NextRequest) {
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value
  if (!sessionId) {
    return NextResponse.redirect(new URL('/login', request.url))
  }

  const { env } = getCloudflareContext()
  const session = await getSession(env.DB, sessionId)
  if (session) {
    return NextResponse.next()
  }

  return NextResponse.redirect(new URL('/login', request.url))
}
