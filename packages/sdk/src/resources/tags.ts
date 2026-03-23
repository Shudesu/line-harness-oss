import type { HttpClient } from '../http.js'
import type { ApiResponse, Tag, CreateTagInput } from '../types.js'

export class TagsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Tag[]> {
    const res = await this.http.get<ApiResponse<Tag[]>>('/api/tags')
    return res.data
  }

  async create(input: CreateTagInput): Promise<Tag> {
    const res = await this.http.post<ApiResponse<Tag>>('/api/tags', input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/tags/${id}`)
  }
}
