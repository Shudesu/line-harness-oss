const crypto = require('crypto')

const ADMIN_AUTH_COOKIE = 'lh_admin_session'
const CSRF_COOKIE = 'lh_csrf'
const SESSION_MAX_AGE = 604800
const SESSION_TOKEN_PREFIX = 'lh_session_v1.'

function json(res, status, body) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

function methodNotAllowed(res, allowed) {
  res.setHeader('Allow', allowed.join(', '))
  return json(res, 405, { success: false, error: 'Method Not Allowed' })
}

function parseCookies(header) {
  if (!header) return {}
  const cookies = {}
  for (const part of String(header).split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=')
    if (!rawName) continue
    const value = rawValue.join('=')
    try {
      cookies[rawName] = decodeURIComponent(value)
    } catch {
      cookies[rawName] = value
    }
  }
  return cookies
}

function buildCookie(name, value, { httpOnly, maxAge = SESSION_MAX_AGE } = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', `Max-Age=${maxAge}`, 'SameSite=Lax', 'Secure']
  if (httpOnly) parts.push('HttpOnly')
  return parts.join('; ')
}

function clearCookie(name, httpOnly) {
  return buildCookie(name, '', { httpOnly, maxAge: 0 })
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function fromBase64Url(value) {
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return Buffer.from(padded, 'base64').toString('utf8')
}

function hmac(secret, payload) {
  return crypto.createHmac('sha256', secret).update(payload).digest('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '')
}

function safeEqual(a, b) {
  const left = Buffer.from(String(a))
  const right = Buffer.from(String(b))
  if (left.length !== right.length) {
    return false
  }
  return crypto.timingSafeEqual(left, right)
}

function adminStaff() {
  return {
    id: 'bootstrap-owner',
    name: process.env.ADMIN_EMAIL || 'Admin',
    role: 'owner',
  }
}

function requireAdminConfig() {
  const missing = []
  if (!process.env.ADMIN_EMAIL) missing.push('ADMIN_EMAIL')
  if (!process.env.ADMIN_PASSWORD) missing.push('ADMIN_PASSWORD')
  if (!process.env.ADMIN_SESSION_SECRET) missing.push('ADMIN_SESSION_SECRET')
  return missing
}

function createSessionToken(staff) {
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) throw new Error('ADMIN_SESSION_SECRET is not configured')
  const payload = base64Url(JSON.stringify({
    ...staff,
    v: 1,
    exp: Math.floor(Date.now() / 1000) + SESSION_MAX_AGE,
  }))
  return `${SESSION_TOKEN_PREFIX}${payload}.${hmac(secret, payload)}`
}

function verifySessionToken(token) {
  if (!token || !token.startsWith(SESSION_TOKEN_PREFIX)) return null
  const secret = process.env.ADMIN_SESSION_SECRET
  if (!secret) return null
  const rest = token.slice(SESSION_TOKEN_PREFIX.length)
  const dot = rest.lastIndexOf('.')
  if (dot <= 0) return null
  const encodedPayload = rest.slice(0, dot)
  const signature = rest.slice(dot + 1)
  const expected = hmac(secret, encodedPayload)
  if (!safeEqual(signature, expected)) return null
  try {
    const payload = JSON.parse(fromBase64Url(encodedPayload))
    if (payload.v !== 1 || payload.exp <= Math.floor(Date.now() / 1000)) return null
    if (!['owner', 'admin', 'staff'].includes(payload.role)) return null
    return { id: payload.id, name: payload.name, role: payload.role }
  } catch {
    return null
  }
}

function parseBody(req) {
  if (req.body && typeof req.body === 'object') return Promise.resolve(req.body)
  if (typeof req.body === 'string') {
    try {
      return Promise.resolve(JSON.parse(req.body))
    } catch {
      return Promise.resolve({})
    }
  }
  return new Promise((resolve) => {
    let raw = ''
    req.on('data', (chunk) => {
      raw += chunk
    })
    req.on('end', () => {
      try {
        resolve(JSON.parse(raw || '{}'))
      } catch {
        resolve({})
      }
    })
    req.on('error', () => resolve({}))
  })
}

function currentSession(req) {
  const cookies = parseCookies(req.headers.cookie)
  return verifySessionToken(cookies[ADMIN_AUTH_COOKIE])
}

function setSessionCookies(res, staff) {
  const csrfToken = crypto.randomUUID()
  const sessionToken = createSessionToken(staff)
  res.setHeader('Set-Cookie', [
    buildCookie(ADMIN_AUTH_COOKIE, sessionToken, { httpOnly: true }),
    buildCookie(CSRF_COOKIE, csrfToken, { httpOnly: false }),
  ])
  return csrfToken
}

function clearSessionCookies(res) {
  res.setHeader('Set-Cookie', [
    clearCookie(ADMIN_AUTH_COOKIE, true),
    clearCookie(CSRF_COOKIE, false),
  ])
}

module.exports = {
  ADMIN_AUTH_COOKIE,
  CSRF_COOKIE,
  adminStaff,
  currentSession,
  json,
  methodNotAllowed,
  parseBody,
  parseCookies,
  requireAdminConfig,
  safeEqual,
  setSessionCookies,
  clearSessionCookies,
}
