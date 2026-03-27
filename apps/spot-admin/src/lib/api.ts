// ─── Types ───────────────────────────────────────────────────────────────────

export type Job = {
  id: string
  connectionId: string
  nurseryName: string
  nurseryId?: string | null
  address?: string | null
  station?: string | null
  hourlyRate?: number | null
  description?: string | null
  requirements?: string | null
  capacity: number
  workDate: string
  startTime: string
  endTime: string
  status: 'open' | 'filled' | 'completed' | 'cancelled'
  metadata?: Record<string, unknown> | null
  attendanceToken?: string | null
  createdAt: string
  updatedAt: string
  remainingSlots?: number
  nurseryData?: Nursery | null
}

export type Nursery = {
  id: string
  name: string
  prefecture?: string | null
  area?: string | null
  nurseryType?: string | null
  qualificationReq?: string | null
  address?: string | null
  station?: string | null
  accessInfo?: string | null
  hpUrl?: string | null
  description?: string | null
  requirements?: string | null
  notes?: string | null
  transportFee?: string | null
  breakMinutes?: number | null
  photoR2Keys?: string | null
  isActive: boolean
  createdAt: string
  updatedAt: string
}

export type Booking = {
  id: string
  friendId: string
  jobId?: string | null
  title?: string | null
  startAt?: string | null
  endAt?: string | null
  status: string
  approvalStatus: 'pending' | 'approved' | 'denied'
  checkInAt?: string | null
  checkOutAt?: string | null
  actualHours?: number | null
  metadata?: Record<string, unknown> | null
  createdAt: string
  updatedAt: string
  friendDisplayName?: string | null
  friendPictureUrl?: string | null
  qualificationType?: string | null
  nurseryName?: string | null
  workDate?: string | null
  startTime?: string | null
  endTime?: string | null
}

export type AttendanceRecord = {
  id: string
  friendId: string
  friendDisplayName?: string | null
  approvalStatus: string
  checkInAt?: string | null
  checkOutAt?: string | null
  actualHours?: number | null
}

export type ParsedJob = {
  nurseryId: string | null
  nurseryName: string
  workDate: string
  startTime: string
  endTime: string
  hourlyRate: number | null
  capacity: number
  description: string | null
  requirements: string | null
  address?: string | null
  station?: string | null
}

export type ApiResponse<T> = {
  success: boolean
  data: T
  error?: string
}

// ─── Fetch Helper ────────────────────────────────────────────────────────────

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8787'

function getApiKey(): string {
  if (typeof window !== 'undefined') {
    const stored = localStorage.getItem('spot_admin_api_key')
    if (stored) return stored
  }
  return process.env.NEXT_PUBLIC_API_KEY || ''
}

export async function fetchApi<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${getApiKey()}`,
      ...options?.headers,
    },
  })
  if (!res.ok) throw new Error(`API error: ${res.status}`)
  return res.json() as Promise<T>
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const api = {
  jobs: {
    list: (params?: { status?: string; fromDate?: string }) => {
      const query: Record<string, string> = {}
      if (params?.status) query.status = params.status
      if (params?.fromDate) query.fromDate = params.fromDate
      return fetchApi<ApiResponse<Job[]>>('/api/jobs?' + new URLSearchParams(query))
    },
    get: (id: string) =>
      fetchApi<ApiResponse<Job>>(`/api/jobs/${id}`),
    create: (data: {
      connectionId: string
      nurseryName: string
      nurseryId?: string
      address?: string
      station?: string
      hourlyRate?: number
      description?: string
      requirements?: string
      capacity?: number
      workDate: string
      startTime: string
      endTime: string
      metadata?: Record<string, unknown>
    }) =>
      fetchApi<ApiResponse<Job>>('/api/jobs', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Job>) =>
      fetchApi<ApiResponse<Job>>(`/api/jobs/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    updateStatus: (id: string, status: string) =>
      fetchApi<ApiResponse<void>>(`/api/jobs/${id}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      }),
    parseEmail: (text: string) =>
      fetchApi<ApiResponse<ParsedJob[]>>('/api/jobs/parse-email', {
        method: 'POST',
        body: JSON.stringify({ text }),
      }),
    batch: (jobs: ParsedJob[]) =>
      fetchApi<ApiResponse<unknown[]> & { count: number }>('/api/jobs/batch', {
        method: 'POST',
        body: JSON.stringify({
          jobs: jobs.map((j) => ({
            connectionId: 'default',
            nurseryName: j.nurseryName,
            nurseryId: j.nurseryId || undefined,
            address: j.address || undefined,
            station: j.station || undefined,
            hourlyRate: j.hourlyRate || undefined,
            description: j.description || undefined,
            requirements: j.requirements || undefined,
            capacity: j.capacity,
            workDate: j.workDate,
            startTime: j.startTime,
            endTime: j.endTime,
          })),
        }),
      }),
  },

  bookings: {
    pending: () =>
      fetchApi<ApiResponse<Booking[]>>('/api/bookings/pending'),
    approve: (id: string) =>
      fetchApi<ApiResponse<void>>(`/api/bookings/${id}/approve`, { method: 'POST' }),
    deny: (id: string) =>
      fetchApi<ApiResponse<void>>(`/api/bookings/${id}/deny`, { method: 'POST' }),
  },

  nurseries: {
    list: () =>
      fetchApi<ApiResponse<Nursery[]>>('/api/nurseries'),
    get: (id: string) =>
      fetchApi<ApiResponse<Nursery>>(`/api/nurseries/${id}`),
    create: (data: Partial<Nursery>) =>
      fetchApi<ApiResponse<Nursery>>('/api/nurseries', {
        method: 'POST',
        body: JSON.stringify(data),
      }),
    update: (id: string, data: Partial<Nursery>) =>
      fetchApi<ApiResponse<Nursery>>(`/api/nurseries/${id}`, {
        method: 'PUT',
        body: JSON.stringify(data),
      }),
    delete: (id: string) =>
      fetchApi<ApiResponse<void>>(`/api/nurseries/${id}`, { method: 'DELETE' }),
  },

  attendance: {
    qrToken: (jobId: string) =>
      fetchApi<ApiResponse<{ token: string }>>(`/api/attendance/qr/${jobId}`),
    byJob: (jobId: string) =>
      fetchApi<ApiResponse<AttendanceRecord[]>>(`/api/attendance/job/${jobId}`),
  },

  friends: {
    count: () =>
      fetchApi<ApiResponse<{ count: number }>>('/api/friends/count'),
  },
}
