/**
 * External API Client stub for MyService.
 *
 * Replace this with the actual API client for your external service
 * (e.g., MedicalForce, HotPepper, Shopify, etc.)
 */

// ─── Types ─────────────────────────────────────────────────

export interface Customer {
  id: string
  name: string
  email: string
  lineUserId: string | null
  tier: 'free' | 'basic' | 'premium'
  lastVisitDate: string | null
  visitCount: number
}

export interface Appointment {
  id: string
  customerId: string
  lineHarnessFriendId: string | null
  date: string
  time: string
  location: string
  status: 'confirmed' | 'cancelled' | 'completed'
}

export interface Membership {
  id: string
  customerId: string
  lineHarnessFriendId: string | null
  planName: string
  expiresAt: string
  renewUrl: string
}

// ─── Client ────────────────────────────────────────────────

const BASE_URL = 'https://api.myservice.example.com/v1'

export class MyServiceClient {
  private readonly apiKey: string

  constructor(apiKey: string) {
    this.apiKey = apiKey
  }

  private async request<T>(path: string, init?: RequestInit): Promise<T> {
    const response = await fetch(`${BASE_URL}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        'Content-Type': 'application/json',
        ...init?.headers,
      },
    })

    if (!response.ok) {
      const text = await response.text()
      throw new Error(`MyService API error ${response.status}: ${text}`)
    }

    return response.json() as Promise<T>
  }

  /**
   * List all customers from MyService.
   */
  async listCustomers(): Promise<Customer[]> {
    return this.request<Customer[]>('/customers')
  }

  /**
   * Get a single customer by ID.
   */
  async getCustomer(id: string): Promise<Customer> {
    return this.request<Customer>(`/customers/${id}`)
  }

  /**
   * Get appointments within the next N hours.
   */
  async getUpcomingAppointments(withinHours: number): Promise<Appointment[]> {
    return this.request<Appointment[]>(
      `/appointments?upcoming_hours=${withinHours}`,
    )
  }

  /**
   * Get memberships expiring within the next N days.
   */
  async getExpiringMemberships(withinDays: number): Promise<Membership[]> {
    return this.request<Membership[]>(
      `/memberships?expiring_within_days=${withinDays}`,
    )
  }
}
