import { afterEach, describe, expect, it, vi } from 'vitest'

async function loadUpdateClient() {
  vi.resetModules()
  return import('./update-client')
}

afterEach(() => {
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

it('uses owner cookies and CSRF, never a public build-time key, for updates',async()=>{
 vi.stubEnv('NEXT_PUBLIC_API_URL','https://worker.example.test')
 vi.stubGlobal('window',{location:{hostname:'admin.example.test',origin:'https://admin.example.test'}})
 vi.stubGlobal('localStorage',{getItem:()=> 'test-csrf'})
 const fetchMock=vi.spyOn(globalThis,'fetch').mockResolvedValue(Response.json({updateId:'one'}))
 const {startUpdate}=await loadUpdateClient();await startUpdate()
 expect(fetchMock).toHaveBeenCalledWith('https://worker.example.test/admin/update/start',expect.objectContaining({credentials:'include',headers:{'X-CSRF-Token':'test-csrf'}}))
 vi.unstubAllGlobals()
})
