import { describe, it, expect, vi } from 'vitest'
import { ConversationsResource } from '../../src/resources/conversations.js'
import type { HttpClient } from '../../src/http.js'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return { get: vi.fn(), post: vi.fn(), put: vi.fn(), delete: vi.fn(), ...overrides } as unknown as HttpClient
}

describe('ConversationsResource', () => {
  it('list() no params calls GET /api/conversations', async () => {
    const data = { total: 0, items: [] }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data }) })
    const resource = new ConversationsResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/conversations')
    expect(result).toEqual(data)
  })

  it('list() with filters builds query string', async () => {
    const data = { total: 0, items: [] }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data }) })
    const resource = new ConversationsResource(http)
    await resource.list({ lineAccountId: 'acc_1', minHoursSince: 24, limit: 10, offset: 20 })
    expect(http.get).toHaveBeenCalledWith('/api/conversations?lineAccountId=acc_1&minHoursSince=24&limit=10&offset=20')
  })

  it('get() calls GET /api/conversations/:friendId', async () => {
    const detail = {
      friend: { friendId: 'frd_1', lineUserId: 'U1', displayName: 'A', lineAccountId: null, lineAccountName: null, isFollowing: true, tags: [] },
      messages: [],
    }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: detail }) })
    const resource = new ConversationsResource(http)
    const result = await resource.get({ friendId: 'frd_1' })
    expect(http.get).toHaveBeenCalledWith('/api/conversations/frd_1')
    expect(result).toEqual(detail)
  })

  it('get() with limit/before builds query string', async () => {
    const detail = {
      friend: { friendId: 'frd_1', lineUserId: 'U1', displayName: null, lineAccountId: null, lineAccountName: null, isFollowing: true, tags: [] },
      messages: [],
    }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: detail }) })
    const resource = new ConversationsResource(http)
    await resource.get({ friendId: 'frd_1', limit: 30, before: '2026-04-01T00:00:00' })
    expect(http.get).toHaveBeenCalledWith('/api/conversations/frd_1?limit=30&before=2026-04-01T00%3A00%3A00')
  })
})
