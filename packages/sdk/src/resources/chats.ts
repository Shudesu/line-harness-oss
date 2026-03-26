import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  Operator,
  CreateOperatorInput,
  UpdateOperatorInput,
  Chat,
  ChatWithMessages,
  ChatListParams,
  CreateChatInput,
  UpdateChatInput,
  SendMessageInput,
} from '../types.js'

export class ChatsResource {
  constructor(private readonly http: HttpClient) {}

  // ── Operators ──────────────────────────────────────────

  async listOperators(): Promise<Operator[]> {
    const res = await this.http.get<ApiResponse<Operator[]>>('/api/operators')
    return res.data
  }

  async createOperator(input: CreateOperatorInput): Promise<Operator> {
    const res = await this.http.post<ApiResponse<Operator>>('/api/operators', input)
    return res.data
  }

  async updateOperator(id: string, input: UpdateOperatorInput): Promise<Operator> {
    const res = await this.http.put<ApiResponse<Operator>>(`/api/operators/${id}`, input)
    return res.data
  }

  async deleteOperator(id: string): Promise<void> {
    await this.http.delete(`/api/operators/${id}`)
  }

  // ── Chats ──────────────────────────────────────────────

  async list(params?: ChatListParams): Promise<Chat[]> {
    const query = new URLSearchParams()
    if (params?.status) query.set('status', params.status)
    if (params?.operatorId) query.set('operatorId', params.operatorId)
    const qs = query.toString()
    const path = qs ? `/api/chats?${qs}` : '/api/chats'
    const res = await this.http.get<ApiResponse<Chat[]>>(path)
    return res.data
  }

  async get(id: string): Promise<ChatWithMessages> {
    const res = await this.http.get<ApiResponse<ChatWithMessages>>(`/api/chats/${id}`)
    return res.data
  }

  async create(input: CreateChatInput): Promise<Chat> {
    const res = await this.http.post<ApiResponse<Chat>>('/api/chats', input)
    return res.data
  }

  async update(id: string, input: UpdateChatInput): Promise<Chat> {
    const res = await this.http.put<ApiResponse<Chat>>(`/api/chats/${id}`, input)
    return res.data
  }

  async assign(chatId: string, operatorId: string | null): Promise<Chat> {
    return this.update(chatId, { operatorId })
  }

  async send(chatId: string, input: SendMessageInput): Promise<{ sent: boolean; messageId: string }> {
    const res = await this.http.post<ApiResponse<{ sent: boolean; messageId: string }>>(
      `/api/chats/${chatId}/send`,
      input,
    )
    return res.data
  }
}
