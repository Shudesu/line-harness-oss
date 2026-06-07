import type {
  Friend,
  Tag,
  Scenario,
  ScenarioStep,
  ApiResponse,
  PaginatedResponse,
  User,
  LineAccount,
  ConversionPoint,
  Affiliate,
  Template,
  Automation,
  AutomationLog,
  Chat,
  Reminder,
  ReminderStep,
  ScoringRule,
  IncomingWebhook,
  IncomingWebhookCreated,
  OutgoingWebhook,
  OutgoingWebhookCreated,
  NotificationRule,
  Notification,
  AccountHealthLog,
  AccountMigration,
  StaffMember,
  Broadcast,
  BroadcastTargetType,
  EntryRoute,
  CreateEntryRouteInput,
  EntryRouteFunnel,
  TrafficPool,
  PoolAccount,
} from '@line-crm/shared'

/** Broadcast type from API (now camelCase after worker serialization) */
export type ApiBroadcast = Omit<Broadcast, 'targetType'> & {
  targetType: BroadcastTargetType;
  accountIds: string[] | null;
  dedupPriority: string[] | null;
  failedAccountIds: string[] | null;
};

export type BroadcastInsight = {
  broadcastId?: string
  delivered: number | null
  uniqueImpression: number | null
  uniqueClick: number | null
  uniqueMediaPlayed: number | null
  openRate: number | null
  clickRate: number | null
  status?: string
  fetchedAt?: string | null
}

const API_URL = process.env.NEXT_PUBLIC_API_URL
if (!API_URL) {
  throw new Error(
    'NEXT_PUBLIC_API_URL is not set. Build cannot proceed without a valid API URL. ' +
    'Set it in .env.production (local) or GitHub Secrets (CI).'
  )
}

/**
 * Read the CSRF token issued at login. The session credential itself lives in
 * an HttpOnly cookie (never exposed to JS); only the CSRF token is held
 * client-side and echoed back via the X-CSRF-Token header on mutating
 * requests. In a cross-site topology the SPA cannot read the API's CSRF cookie
 * directly, so the token is delivered in the login/session response body and
 * cached here.
 */
export const CSRF_STORAGE_KEY = 'lh_csrf'

export function getCsrfToken(): string {
  if (typeof window === 'undefined') return ''
  return localStorage.getItem(CSRF_STORAGE_KEY) || ''
}

export function setCsrfToken(token: string | undefined | null): void {
  if (typeof window === 'undefined' || !token) return
  localStorage.setItem(CSRF_STORAGE_KEY, token)
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const method = (options?.method ?? 'GET').toUpperCase()
  const csrfHeaders: Record<string, string> = {}
  if (MUTATING_METHODS.has(method)) {
    const token = getCsrfToken()
    if (token) csrfHeaders['X-CSRF-Token'] = token
  }
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    // Send the HttpOnly session cookie with every request.
    credentials: 'include',
    headers: {
      'Content-Type': 'application/json',
      ...csrfHeaders,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  if (res.status === 204) return undefined as T
  return res.json() as Promise<T>
}

export type FriendListParams = {
  offset?: string
  limit?: string | number
  tagId?: string
  accountId?: string
  search?: string
  /**
   * `false` でタグ enrich をスキップ。autocomplete 等で displayName/picture
   * しか使わない呼び出し向け。デフォルトは true（既存呼び出しの挙動維持）。
   */
  includeTags?: boolean
  /**
   * `true` で latestIncomingMessage / latestOutgoingAt / activeScenario /
   * handled を付与。L-step 風友だちリスト UI 用。デフォルトは false。
   */
  includeChatStatus?: boolean
  /** 並び替え。`oldest` で created_at ASC、未指定 / `recent` で DESC. */
  sort?: 'recent' | 'oldest'
  /** `unhandled` で「最新が未返信の incoming」だけに絞る (サーバ側 SQL filter). */
  handled?: 'unhandled'
}

export type FriendWithTags = Friend & { tags: Tag[] }
/** Friend list items, optionally hydrated with chat status (when ?includeChatStatus=true) */
export type FriendListItem = FriendWithTags & Partial<{
  latestIncomingMessage: { content: string; messageType: string; createdAt: string } | null
  latestOutgoingAt: string | null
  activeScenario: { name: string; status: string } | null
  handled: boolean
}>

export const api = {
  friends: {
    list: (params?: FriendListParams) => {
      const query: Record<string, string> = {}
      if (params?.offset) query.offset = String(params.offset)
      if (params?.limit) query.limit = String(params.limit)
      if (params?.tagId) query.tagId = params.tagId
      if (params?.accountId) query.lineAccountId = params.accountId
      if (params?.search) query.search = params.search
      if (params?.includeTags === false) query.includeTags = 'false'
      if (params?.includeChatStatus) query.includeChatStatus = 'true'
      if (params?.sort) query.sort = params.sort
      if (params?.handled) query.handled = params.handled
      return fetchApi<ApiResponse<PaginatedResponse<FriendListItem>>>(
        '/api/friends?' + new URLSearchParams(query)
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<FriendWithTags>>(`/api/friends/${id}`),
    count: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<{ count: number }>>('/api/friends/count' + query)
    },
    addTag: (friendId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/tags`, {
        method: 'POST',
        body: JSON.stringify({ tagId }),
      }),
    removeTag: (friendId: string, tagId: string) =>
      fetchApi<ApiResponse<null>>(`/api/friends/${friendId}/tags/${tagId}`, {
        method: 'DELETE',
      }),
    richMenu: (id: string) =>
      fetchApi<ApiResponse<{ id: string | null; name: string | null; isDefault: boolean }>>(
        `/api/friends/${id}/rich-menu`,
      ),
  },
  tags: {
    list: () =>
      fetchApi<ApiResponse<Tag[]>>('/api/tags'),
    create: (data: { name: string; color: string }) =>
      fetchApi<ApiResponse<Tag>>('/api/tags', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/tags/${id}`, { method: 'DELETE' }),
  },
  scenarios: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<(Scenario & { stepCount?: number })[]>>('/api/scenarios' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Scenario & { steps: ScenarioStep[] }>>(`/api/scenarios/${id}`),
    create: (data: Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>) =>
      fetchApi<ApiResponse<Scenario>>('/api/scenarios', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Omit<Scenario, 'id' | 'createdAt' | 'updatedAt'>>) =>
      fetchApi<ApiResponse<Scenario>>(`/api/scenarios/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}`, { method: 'DELETE' }),
    addStep: (
      id: string,
      data: {
        stepOrder: number
        messageType: ScenarioStep['messageType']
        messageContent: string
        delayMinutes?: number
        offsetDays?: number
        offsetMinutes?: number
        deliveryTime?: string
        templateId?: string | null
        onReachTagId?: string | null
      },
    ) =>
      fetchApi<ApiResponse<ScenarioStep>>(`/api/scenarios/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateStep: (
      id: string,
      stepId: string,
      data: {
        stepOrder?: number
        messageType?: ScenarioStep['messageType']
        messageContent?: string
        delayMinutes?: number
        offsetDays?: number
        offsetMinutes?: number
        deliveryTime?: string
        templateId?: string | null
        onReachTagId?: string | null
      },
    ) =>
      fetchApi<ApiResponse<ScenarioStep>>(`/api/scenarios/${id}/steps/${stepId}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteStep: (id: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}/steps/${stepId}`, {
        method: 'DELETE',
      }),
    reorderSteps: (id: string, orders: { stepId: string; stepOrder: number }[]) =>
      fetchApi<ApiResponse<null>>(`/api/scenarios/${id}/steps/reorder`, {
        method: 'POST',
        body: JSON.stringify({ orders }),
      }),
    preview: (id: string, startAt?: string) => {
      const q = startAt ? `?startAt=${encodeURIComponent(startAt)}` : ''
      return fetchApi<ApiResponse<{
        startAt: string
        steps: Array<{
          stepOrder: number
          deliveryAt: string
          deliveryAtLabel: string
          messageType: string
          messageContent: string
        }>
      }>>(`/api/scenarios/${id}/preview${q}`)
    },
    stats: (id: string) =>
      fetchApi<ApiResponse<{
        enrolledTotal: number
        activeNow: number
        completed: number
        paused: number
        steps: Array<{ stepOrder: number; reachedCount: number; reachRate: number }>
      }>>(`/api/scenarios/${id}/stats`),
  },
  broadcasts: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<ApiBroadcast[]>>('/api/broadcasts' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}`),
    create: (data: {
      title: string
      messageType: ApiBroadcast['messageType']
      messageContent: string
      targetType: ApiBroadcast['targetType']
      targetTagId?: string | null
      scheduledAt?: string | null
      status?: ApiBroadcast['status']
      lineAccountId?: string | null
      accountIds?: string[]
      dedupPriority?: string[]
    }) =>
      fetchApi<ApiResponse<ApiBroadcast>>('/api/broadcasts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: {
        title?: string
        messageType?: ApiBroadcast['messageType']
        messageContent?: string
        targetType?: ApiBroadcast['targetType']
        targetTagId?: string | null
        scheduledAt?: string | null
      }
    ) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/broadcasts/${id}`, { method: 'DELETE' }),
    send: (id: string) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}/send`, { method: 'POST' }),
    getInsight: (id: string) =>
      fetchApi<ApiResponse<BroadcastInsight | null>>(`/api/broadcasts/${id}/insight`),
    fetchInsight: (id: string) =>
      fetchApi<ApiResponse<BroadcastInsight>>(`/api/broadcasts/${id}/fetch-insight`, { method: 'POST' }),
    testSend: (id: string) =>
      fetchApi<{ success: boolean; sent?: number; failed?: number; error?: string }>(`/api/broadcasts/${id}/test-send`, { method: 'POST' }),
    getProgress: (id: string) =>
      fetchApi<{ success: boolean; data?: { status: string; totalCount: number; successCount: number; batchOffset: number } }>(`/api/broadcasts/${id}/progress`),
    previewCount: (id: string) =>
      fetchApi<{
        success: boolean;
        data?: {
          count: number;
          perAccount?: Array<{ accountId: string; sendCount: number }>;
        };
        error?: string;
      }>(`/api/broadcasts/${id}/preview-count`),
    perAccountStats: (id: string) =>
      fetchApi<{
        success: boolean;
        data?: Array<{
          accountId: string;
          accountName: string;
          sent: number;
          uniqueImpression: number | null;
          uniqueClick: number | null;
        }>;
        error?: string;
      }>(`/api/broadcasts/${id}/per-account-stats`),
    sendSegment: (id: string, conditions: unknown) =>
      fetchApi<ApiResponse<ApiBroadcast>>(`/api/broadcasts/${id}/send-segment`, {
        method: 'POST',
        body: JSON.stringify({ conditions }),
      }),
    dedupPreview: (input: { accountIds: string[]; dedupPriority: string[]; targetTagId?: string | null }) =>
      fetchApi<{
        success: boolean;
        data?: {
          totalSelected: number;
          uniqueRecipients: number;
          reduction: number;
          reductionRate: number;
          perAccount: Array<{
            accountId: string;
            accountName: string;
            accountCountry: string | null;
            selectedCount: number;
            sendCount: number;
            excludedToHigherPriority: number;
          }>;
        };
        error?: string;
      }>('/api/broadcasts/dedup-preview', {
        method: 'POST',
        body: JSON.stringify(input),
      }),
  },

  segments: {
    count: (conditions: unknown, accountId?: string) =>
      fetchApi<{ success: boolean; count?: number; error?: string }>('/api/segments/count', {
        method: 'POST',
        body: JSON.stringify({ conditions, accountId }),
      }),
  },

  accountSettings: {
    getTestRecipients: (accountId: string) =>
      fetchApi<{ success: boolean; data: Array<{ id: string; displayName: string; pictureUrl: string | null }> }>(`/api/account-settings/test-recipients?accountId=${accountId}`),
    updateTestRecipients: (accountId: string, friendIds: string[]) =>
      fetchApi<{ success: boolean }>('/api/account-settings/test-recipients', {
        method: 'PUT',
        body: JSON.stringify({ accountId, friendIds }),
      }),
  },

  // ── Round 2 APIs ─────────────────────────────────────────────────────────
  users: {
    list: () =>
      fetchApi<ApiResponse<User[]>>('/api/users'),
    get: (id: string) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`),
    create: (data: { email?: string | null; phone?: string | null; externalId?: string | null; displayName?: string | null }) =>
      fetchApi<ApiResponse<User>>('/api/users', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<User, 'email' | 'phone' | 'externalId' | 'displayName'>>) =>
      fetchApi<ApiResponse<User>>(`/api/users/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${id}`, { method: 'DELETE' }),
    link: (userId: string, friendId: string) =>
      fetchApi<ApiResponse<null>>(`/api/users/${userId}/link`, {
        method: 'POST',
        body: JSON.stringify({ friendId }),
      }),
    accounts: (userId: string) =>
      fetchApi<ApiResponse<{ id: string; lineUserId: string; displayName: string | null; isFollowing: boolean }[]>>(
        `/api/users/${userId}/accounts`,
      ),
  },
  lineAccounts: {
    list: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    get: (id: string) =>
      fetchApi<ApiResponse<LineAccount>>(`/api/line-accounts/${id}`),
    create: (data: {
      channelId: string;
      name: string;
      channelAccessToken: string;
      channelSecret: string;
      loginChannelId?: string | null;
      loginChannelSecret?: string | null;
      liffId?: string | null;
    }) =>
      fetchApi<ApiResponse<LineAccount>>('/api/line-accounts', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    // Smart method routing:
    //   - rotating Messaging credentials (channelAccessToken / channelSecret)
    //     requires PUT (owner-only on the worker)
    //   - everything else routes to PATCH (admin-allowed)
    // This keeps a single helper signature for callers (toggle, country/role
    // edit, the edit modal) while letting admin users actually save the
    // non-credential changes. Without this, admin saves on the edit modal
    // would 403 even though the worker has a PATCH route that would accept
    // them.
    update: (
      id: string,
      data: Partial<
        Pick<
          LineAccount,
          | 'name'
          | 'channelAccessToken'
          | 'channelSecret'
          | 'loginChannelId'
          | 'loginChannelSecret'
          | 'liffId'
          | 'isActive'
          | 'country'
          | 'role'
        >
      >,
    ) => {
      const touchesMessagingCredentials =
        data.channelAccessToken !== undefined || data.channelSecret !== undefined
      return fetchApi<ApiResponse<LineAccount>>(`/api/line-accounts/${id}`, {
        method: touchesMessagingCredentials ? 'PUT' : 'PATCH',
        body: JSON.stringify(data),
      })
    },
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/line-accounts/${id}`, { method: 'DELETE' }),
    updateOrder: (ordered: Array<{ id: string; displayOrder: number }>) =>
      fetchApi<{ success: boolean; error?: string }>('/api/line-accounts/order', {
        method: 'PATCH',
        body: JSON.stringify({ ordered }),
      }),
  },
  conversions: {
    points: () =>
      fetchApi<ApiResponse<ConversionPoint[]>>('/api/conversions/points'),
    createPoint: (data: { name: string; eventType: string; value?: number | null }) =>
      fetchApi<ApiResponse<ConversionPoint>>('/api/conversions/points', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deletePoint: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/conversions/points/${id}`, { method: 'DELETE' }),
    track: (data: { conversionPointId: string; friendId: string; userId?: string | null; affiliateCode?: string | null; metadata?: Record<string, unknown> | null }) =>
      fetchApi<ApiResponse<unknown>>('/api/conversions/track', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    report: (params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{ conversionPointId: string; conversionPointName: string; eventType: string; totalCount: number; totalValue: number }[]>>(
        '/api/conversions/report?' + new URLSearchParams(params as Record<string, string>),
      ),
  },
  affiliates: {
    list: () =>
      fetchApi<ApiResponse<Affiliate[]>>('/api/affiliates'),
    get: (id: string) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`),
    create: (data: { name: string; code: string; commissionRate?: number }) =>
      fetchApi<ApiResponse<Affiliate>>('/api/affiliates', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Affiliate, 'name' | 'commissionRate' | 'isActive'>>) =>
      fetchApi<ApiResponse<Affiliate>>(`/api/affiliates/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/affiliates/${id}`, { method: 'DELETE' }),
    report: (id: string, params?: { startDate?: string; endDate?: string }) =>
      fetchApi<ApiResponse<{ affiliateId: string; affiliateName: string; code: string; commissionRate: number; totalClicks: number; totalConversions: number; totalRevenue: number }>>(
        `/api/affiliates/${id}/report?` + new URLSearchParams(params as Record<string, string>),
      ),
  },
  templates: {
    list: (category?: string) =>
      fetchApi<ApiResponse<Array<{
        id: string;
        name: string;
        category: string;
        messageType: string;
        messageContent: string;
        usageCount: number;
        createdAt: string;
        updatedAt: string;
      }>>>(
        '/api/templates' + (category ? '?' + new URLSearchParams({ category }) : ''),
      ),
    get: (id: string) =>
      fetchApi<ApiResponse<{
        id: string;
        name: string;
        category: string;
        messageType: string;
        messageContent: string;
        usedBy: {
          autoReplies: Array<{ id: string; keyword: string; matchType: 'exact' | 'contains'; lineAccountId: string | null }>;
          automations: Array<{ id: string; name: string; eventType: string }>;
        };
        createdAt: string;
        updatedAt: string;
      }>>(
        `/api/templates/${id}`,
      ),
    create: (data: { name: string; category: string; messageType: string; messageContent: string }) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        '/api/templates',
        { method: 'POST', body: JSON.stringify(data) },
      ),
    update: (id: string, data: Partial<{ name: string; category: string; messageType: string; messageContent: string }>) =>
      fetchApi<ApiResponse<{ id: string; name: string; category: string; messageType: string; messageContent: string; createdAt: string; updatedAt: string }>>(
        `/api/templates/${id}`,
        { method: 'PUT', body: JSON.stringify(data) },
      ),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/templates/${id}`, { method: 'DELETE' }),
    usages: (id: string) =>
      fetchApi<ApiResponse<{
        autoReplies: Array<{ id: string; keyword: string; lineAccountId: string | null }>;
        scenarioSteps: Array<{ scenarioId: string; scenarioName: string; stepId: string; stepOrder: number }>;
      }>>(`/api/templates/${id}/usages`),
  },
  autoReplies: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?accountId=' + encodeURIComponent(params.accountId) : ''
      return fetchApi<ApiResponse<Array<{
        id: string;
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
        createdAt: string;
        effectiveAccounts?: Array<{
          accountId: string;
          accountName: string;
          status: 'reply' | 'silent' | 'not_applicable';
          via: 'inline' | 'automation' | null;
        }>;
      }>>>('/api/auto-replies' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<{
        id: string;
        keyword: string;
        matchType: 'exact' | 'contains';
        responseType: string;
        responseContent: string;
        templateId: string | null;
        lineAccountId: string | null;
        isActive: boolean;
        createdAt: string;
      }>>(`/api/auto-replies/${id}`),
    create: (body: {
      keyword: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>('/api/auto-replies', {
        method: 'POST',
        body: JSON.stringify(body),
      }),
    update: (id: string, body: {
      keyword?: string;
      matchType?: 'exact' | 'contains';
      responseType?: string;
      responseContent?: string;
      templateId?: string | null;
      lineAccountId?: string | null;
      isActive?: boolean;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/auto-replies/${id}`, {
        method: 'PUT',
        body: JSON.stringify(body),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/auto-replies/${id}`, {
        method: 'DELETE',
      }),
  },
  automations: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Automation[]>>('/api/automations' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Automation & { logs?: AutomationLog[] }>>(`/api/automations/${id}`),
    create: (data: {
      name: string
      eventType: Automation['eventType']
      actions: Automation['actions']
      description?: string | null
      conditions?: Record<string, unknown>
      priority?: number
    }) =>
      fetchApi<ApiResponse<Automation>>('/api/automations', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Automation, 'name' | 'description' | 'eventType' | 'conditions' | 'actions' | 'isActive' | 'priority'>>) =>
      fetchApi<ApiResponse<Automation>>(`/api/automations/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/automations/${id}`, { method: 'DELETE' }),
    logs: (id: string, limit?: number) =>
      fetchApi<ApiResponse<AutomationLog[]>>(
        `/api/automations/${id}/logs` + (limit ? `?limit=${limit}` : ''),
      ),
  },
  chats: {
    list: (params?: { status?: string; operatorId?: string; accountId?: string; unansweredOnly?: boolean }) => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.operatorId) query.operatorId = params.operatorId
      if (params?.accountId) query.lineAccountId = params.accountId
      if (params?.unansweredOnly) query.unansweredOnly = '1'
      return fetchApi<ApiResponse<Chat[]>>(
        '/api/chats?' + new URLSearchParams(query),
      )
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Chat & { messages?: { id: string; content: string; senderType: string; createdAt: string }[] }>>(
        `/api/chats/${id}`,
      ),
    create: (data: { friendId: string; operatorId?: string | null }) =>
      fetchApi<ApiResponse<Chat>>('/api/chats', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { operatorId?: string | null; status?: Chat['status']; notes?: string | null }) =>
      fetchApi<ApiResponse<Chat>>(`/api/chats/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    send: (id: string, data: { content: string; messageType?: string }) =>
      fetchApi<ApiResponse<unknown>>(`/api/chats/${id}/send`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
  },
  reminders: {
    list: (params?: { accountId?: string }) => {
      const query = params?.accountId ? '?lineAccountId=' + params.accountId : ''
      return fetchApi<ApiResponse<Reminder[]>>('/api/reminders' + query)
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Reminder & { steps: ReminderStep[] }>>(`/api/reminders/${id}`),
    create: (data: { name: string; description?: string | null }) =>
      fetchApi<ApiResponse<Reminder>>('/api/reminders', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Pick<Reminder, 'name' | 'description' | 'isActive'>>) =>
      fetchApi<ApiResponse<Reminder>>(`/api/reminders/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${id}`, { method: 'DELETE' }),
    addStep: (id: string, data: { offsetMinutes: number; messageType: string; messageContent: string }) =>
      fetchApi<ApiResponse<ReminderStep>>(`/api/reminders/${id}/steps`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    deleteStep: (reminderId: string, stepId: string) =>
      fetchApi<ApiResponse<null>>(`/api/reminders/${reminderId}/steps/${stepId}`, {
        method: 'DELETE',
      }),
  },
  scoring: {
    rules: () =>
      fetchApi<ApiResponse<ScoringRule[]>>('/api/scoring-rules'),
    getRule: (id: string) =>
      fetchApi<ApiResponse<ScoringRule>>(`/api/scoring-rules/${id}`),
    createRule: (data: { name: string; eventType: string; scoreValue: number }) =>
      fetchApi<ApiResponse<ScoringRule>>('/api/scoring-rules', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    updateRule: (id: string, data: Partial<Pick<ScoringRule, 'name' | 'eventType' | 'scoreValue' | 'isActive'>>) =>
      fetchApi<ApiResponse<ScoringRule>>(`/api/scoring-rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    deleteRule: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/scoring-rules/${id}`, { method: 'DELETE' }),
    friendScore: (friendId: string) =>
      fetchApi<ApiResponse<{ totalScore: number; history: { id: string; scoreChange: number; reason: string | null; createdAt: string }[] }>>(
        `/api/friends/${friendId}/score`,
      ),
  },
  webhooks: {
    incoming: {
      list: () =>
        fetchApi<ApiResponse<IncomingWebhook[]>>('/api/webhooks/incoming'),
      create: (data: { name: string; sourceType?: string; secret: string }) =>
        fetchApi<ApiResponse<IncomingWebhookCreated>>('/api/webhooks/incoming', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<IncomingWebhook, 'name' | 'sourceType' | 'isActive'>> & { secret?: string }) =>
        fetchApi<ApiResponse<IncomingWebhook>>(`/api/webhooks/incoming/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/webhooks/incoming/${id}`, { method: 'DELETE' }),
    },
    outgoing: {
      list: () =>
        fetchApi<ApiResponse<OutgoingWebhook[]>>('/api/webhooks/outgoing'),
      create: (data: { name: string; url: string; eventTypes: string[]; secret: string }) =>
        fetchApi<ApiResponse<OutgoingWebhookCreated>>('/api/webhooks/outgoing', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<OutgoingWebhook, 'name' | 'url' | 'eventTypes' | 'isActive'>> & { secret?: string }) =>
        fetchApi<ApiResponse<OutgoingWebhook>>(`/api/webhooks/outgoing/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/webhooks/outgoing/${id}`, { method: 'DELETE' }),
    },
  },
  notifications: {
    rules: {
      list: () =>
        fetchApi<ApiResponse<NotificationRule[]>>('/api/notifications/rules'),
      get: (id: string) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`),
      create: (data: { name: string; eventType: string; conditions?: Record<string, unknown>; channels?: string[] }) =>
        fetchApi<ApiResponse<NotificationRule>>('/api/notifications/rules', {
          method: 'POST',
          body: JSON.stringify(data),
        }),
      update: (id: string, data: Partial<Pick<NotificationRule, 'name' | 'eventType' | 'conditions' | 'channels' | 'isActive'>>) =>
        fetchApi<ApiResponse<NotificationRule>>(`/api/notifications/rules/${id}`, {
          method: 'PUT',
          body: JSON.stringify(data),
        }),
      delete: (id: string) =>
        fetchApi<ApiResponse<null>>(`/api/notifications/rules/${id}`, { method: 'DELETE' }),
    },
    list: (params?: { status?: string; limit?: string }) =>
      fetchApi<ApiResponse<Notification[]>>(
        '/api/notifications?' + new URLSearchParams(params as Record<string, string>),
      ),
  },
  health: {
    accounts: () =>
      fetchApi<ApiResponse<LineAccount[]>>('/api/line-accounts'),
    getHealth: (accountId: string) =>
      fetchApi<ApiResponse<{ riskLevel: string; logs: AccountHealthLog[] }>>(
        `/api/accounts/${accountId}/health`,
      ),
    migrations: () =>
      fetchApi<ApiResponse<AccountMigration[]>>('/api/accounts/migrations'),
    migrate: (fromAccountId: string, data: { toAccountId: string }) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/${fromAccountId}/migrate`, {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    getMigration: (migrationId: string) =>
      fetchApi<ApiResponse<AccountMigration>>(`/api/accounts/migrations/${migrationId}`),
  },
  staff: {
    list: () =>
      fetchApi<ApiResponse<StaffMember[]>>('/api/staff'),
    get: (id: string) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`),
    me: () =>
      fetchApi<ApiResponse<{ id: string; name: string; role: string; email: string | null }>>('/api/staff/me'),
    create: (data: { name: string; email?: string; role: 'admin' | 'staff' }) =>
      fetchApi<ApiResponse<StaffMember>>('/api/staff', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: { name?: string; email?: string | null; role?: string; isActive?: boolean }) =>
      fetchApi<ApiResponse<StaffMember>>(`/api/staff/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/staff/${id}`, { method: 'DELETE' }),
    regenerateKey: (id: string) =>
      fetchApi<ApiResponse<{ apiKey: string }>>(`/api/staff/${id}/regenerate-key`, { method: 'POST' }),
  },
  usersGrouped: {
    list: (opts?: {
      q?: string;
      onlyDups?: boolean;
      account?: string;
      page?: number;
      pageSize?: number;
      forceRefresh?: boolean;
    }) => {
      const p = new URLSearchParams();
      if (opts?.q) p.set('q', opts.q);
      if (opts?.onlyDups) p.set('onlyDups', '1');
      if (opts?.account) p.set('account', opts.account);
      if (opts?.page) p.set('page', String(opts.page));
      if (opts?.pageSize) p.set('pageSize', String(opts.pageSize));
      if (opts?.forceRefresh) p.set('refresh', '1');
      const qs = p.toString();
      return fetchApi<ApiResponse<{
        total: number;
        page: number;
        pageSize: number;
        computedAt: string;
        rows: Array<{
          identityKey: string;
          identityKeyKind: 'url_token' | 'uid' | 'solo';
          displayName: string | null;
          pictureUrl: string | null;
          accounts: Array<{
            accountId: string;
            accountName: string;
            lineUserId: string;
            isFollowing: boolean;
            joinedAt: string;
            friendId: string;
          }>;
          xUsername: string | null;
          emails: string[];
          phones: string[];
          lastActivityAt: string;
          isDuplicate: boolean;
        }>;
      }>>(`/api/users-grouped${qs ? `?${qs}` : ''}`);
    },
  },
  inbox: {
    unanswered: {
      list: (opts?: {
        q?: string;
        account?: string;
        minWaitMinutes?: number;
        page?: number;
        pageSize?: number;
      }) => {
        const p = new URLSearchParams();
        if (opts?.q) p.set('q', opts.q);
        if (opts?.account) p.set('account', opts.account);
        if (opts?.minWaitMinutes) p.set('minWaitMinutes', String(opts.minWaitMinutes));
        if (opts?.page) p.set('page', String(opts.page));
        if (opts?.pageSize) p.set('pageSize', String(opts.pageSize));
        const qs = p.toString();
        return fetchApi<ApiResponse<{
          total: number;
          page: number;
          pageSize: number;
          rows: Array<{
            friendId: string;
            displayName: string | null;
            pictureUrl: string | null;
            accountId: string;
            accountName: string;
            lastIncomingAt: string;
            lastManualAt: string | null;
            lastMachineAt: string | null;
            lastIncomingType: string;
            lastIncomingContent: string;
          }>;
        }>>(`/api/inbox/unanswered${qs ? `?${qs}` : ''}`);
      },
      count: () =>
        fetchApi<ApiResponse<{
          total: number;
          byAccount: Array<{ accountId: string; accountName: string; count: number }>;
          oldestWaitMinutes: number | null;
        }>>('/api/inbox/unanswered/count'),
    },
  },
  richMenuGroups: {
    list: (accountId: string) =>
      fetchApi<ApiResponse<Array<{
        id: string;
        accountId: string;
        name: string;
        chatBarText: string;
        size: 'large' | 'compact';
        defaultPageId: string | null;
        isDefaultForAll: boolean;
        status: 'draft' | 'published';
        publishingAt: string | null;
        thumbnailR2Key: string | null;
        createdAt: string;
        updatedAt: string;
      }>>>(`/api/rich-menu-groups?accountId=${encodeURIComponent(accountId)}`),

    get: (groupId: string) =>
      fetchApi<ApiResponse<{
        id: string;
        accountId: string;
        name: string;
        chatBarText: string;
        size: 'large' | 'compact';
        defaultPageId: string | null;
        isDefaultForAll: boolean;
        status: 'draft' | 'published';
        publishingAt: string | null;
        createdAt: string;
        updatedAt: string;
        pages: Array<{
          id: string;
          orderIndex: number;
          name: string;
          aliasId: string;
          lineRichmenuId: string | null;
          imageR2Key: string | null;
          imageContentType: string | null;
          areas: Array<{
            id: string;
            boundsX: number;
            boundsY: number;
            boundsWidth: number;
            boundsHeight: number;
            actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
            actionData: Record<string, unknown>;
          }>;
        }>;
      }>>(`/api/rich-menu-groups/${groupId}`),

    create: (input: {
      accountId: string;
      name: string;
      chatBarText: string;
      size: 'large' | 'compact';
      pages: Array<{
        id?: string;
        name: string;
        orderIndex: number;
        areas: Array<{
          boundsX: number;
          boundsY: number;
          boundsWidth: number;
          boundsHeight: number;
          actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
          actionData: Record<string, unknown>;
        }>;
      }>;
    }) =>
      fetchApi<ApiResponse<{ id: string; pages: Array<{ id: string }> }>>('/api/rich-menu-groups', {
        method: 'POST',
        body: JSON.stringify(input),
      }),

    update: (groupId: string, input: {
      name?: string;
      chatBarText?: string;
      isDefaultForAll?: boolean;
      pages?: Array<{
        id?: string;
        name: string;
        orderIndex: number;
        areas: Array<{
          boundsX: number;
          boundsY: number;
          boundsWidth: number;
          boundsHeight: number;
          actionType: 'uri' | 'message' | 'postback' | 'richmenuswitch';
          actionData: Record<string, unknown>;
        }>;
      }>;
    }) =>
      fetchApi<ApiResponse<{ id: string }>>(`/api/rich-menu-groups/${groupId}`, {
        method: 'PATCH',
        body: JSON.stringify(input),
      }),

    delete: (groupId: string, opts?: { force?: boolean }) =>
      fetchApi<ApiResponse<null>>(
        `/api/rich-menu-groups/${groupId}${opts?.force ? '?force=true' : ''}`,
        { method: 'DELETE' },
      ),

    publish: (groupId: string) =>
      fetchApi<ApiResponse<{ pages: Array<{ pageId: string; newRichMenuId: string }> }>>(
        `/api/rich-menu-groups/${groupId}/publish`,
        { method: 'POST' },
      ),

    unpublish: (groupId: string) =>
      fetchApi<ApiResponse<{
        pages: Array<{ pageId: string; clearedRichMenuId: string | null }>;
        warnings: string[];
      }>>(`/api/rich-menu-groups/${groupId}/unpublish`, { method: 'POST' }),

    external: (accountId: string) =>
      fetchApi<ApiResponse<{
        currentDefault: string | null;
        lineMenus: Array<{
          richMenuId: string;
          name: string;
          chatBarText: string;
          size: { width: number; height: number };
          areasCount: number;
          isCurrentDefault: boolean;
          adminManaged: boolean;
          adminInfo: {
            groupId: string;
            groupName: string;
            pageName: string;
            groupStatus: 'draft' | 'published';
          } | null;
        }>;
      }>>(`/api/rich-menu-groups/external?accountId=${encodeURIComponent(accountId)}`),

    deleteExternal: (richMenuId: string, accountId: string) =>
      fetchApi<ApiResponse<null>>(
        `/api/rich-menu-groups/external/${richMenuId}?accountId=${encodeURIComponent(accountId)}`,
        { method: 'DELETE' },
      ),

    importFromLine: (richMenuId: string, accountId: string) =>
      fetchApi<ApiResponse<{ id: string; name: string }>>(
        `/api/rich-menu-groups/import?accountId=${encodeURIComponent(accountId)}&richMenuId=${encodeURIComponent(richMenuId)}`,
        { method: 'POST' },
      ),

    // LINE 上の rich menu 画像を admin proxy 経由で取得する URL。
    // <img src> として使う。staff 認証必要 (admin 経由なので browser fetch すると
    // クッキーや Authorization が必要 — 代わりに admin が cache-busting できる
    // タイムスタンプを付けるパターンで利用)。
    externalImageUrl: (richMenuId: string, accountId: string) =>
      `${API_URL}/api/rich-menu-groups/external/${richMenuId}/image?accountId=${encodeURIComponent(accountId)}`,

    applyToTag: (
      groupId: string,
      params:
        | { mode: 'bulk-link'; tagId: string | null }
        | { mode: 'set-default' },
    ) =>
      fetchApi<
        ApiResponse<{ chunks: number; total: number; message?: string; mode?: string }>
      >(`/api/rich-menu-groups/${groupId}/apply-to-tag`, {
        method: 'POST',
        body: JSON.stringify(params),
      }),

    // 画像 upload は Content-Type を image/* で送るので fetchApi を使わず直接 fetch。
    uploadImage: async (groupId: string, pageId: string, file: File) => {
      const csrf = getCsrfToken();
      const res = await fetch(
        `${API_URL}/api/rich-menu-groups/${groupId}/pages/${pageId}/image`,
        {
          method: 'POST',
          credentials: 'include',
          headers: {
            'Content-Type': file.type,
            ...(csrf ? { 'X-CSRF-Token': csrf } : {}),
          },
          body: file,
        },
      );
      const body = (await res.json()) as ApiResponse<{
        imageR2Key: string;
        imageContentType: string;
        size: 'large' | 'compact';
      }>;
      if (!body.success) {
        throw new Error(body.error ?? `upload failed: ${res.status}`);
      }
      return body;
    },

    // 注: <img src> では Authorization ヘッダを送れないため、Worker 側で
    //   この path のみ auth ミドルウェアの除外パスに加えるか、
    //   あるいは将来的に署名付き URL を発行する仕組みに切り替える必要がある。
    //   v1 ではドラフト編集中のプレビュー用 = 認証バイパスでも実害は低いので、
    //   後続 PR で worker 側を whitelist 化する想定。
    imageUrl: (key: string) =>
      `${API_URL}/api/rich-menu-images/${encodeURIComponent(key)}`,
  },
  messageTemplates: {
    list: () =>
      fetchApi<ApiResponse<Array<{
        id: string
        name: string
        messageType: string
        messageContent: string
        createdAt: string
        updatedAt: string
      }>>>('/api/message-templates'),
  },
  entryRoutes: {
    list: () => fetchApi<ApiResponse<EntryRoute[]>>('/api/entry-routes'),
    get: (id: string) => fetchApi<ApiResponse<EntryRoute>>(`/api/entry-routes/${id}`),
    create: (data: CreateEntryRouteInput) =>
      fetchApi<ApiResponse<EntryRoute>>('/api/entry-routes', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<CreateEntryRouteInput>) =>
      fetchApi<ApiResponse<EntryRoute>>(`/api/entry-routes/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/entry-routes/${id}`, { method: 'DELETE' }),
    funnel: (id: string) =>
      fetchApi<ApiResponse<EntryRouteFunnel>>(`/api/entry-routes/${id}/funnel`),
  },
  pools: {
    list: () => fetchApi<ApiResponse<TrafficPool[]>>('/api/traffic-pools'),
    get: (id: string) => fetchApi<ApiResponse<TrafficPool>>(`/api/traffic-pools/${id}`),
    create: (data: { slug: string; name: string; activeAccountId: string }) =>
      fetchApi<ApiResponse<TrafficPool>>('/api/traffic-pools', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (
      id: string,
      data: Partial<{ name: string; activeAccountId: string; isActive: boolean }>,
    ) =>
      fetchApi<ApiResponse<TrafficPool>>(`/api/traffic-pools/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<null>>(`/api/traffic-pools/${id}`, { method: 'DELETE' }),
    accounts: {
      list: (poolId: string) =>
        fetchApi<ApiResponse<PoolAccount[]>>(`/api/traffic-pools/${poolId}/accounts`),
      add: (poolId: string, lineAccountId: string) =>
        fetchApi<ApiResponse<PoolAccount>>(`/api/traffic-pools/${poolId}/accounts`, {
          method: 'POST',
          body: JSON.stringify({ lineAccountId }),
        }),
      toggle: (poolId: string, accountId: string, isActive: boolean) =>
        fetchApi<ApiResponse<PoolAccount>>(
          `/api/traffic-pools/${poolId}/accounts/${accountId}`,
          {
            method: 'PUT',
            body: JSON.stringify({ isActive }),
          },
        ),
      remove: (poolId: string, accountId: string) =>
        fetchApi<ApiResponse<null>>(
          `/api/traffic-pools/${poolId}/accounts/${accountId}`,
          { method: 'DELETE' },
        ),
    },
  },
  duplicates: {
    stats: (options?: { forceRefresh?: boolean }) =>
      fetchApi<ApiResponse<{
        totalFollowing: number;
        uniquePeople: number;
        friendDups: number;
        duplicateGroups: number;
        wastedPerBroadcastYen: number;
        msgUnitYen: number;
        perAccount: Array<{
          accountId: string;
          accountName: string;
          friends: number;
          dups: number;
          dupRate: number;
        }>;
        // Optional during rolling deploys when an older worker is live.
        pairwiseOverlap?: Array<{
          fromAccountId: string;
          toAccountId: string;
          overlap: number;
        }>;
        // Optional during rolling deploys when an older worker is live.
        computedAt?: string;
      }>>(options?.forceRefresh ? '/api/duplicates/stats?refresh=1' : '/api/duplicates/stats'),
  },
  uploads: {
    /**
     * 既存 /api/images エンドポイントを叩いて画像をアップロードする。
     * 10MB 超 / image/* 以外は 400 で返る。
     */
    image: async (file: File): Promise<ApiResponse<{ id: string; key: string; url: string; mimeType: string; size: number }>> => {
      const buf = await file.arrayBuffer()
      return fetchApi<ApiResponse<{ id: string; key: string; url: string; mimeType: string; size: number }>>('/api/images', {
        method: 'POST',
        headers: { 'Content-Type': file.type || 'application/octet-stream' },
        body: buf,
      })
    },
  },
}

// ----------------------------------------------------------------
// Booking API client (admin endpoints scoped by ?account_id=)
// ----------------------------------------------------------------

export interface BookingMenu {
  id: string;
  name: string;
  category_label: string | null;
  description: string | null;
  duration_minutes: number;
  buffer_after_minutes: number;
  base_price: number;
  sort_order: number;
  is_active: number;
}

export interface BookingStaff {
  id: string;
  name: string;
  display_name: string;
  role: string | null;
  profile_image_url: string | null;
  bio: string | null;
  sort_order: number;
  is_designation_optional: number;
  is_active: number;
}

export interface BookingShift {
  id: string;
  work_date: string;
  start_time: string;
  end_time: string;
}

export interface StaffMenuMatrix {
  menu_id: string;
  name: string;
  is_offered: number;
  override_duration_minutes: number | null;
  override_price: number | null;
}

export interface BookingRequest {
  id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  price_at_booking: number;
  menu_name: string;
  staff_name: string;
  friend_name: string | null;
}

function withAccount(path: string, accountId: string): string {
  return `${path}${path.includes('?') ? '&' : '?'}account_id=${encodeURIComponent(accountId)}`;
}

export const bookingApi = {
  // Menus
  listMenus: (accountId: string) =>
    fetchApi<{ menus: BookingMenu[] }>(withAccount('/api/booking/admin/menus', accountId)),
  createMenu: (accountId: string, body: Partial<BookingMenu>) =>
    fetchApi<{ id: string }>(withAccount('/api/booking/admin/menus', accountId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateMenu: (accountId: string, id: string, body: Partial<BookingMenu>) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/menus/${id}`, accountId), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteMenu: (accountId: string, id: string) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/menus/${id}`, accountId), {
      method: 'DELETE',
    }),
  // Staff
  listStaff: (accountId: string) =>
    fetchApi<{ staff: BookingStaff[] }>(withAccount('/api/booking/admin/staff', accountId)),
  createStaff: (accountId: string, body: Partial<BookingStaff>) =>
    fetchApi<{ id: string }>(withAccount('/api/booking/admin/staff', accountId), {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateStaff: (accountId: string, id: string, body: Partial<BookingStaff>) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/staff/${id}`, accountId), {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteStaff: (accountId: string, id: string) =>
    fetchApi<{ ok: true }>(withAccount(`/api/booking/admin/staff/${id}`, accountId), {
      method: 'DELETE',
    }),
  // staff_menus matrix
  getStaffMenus: (accountId: string, staffId: string) =>
    fetchApi<{ matrix: StaffMenuMatrix[] }>(
      withAccount(`/api/booking/admin/staff/${staffId}/menus`, accountId),
    ),
  putStaffMenus: (
    accountId: string,
    staffId: string,
    menus: Array<{
      menu_id: string;
      is_offered: boolean;
      override_duration_minutes?: number | null;
      override_price?: number | null;
    }>,
  ) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/booking/admin/staff/${staffId}/menus`, accountId),
      { method: 'PUT', body: JSON.stringify({ menus }) },
    ),
  // Shifts
  getShifts: (accountId: string, staffId: string) =>
    fetchApi<{ shifts: BookingShift[] }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts`, accountId),
    ),
  putShifts: (
    accountId: string,
    staffId: string,
    shifts: Array<{ work_date: string; start_time: string; end_time: string }>,
  ) =>
    fetchApi<{ ok: true; count: number }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts`, accountId),
      { method: 'PUT', body: JSON.stringify({ shifts }) },
    ),
  deleteShift: (accountId: string, staffId: string, shiftId: string) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts/${shiftId}`, accountId),
      { method: 'DELETE' },
    ),
  generateShifts: (
    accountId: string,
    staffId: string,
    body: {
      from_date: string;
      weeks: number;
      weekly_template: Record<string, { start: string; end: string } | null>;
    },
  ) =>
    fetchApi<{ inserted: number }>(
      withAccount(`/api/booking/admin/staff/${staffId}/shifts/generate`, accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  // Requests
  listRequests: (accountId: string, status: string = 'requested') =>
    fetchApi<{ requests: BookingRequest[] }>(
      withAccount(`/api/booking/admin/requests?status=${status}`, accountId),
    ),
  decideRequest: (
    accountId: string,
    id: string,
    action: 'approve' | 'reject' | 'cancel' | 'no_show' | 'complete',
  ) =>
    fetchApi<{ status: string }>(
      withAccount(`/api/booking/admin/requests/${id}`, accountId),
      { method: 'PATCH', body: JSON.stringify({ action }) },
    ),
  pendingCount: (accountId: string) =>
    fetchApi<{ count: number }>(withAccount('/api/booking/admin/pending-count', accountId)),
};

// ============================================================
// Event-booking admin API
// ============================================================

export interface EventListItem {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  sort_order: number;
  created_at: string;
  updated_at: string;
  next_slot_starts_at: string | null;
  total_capacity: number | null;
  total_active: number;
  pending_count: number;
  // Multi-account fields (migration 040)
  target_type?: 'single' | 'multi-account-dedup';
  account_ids?: string | string[] | null;
  line_account_id?: string;
}

export interface EventDetail {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  reminder_day_before_enabled: number;
  reminder_hours_before: number | null;
  is_published: number;
  sort_order: number;
  // Multi-account fields (migration 040, broadcasts と同パターン)
  target_type?: 'single' | 'multi-account-dedup';
  // Worker は JSON 文字列で返す。UI 側で parse して string[] を扱う。
  account_ids?: string | string[] | null;
  dedup_priority?: string | string[] | null;
  line_account_id?: string;
}

export interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  sort_order: number;
  active_count?: number;
}

export interface EventBookingItem {
  id: string;
  event_id: string;
  slot_id: string;
  friend_id: string;
  line_account_id: string;
  status: string;
  customer_note: string | null;
  internal_note: string | null;
  requested_at: string;
  decided_at: string | null;
  cancelled_at: string | null;
  cancelled_by: string | null;
  slot_starts_at: string;
  slot_ends_at: string;
  friend_display_name: string | null;
  friend_line_user_id: string | null;
}

export const eventsApi = {
  listEvents: (accountId: string) =>
    fetchApi<{ items: EventListItem[] }>(
      withAccount('/api/events/admin/events', accountId),
    ),
  getEvent: (accountId: string, id: string) =>
    fetchApi<EventDetail>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
    ),
  createEvent: (accountId: string, body: Partial<EventDetail>) =>
    fetchApi<EventDetail>(
      withAccount('/api/events/admin/events', accountId),
      { method: 'POST', body: JSON.stringify(body) },
    ),
  updateEvent: (accountId: string, id: string, body: Partial<EventDetail>) =>
    fetchApi<EventDetail>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  deleteEvent: (accountId: string, id: string) =>
    fetchApi<void>(
      withAccount(`/api/events/admin/events/${id}`, accountId),
      { method: 'DELETE' },
    ),

  listSlots: (accountId: string, eventId: string) =>
    fetchApi<{ items: EventSlot[] }>(
      withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
    ),
  createSlots: (
    accountId: string,
    eventId: string,
    slots: Array<{ starts_at: string; ends_at: string; capacity: number | null; is_active?: number; sort_order?: number }>,
  ) =>
    fetchApi<{ items: EventSlot[] }>(
      withAccount(`/api/events/admin/events/${eventId}/slots`, accountId),
      { method: 'POST', body: JSON.stringify({ slots }) },
    ),
  updateSlot: (accountId: string, eventId: string, slotId: string, body: Partial<EventSlot>) =>
    fetchApi<EventSlot>(
      withAccount(`/api/events/admin/events/${eventId}/slots/${slotId}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),
  deleteSlot: (accountId: string, eventId: string, slotId: string) =>
    fetchApi<void>(
      withAccount(`/api/events/admin/events/${eventId}/slots/${slotId}`, accountId),
      { method: 'DELETE' },
    ),

  listBookings: (
    accountId: string,
    eventId: string,
    filters: { status?: string; slot_id?: string } = {},
  ) => {
    const qs: string[] = [];
    if (filters.status) qs.push(`status=${encodeURIComponent(filters.status)}`);
    if (filters.slot_id) qs.push(`slot_id=${encodeURIComponent(filters.slot_id)}`);
    const tail = qs.length > 0 ? `?${qs.join('&')}` : '';
    return fetchApi<{ items: EventBookingItem[] }>(
      withAccount(`/api/events/admin/events/${eventId}/bookings${tail}`, accountId),
    );
  },
  decideBooking: (
    accountId: string,
    eventId: string,
    bookingId: string,
    action: 'confirm' | 'reject',
    reason?: string,
  ) =>
    fetchApi<EventBookingItem>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}/decide`, accountId),
      { method: 'POST', body: JSON.stringify({ action, reason }) },
    ),
  adminCancelBooking: (accountId: string, eventId: string, bookingId: string) =>
    fetchApi<{ ok: true }>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}/cancel`, accountId),
      { method: 'POST' },
    ),
  updateBooking: (
    accountId: string,
    eventId: string,
    bookingId: string,
    body: { internal_note?: string | null; status?: 'attended' | 'no_show' },
  ) =>
    fetchApi<EventBookingItem>(
      withAccount(`/api/events/admin/events/${eventId}/bookings/${bookingId}`, accountId),
      { method: 'PUT', body: JSON.stringify(body) },
    ),

  pendingCount: (accountId: string) =>
    fetchApi<{ count: number }>(
      withAccount('/api/events/admin/events/notifications/pending', accountId),
    ),
};
