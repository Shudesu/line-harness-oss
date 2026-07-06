/**
 * Thin client for the restaurant plugin worker's /api/admin endpoints.
 * Runs in Node (MCP server process), authenticated with PLUGIN_API_KEY.
 */

export interface PluginApiConfig {
  baseUrl: string
  apiKey: string
}

export class RestaurantPluginClient {
  constructor(private readonly config: PluginApiConfig) {}

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.config.baseUrl.replace(/\/$/, '')}/api/admin${path}`, {
      ...init,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.config.apiKey}`,
        ...(init?.headers ?? {}),
      },
    })
    const body = (await res.json()) as { success: boolean; data?: T; error?: string }
    if (!res.ok || !body.success) throw new Error(body.error ?? `HTTP ${res.status}`)
    return body.data as T
  }

  listReservations(date?: string): Promise<unknown[]> {
    return this.request(`/reservations${date ? `?date=${date}` : ''}`)
  }

  getMember(memberNo: string): Promise<unknown> {
    return this.request(`/members/${encodeURIComponent(memberNo)}`)
  }

  getStats(): Promise<unknown> {
    return this.request('/stats')
  }

  issueReward(memberNo: string, name?: string): Promise<unknown> {
    return this.request('/rewards', { method: 'POST', body: JSON.stringify({ memberNo, name }) })
  }

  createCampaign(name: string, discountText?: string, expiresAt?: string): Promise<unknown> {
    return this.request('/campaigns', { method: 'POST', body: JSON.stringify({ name, discountText, expiresAt }) })
  }

  listCampaigns(): Promise<unknown[]> {
    return this.request('/campaigns')
  }

  listTakeoutMenu(): Promise<unknown[]> {
    return this.request('/takeout/menu')
  }

  upsertTakeoutMenuItem(input: {
    id?: string
    name: string
    price: number
    description?: string
    isAvailable?: boolean
    sortOrder?: number
  }): Promise<unknown> {
    return this.request('/takeout/menu', { method: 'POST', body: JSON.stringify(input) })
  }
}

export function clientFromEnv(): RestaurantPluginClient {
  const baseUrl = process.env.RESTAURANT_PLUGIN_URL
  const apiKey = process.env.RESTAURANT_PLUGIN_API_KEY
  if (!baseUrl || !apiKey) {
    throw new Error('Missing env vars: RESTAURANT_PLUGIN_URL / RESTAURANT_PLUGIN_API_KEY')
  }
  return new RestaurantPluginClient({ baseUrl, apiKey })
}
