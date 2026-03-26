import { describe, it, expect, vi } from 'vitest'
import { ChatsResource } from '../../src/resources/chats.js'
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

const operator = {
  id: 'op-1',
  name: 'Alice',
  email: 'alice@example.com',
  role: 'operator' as const,
  isActive: true,
  createdAt: '2026-03-21T00:00:00Z',
  updatedAt: '2026-03-21T00:00:00Z',
}

const chat = {
  id: 'chat-1',
  friendId: 'friend-1',
  friendName: 'Bob',
  friendPictureUrl: null,
  operatorId: null,
  status: 'unread' as const,
  notes: null,
  lastMessageAt: null,
  createdAt: '2026-03-21T00:00:00Z',
  updatedAt: '2026-03-21T00:00:00Z',
}

describe('ChatsResource – Operators', () => {
  it('listOperators() calls GET /api/operators and returns Operator[]', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [operator] }) })
    const resource = new ChatsResource(http)
    const result = await resource.listOperators()
    expect(http.get).toHaveBeenCalledWith('/api/operators')
    expect(result).toEqual([operator])
  })

  it('createOperator() calls POST /api/operators with input', async () => {
    const input = { name: 'Alice', email: 'alice@example.com', role: 'operator' as const }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: operator }) })
    const resource = new ChatsResource(http)
    const result = await resource.createOperator(input)
    expect(http.post).toHaveBeenCalledWith('/api/operators', input)
    expect(result).toEqual(operator)
  })

  it('updateOperator() calls PUT /api/operators/:id with input', async () => {
    const input = { name: 'Alice Updated' }
    const updated = { ...operator, name: 'Alice Updated' }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: updated }) })
    const resource = new ChatsResource(http)
    const result = await resource.updateOperator('op-1', input)
    expect(http.put).toHaveBeenCalledWith('/api/operators/op-1', input)
    expect(result).toEqual(updated)
  })

  it('deleteOperator() calls DELETE /api/operators/:id', async () => {
    const http = mockHttp({ delete: vi.fn().mockResolvedValue({ success: true, data: null }) })
    const resource = new ChatsResource(http)
    await resource.deleteOperator('op-1')
    expect(http.delete).toHaveBeenCalledWith('/api/operators/op-1')
  })
})

describe('ChatsResource – Chats', () => {
  it('list() no params calls GET /api/chats', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [chat] }) })
    const resource = new ChatsResource(http)
    const result = await resource.list()
    expect(http.get).toHaveBeenCalledWith('/api/chats')
    expect(result).toEqual([chat])
  })

  it('list() with status filter calls GET /api/chats?status=unread', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [chat] }) })
    const resource = new ChatsResource(http)
    const result = await resource.list({ status: 'unread' })
    expect(http.get).toHaveBeenCalledWith('/api/chats?status=unread')
    expect(result).toEqual([chat])
  })

  it('list() with operatorId filter calls GET /api/chats?operatorId=op-1', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [chat] }) })
    const resource = new ChatsResource(http)
    await resource.list({ operatorId: 'op-1' })
    expect(http.get).toHaveBeenCalledWith('/api/chats?operatorId=op-1')
  })

  it('list() with both params calls GET /api/chats?status=in_progress&operatorId=op-1', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [] }) })
    const resource = new ChatsResource(http)
    await resource.list({ status: 'in_progress', operatorId: 'op-1' })
    expect(http.get).toHaveBeenCalledWith('/api/chats?status=in_progress&operatorId=op-1')
  })

  it('get() calls GET /api/chats/:id and returns ChatWithMessages', async () => {
    const chatWithMessages = { ...chat, messages: [] }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: chatWithMessages }) })
    const resource = new ChatsResource(http)
    const result = await resource.get('chat-1')
    expect(http.get).toHaveBeenCalledWith('/api/chats/chat-1')
    expect(result).toEqual(chatWithMessages)
  })

  it('create() calls POST /api/chats with friendId', async () => {
    const input = { friendId: 'friend-1' }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: chat }) })
    const resource = new ChatsResource(http)
    const result = await resource.create(input)
    expect(http.post).toHaveBeenCalledWith('/api/chats', input)
    expect(result).toEqual(chat)
  })

  it('update() calls PUT /api/chats/:id with input', async () => {
    const input = { status: 'in_progress' as const, notes: 'Follow up needed' }
    const updated = { ...chat, status: 'in_progress' as const, notes: 'Follow up needed' }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: updated }) })
    const resource = new ChatsResource(http)
    const result = await resource.update('chat-1', input)
    expect(http.put).toHaveBeenCalledWith('/api/chats/chat-1', input)
    expect(result).toEqual(updated)
  })

  it('assign() calls PUT /api/chats/:id with operatorId to assign', async () => {
    const assigned = { ...chat, operatorId: 'op-1' }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: assigned }) })
    const resource = new ChatsResource(http)
    const result = await resource.assign('chat-1', 'op-1')
    expect(http.put).toHaveBeenCalledWith('/api/chats/chat-1', { operatorId: 'op-1' })
    expect(result).toEqual(assigned)
  })

  it('assign() with null unassigns the operator', async () => {
    const unassigned = { ...chat, operatorId: null }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: unassigned }) })
    const resource = new ChatsResource(http)
    const result = await resource.assign('chat-1', null)
    expect(http.put).toHaveBeenCalledWith('/api/chats/chat-1', { operatorId: null })
    expect(result).toEqual(unassigned)
  })

  it('send() calls POST /api/chats/:id/send with content', async () => {
    const input = { content: 'Hello!' }
    const response = { sent: true, messageId: 'msg-1' }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: response }) })
    const resource = new ChatsResource(http)
    const result = await resource.send('chat-1', input)
    expect(http.post).toHaveBeenCalledWith('/api/chats/chat-1/send', input)
    expect(result).toEqual(response)
  })

  it('send() with messageType calls POST /api/chats/:id/send with messageType', async () => {
    const input = { content: '{"type":"bubble"}', messageType: 'flex' as const }
    const response = { sent: true, messageId: 'msg-2' }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: response }) })
    const resource = new ChatsResource(http)
    await resource.send('chat-1', input)
    expect(http.post).toHaveBeenCalledWith('/api/chats/chat-1/send', input)
  })
})
