import { deleteSession } from '@line-crm/db'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextRequest, NextResponse } from 'next/server'
import { API_KEY_COOKIE_NAME, SESSION_COOKIE_NAME } from '@/lib/auth'

export async function POST(request: NextRequest) {
  const sessionId = request.cookies.get(SESSION_COOKIE_NAME)?.value

  if (sessionId) {
    const { env } = getCloudflareContext()
    await deleteSession(env.DB, sessionId)
  }

  const response = NextResponse.json({ success: true })
  response.cookies.delete(SESSION_COOKIE_NAME)
  response.cookies.delete(API_KEY_COOKIE_NAME)
  return response
}
