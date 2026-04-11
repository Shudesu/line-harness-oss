import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  TrackedLink,
  TrackedLinkWithClicks,
  CreateTrackedLinkInput,
  UpdateTrackedLinkInput,
} from '../types.js'

export class TrackedLinksResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<TrackedLink[]> {
    const res = await this.http.get<ApiResponse<TrackedLink[]>>('/api/tracked-links')
    return res.data
  }

  async create(input: CreateTrackedLinkInput): Promise<TrackedLink> {
    const res = await this.http.post<ApiResponse<TrackedLink>>('/api/tracked-links', input)
    return res.data
  }

  async update(id: string, input: UpdateTrackedLinkInput): Promise<TrackedLink> {
    const res = await this.http.patch<ApiResponse<TrackedLink>>(
      `/api/tracked-links/${id}`,
      input,
    )
    return res.data
  }

  async get(id: string): Promise<TrackedLinkWithClicks> {
    const res = await this.http.get<ApiResponse<TrackedLinkWithClicks>>(`/api/tracked-links/${id}`)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/tracked-links/${id}`)
  }
}
