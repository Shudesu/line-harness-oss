import { describe, it, expect, vi } from 'vitest'
import { TrackedLinksResource } from '../../src/resources/tracked-links.js'
import type { HttpClient } from '../../src/http.js'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

const sampleLink = {
  id: 'tl1',
  name: 'campaign',
  originalUrl: 'https://example.com',
  trackingUrl: 'https://lh/t/tl1',
  tagId: null,
  scenarioId: null,
  introTemplateId: 'tpl-1',
  rewardTemplateId: null,
  isActive: true,
  clickCount: 0,
  createdAt: '2026-04-07',
  updatedAt: '2026-04-07',
}

describe('TrackedLinksResource', () => {
  it('create() が introTemplateId をボディに含めて POST する', async () => {
    const http = mockHttp({
      post: vi.fn().mockResolvedValue({ success: true, data: sampleLink }),
    })
    const resource = new TrackedLinksResource(http)

    const result = await resource.create({
      name: 'campaign',
      originalUrl: 'https://example.com',
      introTemplateId: 'tpl-1',
    })

    expect(http.post).toHaveBeenCalledWith('/api/tracked-links', {
      name: 'campaign',
      originalUrl: 'https://example.com',
      introTemplateId: 'tpl-1',
    })
    expect(result.introTemplateId).toBe('tpl-1')
  })

  it('update() が PATCH /api/tracked-links/:id を呼び出す', async () => {
    const updated = { ...sampleLink, introTemplateId: 'tpl-2', clickCount: 5 }
    const http = mockHttp({
      patch: vi.fn().mockResolvedValue({ success: true, data: updated }),
    })
    const resource = new TrackedLinksResource(http)

    const result = await resource.update('tl1', { introTemplateId: 'tpl-2' })

    expect(http.patch).toHaveBeenCalledWith('/api/tracked-links/tl1', {
      introTemplateId: 'tpl-2',
    })
    expect(result.introTemplateId).toBe('tpl-2')
  })

  it('create が rewardTemplateId をボディに含めて POST する', async () => {
    const linkWithReward = { ...sampleLink, rewardTemplateId: 'tpl-reward' }
    const http = mockHttp({
      post: vi.fn().mockResolvedValue({ success: true, data: linkWithReward }),
    })
    const resource = new TrackedLinksResource(http)

    const result = await resource.create({
      name: 'campaign',
      originalUrl: 'https://example.com',
      rewardTemplateId: 'tpl-reward',
    })

    expect(http.post).toHaveBeenCalledWith('/api/tracked-links', {
      name: 'campaign',
      originalUrl: 'https://example.com',
      rewardTemplateId: 'tpl-reward',
    })
    expect(result.rewardTemplateId).toBe('tpl-reward')
  })

  it('list() calls GET /api/tracked-links', async () => {
    const http = mockHttp({
      get: vi.fn().mockResolvedValue({ success: true, data: [sampleLink] }),
    })
    const resource = new TrackedLinksResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/tracked-links')
    expect(result).toEqual([sampleLink])
  })
})
