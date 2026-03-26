import { createSession } from '@line-crm/db'
import { getCloudflareContext } from '@opennextjs/cloudflare'
import { NextRequest, NextResponse } from 'next/server'
import {
  API_KEY_COOKIE_NAME,
  SESSION_COOKIE_NAME,
  hashApiKey,
} from '@/lib/auth'

export async function POST(request: NextRequest) {
  const body = (await request.json()) as { apiKey?: string }
  const apiKey = body.apiKey

  if (!apiKey) {
    return NextResponse.json({ error: 'API key required' }, { status: 400 })
  }

  // Validate API key against the worker
  const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'
  const res = await fetch(`${apiUrl}/api/friends/count`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })

  if (!res.ok) {
    return NextResponse.json({ error: 'Invalid API key' }, { status: 401 })
  }

  const apiKeyHash = await hashApiKey(apiKey)
  const { env } = getCloudflareContext()
  const sessionId = await createSession(env.DB, apiKeyHash)

  const isProduction = process.env.NODE_ENV === 'production'
  const response = NextResponse.json({ success: true })

  response.cookies.set({
    name: SESSION_COOKIE_NAME,
    value: sessionId,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 86_400,
    path: '/',
  })
  response.cookies.set({
    name: API_KEY_COOKIE_NAME,
    value: apiKey,
    httpOnly: true,
    secure: isProduction,
    sameSite: 'lax',
    maxAge: 86_400,
    path: '/',
  })

  return response
}
