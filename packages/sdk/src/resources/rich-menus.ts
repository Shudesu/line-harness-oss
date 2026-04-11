import type { HttpClient } from '../http.js'
import type { ApiResponse, RichMenu, CreateRichMenuInput } from '../types.js'

export class RichMenusResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<RichMenu[]> {
    const res = await this.http.get<ApiResponse<RichMenu[]>>('/api/rich-menus')
    return res.data
  }

  async create(menu: CreateRichMenuInput): Promise<{ richMenuId: string }> {
    const res = await this.http.post<ApiResponse<{ richMenuId: string }>>('/api/rich-menus', menu)
    return res.data
  }

  async delete(richMenuId: string): Promise<void> {
    await this.http.delete(`/api/rich-menus/${encodeURIComponent(richMenuId)}`)
  }

  async setDefault(richMenuId: string): Promise<void> {
    await this.http.post(`/api/rich-menus/${encodeURIComponent(richMenuId)}/default`)
  }

  async uploadImage(richMenuId: string, imageData: string, contentType: string = 'image/png'): Promise<void> {
    await this.http.post(`/api/rich-menus/${encodeURIComponent(richMenuId)}/image`, {
      imageData,
      contentType,
    })
  }
}
