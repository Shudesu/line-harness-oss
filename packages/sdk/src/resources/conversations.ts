import type { HttpClient } from '../http.js'
import type {
  ApiResponse,
  ConversationListParams,
  ConversationListResponse,
  ConversationDetail,
  GetConversationParams,
} from '../types.js'

export class ConversationsResource {
  constructor(
    private readonly http: HttpClient,
    private readonly defaultAccountId?: string,
  ) {}

  async list(params?: ConversationListParams): Promise<ConversationListResponse> {
    const query = new URLSearchParams()
    const accountId = params?.lineAccountId ?? this.defaultAccountId
    if (accountId) query.set('lineAccountId', accountId)
    if (params?.minHoursSince !== undefined) query.set('minHoursSince', String(params.minHoursSince))
    if (params?.maxHoursSince !== undefined) query.set('maxHoursSince', String(params.maxHoursSince))
    if (params?.limit !== undefined) query.set('limit', String(params.limit))
    if (params?.offset !== undefined) query.set('offset', String(params.offset))
    const qs = query.toString()
    const path = qs ? `/api/conversations?${qs}` : '/api/conversations'
    const res = await this.http.get<ApiResponse<ConversationListResponse>>(path)
    return res.data
  }

  async get(params: GetConversationParams): Promise<ConversationDetail> {
    const query = new URLSearchParams()
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    if (params.before !== undefined) query.set('before', params.before)
    const qs = query.toString()
    const path = qs
      ? `/api/conversations/${params.friendId}?${qs}`
      : `/api/conversations/${params.friendId}`
    const res = await this.http.get<ApiResponse<ConversationDetail>>(path)
    return res.data
  }
}
