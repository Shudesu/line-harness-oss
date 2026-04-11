import type { HttpClient } from '../http.js'
import type { ApiResponse, UploadedImage, UploadImageInput } from '../types.js'

export class ImagesResource {
  constructor(private readonly http: HttpClient) {}

  async upload(input: UploadImageInput): Promise<UploadedImage> {
    const res = await this.http.post<ApiResponse<UploadedImage>>('/api/images', input)
    return res.data
  }

  async delete(key: string): Promise<void> {
    await this.http.delete(`/api/images/${key}`)
  }
}
