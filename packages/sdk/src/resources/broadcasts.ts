import type { HttpClient } from '../http.js'
import type { ApiResponse, Broadcast, CreateBroadcastInput, UpdateBroadcastInput, SegmentCondition } from '../types.js'

export class BroadcastsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Broadcast[]> {
    const res = await this.http.get<ApiResponse<Broadcast[]>>('/api/broadcasts')
    return res.data
  }

  async get(id: string): Promise<Broadcast> {
    const res = await this.http.get<ApiResponse<Broadcast>>(`/api/broadcasts/${id}`)
    return res.data
  }

  async create(input: CreateBroadcastInput): Promise<Broadcast> {
    const res = await this.http.post<ApiResponse<Broadcast>>('/api/broadcasts', input)
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
