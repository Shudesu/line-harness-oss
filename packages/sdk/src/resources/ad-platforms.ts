import type { HttpClient } from '../http.js'
import type { ApiResponse } from '../types.js'

export interface AdPlatform {
  id: string
  name: string
  displayName: string | null
  config: Record<string, unknown>
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export interface AdConversionLog {
  id: string
  adPlatformId: string
  friendId: string
  eventName: string
  clickId: string | null
  clickIdType: string | null
  status: string
  errorMessage: string | null
  createdAt: string
}

export interface CreateAdPlatformInput {
  name: 'meta' | 'x' | 'google' | 'tiktok'
  displayName?: string
  config: Record<string, unknown>
}

export interface UpdateAdPlatformInput {
  name?: string
  displayName?: string | null
  config?: Record<string, unknown>
  isActive?: boolean
}

export class AdPlatformsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<AdPlatform[]> {
    const res = await this.http.get<ApiResponse<AdPlatform[]>>('/api/ad-platforms')
    return res.data
  }

  async create(input: CreateAdPlatformInput): Promise<AdPlatform> {
    const res = await this.http.post<ApiResponse<AdPlatform>>('/api/ad-platforms', input)
    return res.data
  }

  async update(id: string, input: UpdateAdPlatformInput): Promise<AdPlatform> {
    const res = await this.http.put<ApiResponse<AdPlatform>>(`/api/ad-platforms/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/ad-platforms/${id}`)
  }

  async getLogs(id: string, limit?: number): Promise<AdConversionLog[]> {
    const path = limit
      ? `/api/ad-platforms/${id}/logs?limit=${limit}`
      : `/api/ad-platforms/${id}/logs`
    const res = await this.http.get<ApiResponse<AdConversionLog[]>>(path)
    return res.data
  }

  async test(platform: string, eventName: string, friendId?: string): Promise<{ message: string }> {
    const res = await this.http.post<ApiResponse<{ message: string }>>('/api/ad-platforms/test', {
      platform,
      eventName,
      friendId,
    })
    return res.data
  }
}
