import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadBasePath() {
  vi.resetModules()
  return import('./base-path')
}

afterEach(() => {
  vi.unstubAllEnvs()
  vi.resetModules()
})

describe('withBasePath', () => {
  it('returns the path unchanged when NEXT_PUBLIC_BASE_PATH is unset (self-hosted / dev, root)', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '')
    const { withBasePath } = await loadBasePath()
    expect(withBasePath('/login')).toBe('/login')
  })

  it('prefixes the path with the configured basePath (three-surfaces bundle)', async () => {
    vi.stubEnv('NEXT_PUBLIC_BASE_PATH', '/console')
    const { withBasePath } = await loadBasePath()
    expect(withBasePath('/login')).toBe('/console/login')
    expect(withBasePath('/health')).toBe('/console/health')
  })
})
