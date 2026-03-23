import { describe, it, expect, vi } from 'vitest'
import { TagsResource } from '../../src/resources/tags.js'
import type { HttpClient } from '../../src/http.js'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

describe('TagsResource', () => {
  it('list() calls GET /api/tags and returns data', async () => {
    const tags = [{ id: '1', name: 'VIP', color: '#EF4444', createdAt: '2026-03-21' }]
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: tags }) })
    const resource = new TagsResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/tags')
    expect(result).toEqual(tags)
  })

  it('create() calls POST /api/tags with input', async () => {
    const tag = { id: '1', name: 'VIP', color: '#EF4444', createdAt: '2026-03-21' }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: tag }) })
    const resource = new TagsResource(http)
    const result = await resource.create({ name: 'VIP', color: '#EF4444' })
    expect(http.post).toHaveBeenCalledWith('/api/tags', { name: 'VIP', color: '#EF4444' })
    expect(result).toEqual(tag)
  })

  it('delete() calls DELETE /api/tags/:id', async () => {
    const http = mockHttp({ delete: vi.fn().mockResolvedValue({ success: true, data: null }) })
    const resource = new TagsResource(http)
    await resource.delete('tag-1')
    expect(http.delete).toHaveBeenCalledWith('/api/tags/tag-1')
  })
})
