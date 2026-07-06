import type { Context, MiddlewareHandler } from 'hono'
import type { Env } from '../env.js'

export interface LineUser {
  userId: string
  displayName: string
}

export type AppContext = {
  Bindings: Env
  Variables: {
    lineUser: LineUser
  }
}

/**
 * LIFF auth: the page sends the LIFF access token as `Authorization: Bearer <token>`.
 * We verify it server-side against LINE's verify endpoint (never trust a raw
 * userId from the client) and then fetch the profile to get the userId.
 */
export const liffAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = bearerToken(c)
  if (!token) return c.json({ success: false, error: 'missing token' }, 401)

  const verifyRes = await fetch(
    `https://api.line.me/oauth2/v2.1/verify?access_token=${encodeURIComponent(token)}`,
  )
  if (!verifyRes.ok) return c.json({ success: false, error: 'invalid token' }, 401)
  const verify = (await verifyRes.json()) as { client_id: string; expires_in: number }
  if (verify.expires_in <= 0) return c.json({ success: false, error: 'token expired' }, 401)
  const expectedChannel = c.env.LIFF_CHANNEL_ID
  if (expectedChannel && verify.client_id !== expectedChannel) {
    return c.json({ success: false, error: 'token issued for another channel' }, 401)
  }

  const profileRes = await fetch('https://api.line.me/v2/profile', {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!profileRes.ok) return c.json({ success: false, error: 'profile fetch failed' }, 401)
  const profile = (await profileRes.json()) as { userId: string; displayName: string }

  c.set('lineUser', { userId: profile.userId, displayName: profile.displayName })
  await next()
}

/** Staff endpoints: `X-Staff-Pin` header must match the STAFF_PIN secret. */
export const staffAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const pin = c.req.header('X-Staff-Pin')
  if (!c.env.STAFF_PIN || !pin || !timingSafeEqual(pin, c.env.STAFF_PIN)) {
    return c.json({ success: false, error: 'unauthorized' }, 401)
  }
  await next()
}

/** Admin/MCP endpoints: Bearer PLUGIN_API_KEY. */
export const adminAuth: MiddlewareHandler<AppContext> = async (c, next) => {
  const token = bearerToken(c)
  if (!c.env.PLUGIN_API_KEY || !token || !timingSafeEqual(token, c.env.PLUGIN_API_KEY)) {
    return c.json({ success: false, error: 'unauthorized' }, 401)
  }
  await next()
}

function bearerToken(c: Context<AppContext>): string | null {
  const header = c.req.header('Authorization')
  if (!header?.startsWith('Bearer ')) return null
  return header.slice('Bearer '.length).trim() || null
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  if (ab.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < ab.length; i++) diff |= (ab[i] as number) ^ (bb[i] as number)
  return diff === 0
}
