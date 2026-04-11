import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HttpClient } from '../../src/http.js'
import { ImagesResource } from '../../src/resources/images.js'

describe('ImagesResource', () => {
  let http: HttpClient
  let images: ImagesResource

  beforeEach(() => {
    http = new HttpClient({ baseUrl: 'https://test.example.com', apiKey: 'test-key', timeout: 5000 })
    images = new ImagesResource(http)
  })

  it('uploads an image with base64 data', async () => {
    const mockResponse = {
      success: true,
      data: { id: 'abc-123', key: 'abc-123.png', url: 'https://test.example.com/images/abc-123.png', mimeType: 'image/png', size: 1024 },
    }
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockResponse),
    })
    vi.stubGlobal('fetch', mockFetch)

    const result = await images.upload({ data: 'iVBORw0KGgo=', mimeType: 'image/png' })

    expect(result).toEqual(mockResponse.data)
    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.example.com/api/images',
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify({ data: 'iVBORw0KGgo=', mimeType: 'image/png' }),
      }),
    )
  })

  it('deletes an image by key', async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve({ success: true, data: null }),
    })
    vi.stubGlobal('fetch', mockFetch)

    await images.delete('abc-123.png')

    expect(mockFetch).toHaveBeenCalledWith(
      'https://test.example.com/api/images/abc-123.png',
      expect.objectContaining({ method: 'DELETE' }),
    )
  })
})
