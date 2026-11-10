import { describe, it, expect, vi } from 'vitest'
import { FriendsResource } from '../../src/resources/friends.js'
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

describe('FriendsResource', () => {
  it('list() no params calls GET /api/friends', async () => {
    const paginatedData = {
      items: [{ id: '1', lineUserId: 'U123', displayName: 'Alice', pictureUrl: null, statusMessage: null, isFollowing: true, tags: [], createdAt: '2026-03-21', updatedAt: '2026-03-21' }],
      total: 1,
      page: 1,
      limit: 50,
      hasNextPage: false,
    }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: paginatedData }) })
    const resource = new FriendsResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/friends')
    expect(result).toEqual(paginatedData)
  })

  it('list() with params calls GET /api/friends?limit=10&offset=20&tagId=x', async () => {
    const paginatedData = {
      items: [],
      total: 0,
      page: 1,
      limit: 10,
      hasNextPage: false,
    }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: paginatedData }) })
    const resource = new FriendsResource(http)
    const result = await resource.list({ limit: 10, offset: 20, tagId: 'x' })
    expect(http.get).toHaveBeenCalledWith('/api/friends?limit=10&offset=20&tagId=x')
    expect(result).toEqual(paginatedData)
  })

  it('get() calls GET /api/friends/:id', async () => {
    const friend = { id: '1', lineUserId: 'U123', displayName: 'Alice', pictureUrl: null, statusMessage: null, isFollowing: true, tags: [], createdAt: '2026-03-21', updatedAt: '2026-03-21' }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: friend }) })
    const resource = new FriendsResource(http)
    const result = await resource.get('friend-1')
    expect(http.get).toHaveBeenCalledWith('/api/friends/friend-1')
    expect(result).toEqual(friend)
  })

  it('count() calls GET /api/friends/count and returns plain number', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: { count: 42 } }) })
    const resource = new FriendsResource(http)
    const result = await resource.count()
    expect(http.get).toHaveBeenCalledWith('/api/friends/count')
    expect(result).toEqual(42)
  })

  it('addTag() calls POST /api/friends/:id/tags with { tagId }', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: null }) })
    const resource = new FriendsResource(http)
    await resource.addTag('friend-1', 'tag-1')
    expect(http.post).toHaveBeenCalledWith('/api/friends/friend-1/tags', { tagId: 'tag-1' })
  })

  it('removeTag() calls DELETE /api/friends/:id/tags/:tagId', async () => {
    const http = mockHttp({ delete: vi.fn().mockResolvedValue({ success: true, data: null }) })
    const resource = new FriendsResource(http)
    await resource.removeTag('friend-1', 'tag-1')
    expect(http.delete).toHaveBeenCalledWith('/api/friends/friend-1/tags/tag-1')
  })

  it('findByLineUserId() looks up one account by exact LINE user ID', async () => {
    const friend = { id: '1', lineUserId: 'U123' }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: { items: [friend], total: 1 } }) })
    const resource = new FriendsResource(http, 'default-account')
    expect(await resource.findByLineUserId('U123')).toEqual(friend)
    expect(http.get).toHaveBeenCalledWith('/api/friends?limit=1&lineUserId=U123&lineAccountId=default-account')
    await resource.findByLineUserId('U123', 'other-account')
    expect(http.get).toHaveBeenLastCalledWith('/api/friends?limit=1&lineUserId=U123&lineAccountId=other-account')
  })

  it('findByLineUserId() returns null when not found and refuses to run without an account', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: { items: [], total: 0 } }) })
    expect(await new FriendsResource(http, 'default-account').findByLineUserId('U404')).toBeNull()
    await expect(new FriendsResource(http).findByLineUserId('U123')).rejects.toThrow('accountId')
    await expect(new FriendsResource(http, 'default-account').findByLineUserId('')).rejects.toThrow('lineUserId')
    expect(http.get).toHaveBeenCalledTimes(1)
  })

  it('sendMessage() sends Idempotency-Key only when idempotencyKey is given', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: { messageId: 'm1' } }) })
    const resource = new FriendsResource(http)
    await resource.sendMessage('f1', 'hello')
    expect(http.post).toHaveBeenLastCalledWith('/api/friends/f1/messages', { messageType: 'text', content: 'hello' })
    await resource.sendMessage('f1', 'hello', 'text', undefined, { idempotencyKey: 'order-1' })
    expect(http.post).toHaveBeenLastCalledWith(
      '/api/friends/f1/messages',
      { messageType: 'text', content: 'hello' },
      { 'Idempotency-Key': 'order-1' },
    )
  })
})
