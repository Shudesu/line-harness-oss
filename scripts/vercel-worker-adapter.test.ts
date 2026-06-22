import { describe, expect, it } from 'vitest'

const { currentOrigin, workerUrlFromRequest } = require('../api/[...path].js') as {
  currentOrigin(req: { headers: Record<string, string>; url?: string }): string
  workerUrlFromRequest(req: { headers: Record<string, string>; url?: string }): URL
}

function req(url: string, headers: Record<string, string> = {}) {
  return {
    url,
    headers: {
      host: 'line-harness-prod.vercel.app',
      ...headers,
    },
  }
}

describe('Vercel worker adapter routing', () => {
  it('derives the public Vercel origin from forwarded headers', () => {
    expect(
      currentOrigin(
        req('/api/auth/session', {
          'x-forwarded-proto': 'https',
          'x-forwarded-host': 'example.test',
        }),
      ),
    ).toBe('https://example.test')
  })

  it('keeps normal API paths under /api for the Worker routers', () => {
    expect(workerUrlFromRequest(req('/api/auth/login')).pathname).toBe('/api/auth/login')
    expect(workerUrlFromRequest(req('/api/line-accounts?x=1')).pathname).toBe('/api/line-accounts')
  })

  it('maps query-carried Vercel rewrites back to Worker routes', () => {
    const url = workerUrlFromRequest(req('/api/worker-api?__lh_path=admin/update/history&path=admin/update/history&limit=10'))
    expect(url.pathname).toBe('/admin/update/history')
    expect(url.searchParams.get('limit')).toBe('10')
    expect(url.searchParams.has('__lh_path')).toBe(false)
    expect(url.searchParams.has('path')).toBe(false)
  })

  it('maps public Worker rewrites back to their original non-api paths', () => {
    expect(workerUrlFromRequest(req('/api/worker-api?__lh_path=images/foo.png')).pathname).toBe('/images/foo.png')
    expect(workerUrlFromRequest(req('/api/worker-api?__lh_path=r/abc&form=f1')).pathname).toBe('/r/abc')
    expect(workerUrlFromRequest(req('/api/worker-api?__lh_path=webhook')).pathname).toBe('/webhook')
  })

  it('still supports the previous path-based adapter mapping', () => {
    expect(workerUrlFromRequest(req('/api/admin/update/history?limit=10')).pathname).toBe('/admin/update/history')
    expect(workerUrlFromRequest(req('/api/worker/images/foo.png')).pathname).toBe('/images/foo.png')
  })
})
