import type { HttpClient } from '../http.js'
import type { ApiResponse, StaffMember, StaffProfile, CreateStaffInput, UpdateStaffInput } from '../types.js'

export class StaffResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<StaffMember[]> {
    const res = await this.http.get<ApiResponse<StaffMember[]>>('/api/staff')
    return res.data
  }

  async get(id: string): Promise<StaffMember> {
    const res = await this.http.get<ApiResponse<StaffMember>>(`/api/staff/${id}`)
    return res.data
  }

  async me(): Promise<StaffProfile> {
    const res = await this.http.get<ApiResponse<StaffProfile>>('/api/staff/me')
    return res.data
  }

  async create(input: CreateStaffInput): Promise<StaffMember> {
    const res = await this.http.post<ApiResponse<StaffMember>>('/api/staff', input)
    return res.data
  }

  async update(id: string, input: UpdateStaffInput): Promise<StaffMember> {
    const res = await this.http.patch<ApiResponse<StaffMember>>(`/api/staff/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/staff/${id}`)
  }

  async regenerateKey(id: string): Promise<{ apiKey: string }> {
    const res = await this.http.post<ApiResponse<{ apiKey: string }>>(`/api/staff/${id}/regenerate-key`)
    return res.data
  }
}
