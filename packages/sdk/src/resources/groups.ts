import type { HttpClient } from '../http.js'
import type { ApiResponse, LineGroup, ListGroupsParams } from '../types.js'

export class GroupsResource {
  constructor(private readonly http: HttpClient) {}

  /** List LINE groups the bot belongs to, optionally narrowed to one tag. */
  async list(params: ListGroupsParams = {}): Promise<LineGroup[]> {
    const query = new URLSearchParams()
    if (params.tagId) query.set('tagId', params.tagId)
    if (params.accountId) query.set('accountId', params.accountId)
    if (params.status) query.set('status', params.status)
    const suffix = query.toString() ? `?${query}` : ''
    const res = await this.http.get<ApiResponse<LineGroup[]>>(`/api/groups${suffix}`)
    return res.data
  }

  async get(id: string): Promise<LineGroup> {
    const res = await this.http.get<ApiResponse<LineGroup>>(`/api/groups/${id}`)
    return res.data
  }

  /** Register a group by hand. The webhook normally does this on its own. */
  async register(input: { id: string; name?: string | null; accountId?: string | null }): Promise<LineGroup> {
    const res = await this.http.post<ApiResponse<LineGroup>>('/api/groups', input)
    return res.data
  }

  async addTag(groupId: string, tagId: string): Promise<{ added: boolean; group: LineGroup | null }> {
    const res = await this.http.post<ApiResponse<{ added: boolean; group: LineGroup | null }>>(
      `/api/groups/${groupId}/tags`,
      { tagId },
    )
    return res.data
  }

  async removeTag(groupId: string, tagId: string): Promise<void> {
    await this.http.delete(`/api/groups/${groupId}/tags/${tagId}`)
  }
}
