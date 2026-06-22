const path = require('node:path')
const { pathToFileURL } = require('node:url')
const { Readable } = require('node:stream')
const { createPostgresD1, createPostgresR2Bucket } = require('./_lib/postgres-d1')

let workerModulePromise

function currentOrigin(req) {
  const proto = req.headers['x-forwarded-proto'] || 'https'
  const host = req.headers['x-forwarded-host'] || req.headers.host
  return `${Array.isArray(proto) ? proto[0] : proto}://${Array.isArray(host) ? host[0] : host}`
}

function workerUrlFromRequest(req) {
  const url = new URL(req.url || '/', currentOrigin(req))
  const rewrittenPath = url.searchParams.get('__lh_path')
  if (rewrittenPath) {
    url.pathname = `/${rewrittenPath.replace(/^\/+/, '')}`
    url.searchParams.delete('__lh_path')
    // Vercel adds the dynamic route parameter as an extra `path` query value
    // for `:path*` rewrites. It is routing metadata, not part of the Worker
    // API contract, so strip it before handing the request to the Worker.
    url.searchParams.delete('path')
    return url
  }

  if (url.pathname === '/api/admin') {
    url.pathname = '/admin'
  } else if (url.pathname.startsWith('/api/admin/')) {
    url.pathname = url.pathname.replace(/^\/api\/admin/, '/admin')
  } else if (url.pathname === '/api/worker') {
    url.pathname = '/'
  } else if (url.pathname.startsWith('/api/worker/')) {
    url.pathname = url.pathname.replace(/^\/api\/worker/, '')
  }

  return url
}

async function readBody(req) {
  if (req.method === 'GET' || req.method === 'HEAD') return undefined
  const chunks = []
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(chunks)
}

function requestHeaders(req) {
  const headers = new Headers()
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue
    if (Array.isArray(value)) {
      for (const item of value) headers.append(key, item)
    } else {
      headers.set(key, value)
    }
  }
  return headers
}

async function loadWorker() {
  if (!workerModulePromise) {
    const workerPath = path.join(process.cwd(), 'apps', 'worker', 'dist', 'line_harness', 'index.js')
    workerModulePromise = import(pathToFileURL(workerPath).href)
  }
  return workerModulePromise
}

function envForRequest(req) {
  const origin = currentOrigin(req)
  return {
    ...process.env,
    DB: createPostgresD1(),
    IMAGES: createPostgresR2Bucket(),
    ASSETS: {
      fetch: () => new Response('Not found', { status: 404 }),
    },
    // Vercel is the production runtime for this install. Prefer the request
    // origin over stale Worker/Pages values so cookie auth remains same-site.
    WORKER_URL: origin,
    WORKER_PUBLIC_URL: origin,
    ADMIN_ORIGIN: process.env.ADMIN_ORIGIN || origin,
    ADMIN_PUBLIC_URL: process.env.ADMIN_PUBLIC_URL || origin,
    LIFF_PUBLIC_URL: process.env.LIFF_PUBLIC_URL || origin,
    LIFF_URL: process.env.LIFF_URL || origin,
    API_KEY: process.env.API_KEY || process.env.ADMIN_API_KEY || '',
  }
}

function executionContext() {
  return {
    waitUntil(promise) {
      Promise.resolve(promise).catch((err) => console.error('[waitUntil]', err))
    },
    passThroughOnException() {},
  }
}

async function sendResponse(res, response) {
  res.statusCode = response.status
  res.statusMessage = response.statusText

  const setCookies =
    typeof response.headers.getSetCookie === 'function'
      ? response.headers.getSetCookie()
      : response.headers.get('set-cookie')
        ? [response.headers.get('set-cookie')]
        : []

  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return
    res.setHeader(key, value)
  })
  if (setCookies.length > 0) res.setHeader('Set-Cookie', setCookies)

  if (!response.body) {
    res.end()
    return
  }
  Readable.fromWeb(response.body).pipe(res)
}

module.exports = async function handler(req, res) {
  try {
    const worker = await loadWorker()
    const request = new Request(workerUrlFromRequest(req), {
      method: req.method,
      headers: requestHeaders(req),
      body: await readBody(req),
    })
    const response = await worker.default.fetch(request, envForRequest(req), executionContext())
    await sendResponse(res, response)
  } catch (err) {
    console.error('[vercel-worker-adapter]', err)
    res.statusCode = 500
    res.setHeader('Content-Type', 'application/json; charset=utf-8')
    res.end(JSON.stringify({ success: false, error: 'Internal server error' }))
  }
}

module.exports.currentOrigin = currentOrigin
module.exports.workerUrlFromRequest = workerUrlFromRequest
