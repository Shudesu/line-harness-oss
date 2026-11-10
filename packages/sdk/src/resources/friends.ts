import type { HttpClient } from '../http.js'
import type { ApiResponse, PaginatedData, Friend, FriendListParams, MessageType } from '../types.js'

export class FriendsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  async list(params?: FriendListParams): Promise<PaginatedData<Friend>> {
    const query = new URLSearchParams()
    if (params?.limit !== undefined) query.set('limit', String(params.limit))
    if (params?.offset !== undefined) query.set('offset', String(params.offset))
    if (params?.tagId) query.set('tagId', params.tagId)
    if (params?.search) query.set('search', params.search)
    if (params?.lineUserId !== undefined) query.set('lineUserId', params.lineUserId)
    if (params?.metadata) {
      for (const [key, value] of Object.entries(params.metadata)) {
        query.set(`metadata.${key}`, String(value))
      }
    }
    const accountId = params?.accountId ?? this.defaultAccountId
    if (accountId) query.set('lineAccountId', accountId)
    const qs = query.toString()
    const path = qs ? `/api/friends?${qs}` : '/api/friends'
    const res = await this.http.get<ApiResponse<PaginatedData<Friend>>>(path)
    return res.data
  }

  /**
   * Resolve a friend by LINE user ID within one LINE account. Returns null
   * when the user is not a friend of that account — it never falls back to a
   * friend of another account, so it is safe for payment / webhook linking.
   */
  async findByLineUserId(lineUserId: string, accountId?: string): Promise<Friend | null> {
    const resolvedAccountId = accountId ?? this.defaultAccountId
    if (!lineUserId || !resolvedAccountId) {
      throw new Error('findByLineUserId requires lineUserId and an accountId (argument or client default)')
    }
    const { items } = await this.list({ lineUserId, accountId: resolvedAccountId, limit: 1 })
    return items[0] ?? null
  }

  async get(id: string): Promise<Friend> {
    const res = await this.http.get<ApiResponse<Friend>>(`/api/friends/${id}`)
    return res.data
  }

  async count(): Promise<number> {
    const res = await this.http.get<ApiResponse<{ count: number }>>('/api/friends/count')
    return res.data.count
  }

  async addTag(friendId: string, tagId: string): Promise<void> {
    await this.http.post(`/api/friends/${friendId}/tags`, { tagId })
  }

  async removeTag(friendId: string, tagId: string): Promise<void> {
    await this.http.delete(`/api/friends/${friendId}/tags/${tagId}`)
  }

  async sendMessage(
    friendId: string,
    content: string,
    messageType: MessageType = 'text',
    altText?: string,
    options?: {
      trackLinks?: boolean
      /**
       * Retrying with the same key (per friend) does not deliver or log the
       * message twice, and returns the original messageId. Reusing a key for
       * a different message is rejected with 422.
       */
      idempotencyKey?: string
    },
  ): Promise<{ messageId: string }> {
    const body = {
      messageType,
      content,
      ...(altText ? { altText } : {}),
      ...(options?.trackLinks !== undefined ? { trackLinks: options.trackLinks } : {}),
    }
    const path = `/api/friends/${friendId}/messages`
    const res = options?.idempotencyKey
      ? await this.http.post<ApiResponse<{ messageId: string }>>(path, body, { 'Idempotency-Key': options.idempotencyKey })
      : await this.http.post<ApiResponse<{ messageId: string }>>(path, body)
    return res.data
  }

  async setMetadata(friendId: string, fields: Record<string, unknown>): Promise<Friend> {
    const res = await this.http.put<ApiResponse<Friend>>(`/api/friends/${friendId}/metadata`, fields)
    return res.data
  }

  async setRichMenu(friendId: string, richMenuId: string): Promise<void> {
    await this.http.post(`/api/friends/${friendId}/rich-menu`, { richMenuId })
  }

  async removeRichMenu(friendId: string): Promise<void> {
    await this.http.delete(`/api/friends/${friendId}/rich-menu`)
  }
}
