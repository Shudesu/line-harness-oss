import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  AutoReply,
  CreateAutoReplyInput,
  UpdateAutoReplyInput,
} from '../types.js'

export class AutoRepliesResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  async list(accountId?: string): Promise<AutoReply[]> {
    const id = accountId ?? this.defaultAccountId
    const query = id ? `?accountId=${encodeURIComponent(id)}` : ''
    const res = await this.http.get<ApiResponse<AutoReply[]>>(`/api/auto-replies${query}`)
    return res.data
  }

  async get(id: string): Promise<AutoReply> {
    const res = await this.http.get<ApiResponse<AutoReply>>(`/api/auto-replies/${id}`)
    return res.data
  }

  async create(input: CreateAutoReplyInput): Promise<AutoReply> {
    const body = { ...input }
    if (!('lineAccountId' in body) && this.defaultAccountId) {
      body.lineAccountId = this.defaultAccountId
    }
    const res = await this.http.post<ApiResponse<AutoReply>>('/api/auto-replies', body)
    return res.data
  }

  async update(id: string, input: UpdateAutoReplyInput): Promise<AutoReply> {
    const res = await this.http.put<ApiResponse<AutoReply>>(`/api/auto-replies/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/auto-replies/${id}`)
  }
}
