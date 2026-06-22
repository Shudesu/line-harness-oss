import { describe, expect, test, vi, beforeEach } from 'vitest'
import { EventEmitter } from 'node:events'

const auth = require('./vercel-admin-auth.js')
const login = require('../auth/login.js')
const session = require('../auth/session.js')
const history = require('../admin/update/history.js')

class MockReq extends EventEmitter {
  method: string
  headers: Record<string, string>
  body?: unknown

  constructor(method: string, body?: unknown, headers: Record<string, string> = {}) {
    super()
    this.method = method
    this.body = body
    this.headers = headers
  }
}

class MockRes {
  statusCode = 200
  headers: Record<string, unknown> = {}
  body = ''

  setHeader(name: string, value: unknown) {
    this.headers[name.toLowerCase()] = value
  }

  end(value: string) {
    this.body = value
  }
}

describe('Vercel admin auth functions', () => {
  beforeEach(() => {
    vi.stubEnv('ADMIN_EMAIL', 'owner@example.test')
    vi.stubEnv('ADMIN_PASSWORD', 'strong-password')
    vi.stubEnv('ADMIN_SESSION_SECRET', 'test-session-secret')
  })

  test('logs in with email/password and returns compatible session cookies', async () => {
    const req = new MockReq('POST', { email: 'owner@example.test', password: 'strong-password' })
    const res = new MockRes()

    await login(req, res)

    expect(res.statusCode).toBe(200)
    const parsed = JSON.parse(res.body)
    expect(parsed.success).toBe(true)
    expect(parsed.data.role).toBe('owner')
    const cookies = res.headers['set-cookie'] as string[]
    expect(cookies.some((cookie) => cookie.startsWith(`${auth.ADMIN_AUTH_COOKIE}=`))).toBe(true)
    expect(cookies.some((cookie) => cookie.startsWith(`${auth.CSRF_COOKIE}=`))).toBe(true)
  })

  test('session and update history require the session cookie', async () => {
    const loginReq = new MockReq('POST', { email: 'owner@example.test', password: 'strong-password' })
    const loginRes = new MockRes()
    await login(loginReq, loginRes)
    const cookieHeader = (loginRes.headers['set-cookie'] as string[])
      .map((cookie) => cookie.split(';')[0])
      .join('; ')

    const sessionRes = new MockRes()
    await session(new MockReq('GET', undefined, { cookie: cookieHeader }), sessionRes)
    expect(sessionRes.statusCode).toBe(200)
    expect(JSON.parse(sessionRes.body).data.role).toBe('owner')

    const historyRes = new MockRes()
    await history(new MockReq('GET', undefined, { cookie: cookieHeader }), historyRes)
    expect(historyRes.statusCode).toBe(200)
    expect(JSON.parse(historyRes.body).history).toEqual([])

    const denied = new MockRes()
    await history(new MockReq('GET'), denied)
    expect(denied.statusCode).toBe(401)
  })

  test('rejects wrong password', async () => {
    const req = new MockReq('POST', { email: 'owner@example.test', password: 'wrong' })
    const res = new MockRes()

    await login(req, res)

    expect(res.statusCode).toBe(401)
    expect(JSON.parse(res.body).success).toBe(false)
  })
})
