import type { HttpClient } from '../http.js'
import type { ApiResponse, Broadcast, CreateBroadcastInput, UpdateBroadcastInput, SegmentCondition } from '../types.js'

export class BroadcastsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  async list(params?: { accountId?: string }): Promise<Broadcast[]> {
    const accountId = params?.accountId ?? this.defaultAccountId
    const query = accountId ? `?lineAccountId=${accountId}` : ''
    const res = await this.http.get<ApiResponse<Broadcast[]>>(`/api/broadcasts${query}`)
    return res.data
  }

  async get(id: string): Promise<Broadcast> {
    const res = await this.http.get<ApiResponse<Broadcast>>(`/api/broadcasts/${id}`)
    return res.data
  }

  async create(input: CreateBroadcastInput & { lineAccountId?: string }): Promise<Broadcast> {
    const body = { ...input }
    if (!body.lineAccountId && this.defaultAccountId) {
      body.lineAccountId = this.defaultAccountId
    }
    const res = await this.http.post<ApiResponse<Broadcast>>('/api/broadcasts', body)
    return res.data
  }

  async update(id: string, input: UpdateBroadcastInput): Promise<Broadcast> {
    const res = await this.http.put<ApiResponse<Broadcast>>(`/api/broadcasts/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/broadcasts/${id}`)
  }

  async send(id: string): Promise<Broadcast> {
    const res = await this.http.post<ApiResponse<Broadcast>>(`/api/broadcasts/${id}/send`)
    return res.data
  }

  async sendToSegment(id: string, conditions: SegmentCondition): Promise<Broadcast> {
    const res = await this.http.post<ApiResponse<Broadcast>>(
      `/api/broadcasts/${id}/send-segment`,
      { conditions },
    )
    return res.data
  }
}
