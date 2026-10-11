import { afterEach, describe, expect, it, vi } from 'vitest'
import { ApiError, api, fetchApi } from './api'

vi.mock('./api-base', () => ({ getApiBase: () => 'https://worker.example.com' }))
afterEach(() => vi.unstubAllGlobals())

describe('API error details', () => {
  it.each([
    ['JSON reason', JSON.stringify({ error: '200文字以内で入力してください' }), '200文字以内で入力してください'],
    ['HTML error', '<html>error</html>', undefined],
    ['non-string reason', JSON.stringify({ error: { message: 'nested' } }), undefined],
    ['null response', 'null', undefined],
  ])('keeps the legacy message for %s', async (_name, body, detail) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(body, { status: 400 })))
    const error = await fetchApi('/api/account-settings/landing-texts').catch((err: unknown) => err)
    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({ status: 400, message: 'API error: 400', detail })
  })

  it('sends an explicit reset and retains empty strings as overrides', async () => {
    const fetch = vi.fn().mockImplementation(() => Promise.resolve(Response.json({ success: true })))
    vi.stubGlobal('fetch', fetch)
    await api.accountSettings.updateLandingTexts({})
    await api.accountSettings.updateLandingTexts({ qrFooter: '' })
    expect(fetch.mock.calls[0][1]).toMatchObject({ method: 'PUT', body: '{"value":{}}' })
    expect(fetch.mock.calls[1][1]).toMatchObject({ method: 'PUT', body: '{"value":{"qrFooter":""}}' })
  })
})
