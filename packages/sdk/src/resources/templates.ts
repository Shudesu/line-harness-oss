import type { HttpClient } from '../http.js'
import type { ApiResponse, CreateTemplateInput, Template, UpdateTemplateInput } from '../types.js'

export class TemplatesResource {
  constructor(private readonly http: HttpClient) {}

  async list(category?: string): Promise<Template[]> {
    const query = category ? `?${new URLSearchParams({ category }).toString()}` : ''
    const res = await this.http.get<ApiResponse<Template[]>>(`/api/templates${query}`)
    return res.data
  }

  async get(id: string): Promise<Template> {
    const res = await this.http.get<ApiResponse<Template>>(`/api/templates/${encodeURIComponent(id)}`)
    return res.data
  }

  async create(input: CreateTemplateInput): Promise<Template> {
    const res = await this.http.post<ApiResponse<Template>>('/api/templates', input)
    return res.data
  }

  async update(id: string, input: UpdateTemplateInput): Promise<Template> {
    const res = await this.http.put<ApiResponse<Template>>(`/api/templates/${encodeURIComponent(id)}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/templates/${encodeURIComponent(id)}`)
  }
}
