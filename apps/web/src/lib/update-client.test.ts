import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadUpdateClient() {
  vi.resetModules()
  return import('./update-client')
}

afterEach(() => {
  vi.unstubAllGlobals()
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
  vi.resetModules()
})

describe('update-client manifest URL', () => {
  it('always uses the Worker manifest proxy even when a public GitHub URL is configured', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://example-worker.workers.dev')
    vi.stubEnv(
      'NEXT_PUBLIC_MANIFEST_URL',
      'https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json',
    )

    const { getManifestUrl } = await loadUpdateClient()

    expect(getManifestUrl()).toBe('https://example-worker.workers.dev/admin/manifest')
  })

  it('fetches the manifest from the Worker proxy', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://example-worker.workers.dev')
    const manifest = { schema_version: 1, latest: '0.14.1', releases: [] }
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(new Response(JSON.stringify(manifest)))

    const { getManifest } = await loadUpdateClient()

    await expect(getManifest()).resolves.toEqual(manifest)
    expect(fetchMock).toHaveBeenCalledWith(
      'https://example-worker.workers.dev/admin/manifest',
      { cache: 'no-store' },
    )
  })
})


describe('update-client cookie authentication', () => {
  it('uses cookie and CSRF for updates without any public API key', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://worker.example.test')
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => new Response(JSON.stringify({updateId:'test-update'})))
    const { startUpdate, getUpdateStatus } = await loadUpdateClient()
    await startUpdate()
    await getUpdateStatus('test-update')
    expect(fetchMock.mock.calls[0][1]).toEqual({method:'POST',credentials:'include',headers:{'X-CSRF-Token':''}})
    expect(fetchMock.mock.calls[1][1]).toEqual({credentials:'include'})
  })
  it('sends the session cookie on EventSource', async () => {
    vi.stubEnv('NEXT_PUBLIC_API_URL', 'https://worker.example.test')
    const source = vi.fn().mockImplementation(() => ({addEventListener:vi.fn(),close:vi.fn()}))
    vi.stubGlobal('EventSource',source)
    const { openUpdateStream } = await loadUpdateClient()
    openUpdateStream('test-update',()=>{},()=>{})
    expect(source).toHaveBeenCalledWith('https://worker.example.test/admin/update/stream/test-update',{withCredentials:true})
  })
})
