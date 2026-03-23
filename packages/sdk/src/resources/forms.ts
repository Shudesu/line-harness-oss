import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  Form,
  FormSubmission,
  CreateFormInput,
  UpdateFormInput,
} from '../types.js'

export class FormsResource {
  constructor(private readonly http: HttpClient) {}

  async list(): Promise<Form[]> {
    const res = await this.http.get<ApiResponse<Form[]>>('/api/forms')
    return res.data
  }

  async get(id: string): Promise<Form> {
    const res = await this.http.get<ApiResponse<Form>>(`/api/forms/${id}`)
    return res.data
  }

  async create(input: CreateFormInput): Promise<Form> {
    const res = await this.http.post<ApiResponse<Form>>('/api/forms', input)
    return res.data
  }

  async update(id: string, input: UpdateFormInput): Promise<Form> {
    const res = await this.http.put<ApiResponse<Form>>(`/api/forms/${id}`, input)
    return res.data
  }

  async delete(id: string): Promise<void> {
    await this.http.delete(`/api/forms/${id}`)
  }

  async getSubmissions(formId: string): Promise<FormSubmission[]> {
    const res = await this.http.get<ApiResponse<FormSubmission[]>>(
      `/api/forms/${formId}/submissions`,
    )
    return res.data
  }
}
