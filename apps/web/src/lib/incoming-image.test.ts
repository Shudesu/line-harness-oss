import { afterEach, describe, expect, it, vi } from 'vitest'
import { incomingImageUrl, fetchIncomingImage } from './incoming-image'

afterEach(() => vi.unstubAllGlobals())
describe('private incoming image client', () => {
  const base = 'https://worker.example.test'
  it('maps historical and new image references to authenticated reads', () => {
    for (const path of ['/images/incoming-old-123.jpg', '/api/incoming-images/incoming-old-123.jpg']) {
      expect(incomingImageUrl(base + path, base)).toBe(base + '/api/incoming-images/incoming-old-123.jpg')
    }
    expect(incomingImageUrl(base + '/images/public.png', base)).toBeNull()
    expect(incomingImageUrl('https://cdn.example.test/public.png', base)).toBeNull()
  })
  it('never sends credentials to a URL from an untrusted origin', () => {
    expect(() => incomingImageUrl('https://other.example.test/images/incoming-123.png', base)).toThrow('origin')
    expect(() => incomingImageUrl('https://worker.example.test@other.example.test/images/incoming-123.png', base)).toThrow('origin')
  })
  it('uses cookie authentication without cache, redirects or URL tokens', async () => {
    const fetcher = vi.fn(async () => new Response('image', { headers: { 'Content-Type': 'image/png' } }))
    vi.stubGlobal('fetch', fetcher)
    const signal = new AbortController().signal
    const url = incomingImageUrl(base + '/images/incoming-123.png', base)!
    const blob = await fetchIncomingImage(url, signal)
    expect(await blob.text()).toBe('image')
    expect(fetcher).toHaveBeenCalledWith(url, { credentials: 'include', cache: 'no-store', redirect: 'error', signal })
    expect(new URL(url).search).toBe('')
  })
  it('does not turn an expired session response into a displayed image', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('Unauthorized', { status: 401 })))
    await expect(fetchIncomingImage(base + '/api/incoming-images/incoming-123.png', new AbortController().signal)).rejects.toThrow('401')
  })
})
