import type { HttpClient } from '../http.js'
import type { ApiResponse } from '../types.js'
import type {
  CapacityChannel,
  ExternalReservationEventType,
  ExternalReservationParseStatus,
  ExternalReservationSourceResponse,
  PublicReservationSlot,
  Reservation,
  ReservationAccessTokensResponse,
  ReservationCancelResponse,
  ReservationCreateResponse,
  ReservationImportResponse,
  ReservationMenu,
  ReservationResource,
  ReservationSchedule,
  ReservationSessionResponse,
  ReservationSlot,
  ReservationSlotWithAvailability,
  ReservationSlotStatus,
  ReservationSource,
  ReservationStatus,
} from '@line-crm/shared'

export interface CreateReservationResourceInput {
  id?: string
  name: string
  description?: string | null
  lineAccountId?: string | null
  defaultDurationMinutes?: number
  defaultCapacity?: number
  defaultLineCapacity?: number | null
  defaultExternalCapacity?: number | null
  defaultBufferCapacity?: number
  googleCalendarConnectionId?: string | null
  slotIntervalMinutes?: number
  displayOrder?: number
  metadata?: string
}

export interface UpdateReservationResourceInput extends Partial<CreateReservationResourceInput> {
  isActive?: boolean
}

export interface CreateReservationMenuInput {
  id?: string
  name: string
  description?: string | null
  durationMinutes?: number
  unitType?: 'person' | 'group' | 'seat' | 'table'
  minPeople?: number
  maxPeople?: number | null
  priceAdult?: number | null
  priceChild?: number | null
  priceInfant?: number | null
  capacityCountAdult?: boolean
  capacityCountChild?: boolean
  capacityCountInfant?: boolean
  formFields?: string
  displayOrder?: number
  metadata?: string
}

export interface UpdateReservationMenuInput extends Partial<CreateReservationMenuInput> {
  isActive?: boolean
}

export interface CreateReservationScheduleInput {
  id?: string
  dayOfWeek: number
  startTime: string
  endTime: string
  slotIntervalMinutes?: number
  defaultCapacity?: number
  defaultLineCapacity?: number | null
  defaultExternalCapacity?: number | null
  defaultBufferCapacity?: number
}

export interface UpdateReservationScheduleInput extends Partial<CreateReservationScheduleInput> {
  isActive?: boolean
}

export interface GenerateReservationSlotsInput {
  resourceId: string
  dateFrom: string
  dateTo: string
}

export interface UpdateReservationSlotInput {
  status?: ReservationSlotStatus
  totalCapacity?: number
  lineCapacity?: number | null
  externalCapacity?: number | null
  bufferCapacity?: number
  note?: string | null
}

export interface ListReservationSlotsParams {
  resourceId: string
  date: string
  people?: number
  adultCount?: number
  childCount?: number
  infantCount?: number
}

export interface ListReservationsParams {
  date?: string
  slotId?: string
  userId?: string
  status?: ReservationStatus
  source?: ReservationSource
}

export interface CreateReservationInput {
  resourceId: string
  menuId: string
  slotId: string
  source?: ReservationSource
  capacityChannel?: CapacityChannel
  lineAccountId?: string | null
  userId?: string | null
  friendId?: string | null
  adultCount?: number
  childCount?: number
  infantCount?: number
  customer?: {
    name?: string | null
    phone?: string | null
    email?: string | null
  }
  formData?: Record<string, unknown>
  metadata?: Record<string, unknown>
}

export interface UpdateReservationStatusInput {
  status: ReservationStatus
  reason?: string | null
}

export interface CreateReservationSessionInput {
  idToken: string
  displayName?: string | null
}

export interface ListPublicReservationSlotsParams {
  resourceId: string
  date: string
  people?: number
  adultCount?: number
  childCount?: number
  infantCount?: number
}

export interface CreatePublicReservationInput {
  sessionToken: string
  resourceId: string
  menuId: string
  slotId: string
  adultCount?: number
  childCount?: number
  infantCount?: number
  customer?: {
    name?: string | null
    phone?: string | null
    email?: string | null
  }
  formData?: Record<string, unknown>
}

export interface ListMyReservationsParams {
  sessionToken: string
  status?: ReservationStatus | 'active'
}

export interface GetPublicReservationDetailInput {
  reservationId: string
  detailToken: string
}

export interface CancelPublicReservationInput {
  reservationId: string
  cancelToken: string
  reason?: string | null
}

export interface IssuePublicReservationTokensInput {
  reservationId: string
  sessionToken: string
}

export interface ImportJalanReservationInput {
  eventType: ExternalReservationEventType
  externalId?: string | null
  dedupeKey?: string | null
  gmailMessageId?: string | null
  receivedAt?: string | null
  rawText?: string | null
  parsedPayload?: string
  resourceId?: string
  menuId?: string
  slotId?: string
  adultCount?: number
  childCount?: number
  infantCount?: number
  customerName?: string | null
  customerPhone?: string | null
  customerEmail?: string | null
}

export interface ImportJalanGmailInput {
  gmailMessageId: string
  rawText: string
  receivedAt?: string | null
  resourceId?: string
  menuId?: string
  slotId?: string
}

export type JalanGmailImportResponse = ReservationImportResponse & {
  parsed?: Record<string, unknown>
}

export interface StartGoogleCalendarOAuthInput {
  calendarId?: string
  returnTo?: string
}

export interface ListExternalReservationSourcesParams {
  source?: 'jalan' | 'gmail' | 'phone' | 'manual'
  parseStatus?: ExternalReservationParseStatus
  limit?: number
}

export interface UpdateExternalReservationSourceParseStatusInput {
  parseStatus: ExternalReservationParseStatus
  lastError?: string | null
}

export class ReservationsResource {
  constructor(private readonly http: HttpClient) {}

  async listResources(): Promise<ReservationResource[]> {
    const res = await this.http.get<ApiResponse<ReservationResource[]>>('/api/reservation-resources')
    return res.data
  }

  async createResource(input: CreateReservationResourceInput): Promise<ReservationResource> {
    const res = await this.http.post<ApiResponse<ReservationResource>>('/api/reservation-resources', input)
    return res.data
  }

  async updateResource(resourceId: string, input: UpdateReservationResourceInput): Promise<ReservationResource> {
    const res = await this.http.put<ApiResponse<ReservationResource>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}`,
      input,
    )
    return res.data
  }

  async listMenus(resourceId: string): Promise<ReservationMenu[]> {
    const res = await this.http.get<ApiResponse<ReservationMenu[]>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}/menus`,
    )
    return res.data
  }

  async createMenu(resourceId: string, input: CreateReservationMenuInput): Promise<ReservationMenu> {
    const res = await this.http.post<ApiResponse<ReservationMenu>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}/menus`,
      input,
    )
    return res.data
  }

  async updateMenu(resourceId: string, menuId: string, input: UpdateReservationMenuInput): Promise<ReservationMenu> {
    const res = await this.http.put<ApiResponse<ReservationMenu>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}/menus/${encodeURIComponent(menuId)}`,
      input,
    )
    return res.data
  }

  async listSchedules(resourceId: string): Promise<ReservationSchedule[]> {
    const res = await this.http.get<ApiResponse<ReservationSchedule[]>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}/schedules`,
    )
    return res.data
  }

  async createSchedule(resourceId: string, input: CreateReservationScheduleInput): Promise<ReservationSchedule> {
    const res = await this.http.post<ApiResponse<ReservationSchedule>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}/schedules`,
      input,
    )
    return res.data
  }

  async updateSchedule(
    resourceId: string,
    scheduleId: string,
    input: UpdateReservationScheduleInput,
  ): Promise<ReservationSchedule> {
    const res = await this.http.put<ApiResponse<ReservationSchedule>>(
      `/api/reservation-resources/${encodeURIComponent(resourceId)}/schedules/${encodeURIComponent(scheduleId)}`,
      input,
    )
    return res.data
  }

  async generateSlots(input: GenerateReservationSlotsInput): Promise<ReservationSlot[]> {
    const res = await this.http.post<ApiResponse<ReservationSlot[]>>('/api/reservation-slots/generate', input)
    return res.data
  }

  async updateSlot(id: string, input: UpdateReservationSlotInput): Promise<ReservationSlot> {
    const res = await this.http.put<ApiResponse<ReservationSlot>>(
      `/api/reservation-slots/${encodeURIComponent(id)}`,
      input,
    )
    return res.data
  }

  async listSlots(params: ListReservationSlotsParams): Promise<ReservationSlotWithAvailability[]> {
    const query = new URLSearchParams({
      resourceId: params.resourceId,
      date: params.date,
    })
    if (params.people !== undefined) query.set('people', String(params.people))
    if (params.adultCount !== undefined) query.set('adultCount', String(params.adultCount))
    if (params.childCount !== undefined) query.set('childCount', String(params.childCount))
    if (params.infantCount !== undefined) query.set('infantCount', String(params.infantCount))
    const res = await this.http.get<ApiResponse<ReservationSlotWithAvailability[]>>(`/api/reservation-slots?${query}`)
    return res.data
  }

  async list(params: ListReservationsParams = {}): Promise<Reservation[]> {
    const query = new URLSearchParams()
    if (params.date) query.set('date', params.date)
    if (params.slotId) query.set('slotId', params.slotId)
    if (params.userId) query.set('userId', params.userId)
    if (params.status) query.set('status', params.status)
    if (params.source) query.set('source', params.source)
    const suffix = query.toString() ? `?${query}` : ''
    const res = await this.http.get<ApiResponse<Reservation[]>>(`/api/reservations${suffix}`)
    return res.data
  }

  async get(id: string): Promise<Reservation> {
    const res = await this.http.get<ApiResponse<Reservation>>(`/api/reservations/${encodeURIComponent(id)}`)
    return res.data
  }

  async create(input: CreateReservationInput): Promise<Reservation> {
    const res = await this.http.post<ApiResponse<Reservation>>('/api/reservations', input)
    return res.data
  }

  async updateStatus(id: string, input: UpdateReservationStatusInput): Promise<ReservationCancelResponse> {
    const res = await this.http.put<ApiResponse<ReservationCancelResponse>>(
      `/api/reservations/${encodeURIComponent(id)}/status`,
      input,
    )
    return res.data
  }

  async createSession(input: CreateReservationSessionInput): Promise<ReservationSessionResponse> {
    const res = await this.http.post<ApiResponse<ReservationSessionResponse>>('/api/public/reservation-session', input)
    return res.data
  }

  async listPublicMenus(resourceId: string): Promise<ReservationMenu[]> {
    const res = await this.http.get<ApiResponse<ReservationMenu[]>>(
      `/api/public/reservation-resources/${encodeURIComponent(resourceId)}/menus`,
    )
    return res.data
  }

  async listPublicSlots(params: ListPublicReservationSlotsParams): Promise<PublicReservationSlot[]> {
    const query = new URLSearchParams({ date: params.date })
    if (params.people !== undefined) query.set('people', String(params.people))
    if (params.adultCount !== undefined) query.set('adultCount', String(params.adultCount))
    if (params.childCount !== undefined) query.set('childCount', String(params.childCount))
    if (params.infantCount !== undefined) query.set('infantCount', String(params.infantCount))
    const res = await this.http.get<ApiResponse<PublicReservationSlot[]>>(
      `/api/public/reservation-resources/${encodeURIComponent(params.resourceId)}/slots?${query}`,
    )
    return res.data
  }

  async createPublic(input: CreatePublicReservationInput): Promise<ReservationCreateResponse> {
    const res = await this.http.post<ApiResponse<ReservationCreateResponse>>(
      '/api/public/reservations',
      {
        resourceId: input.resourceId,
        menuId: input.menuId,
        slotId: input.slotId,
        adultCount: input.adultCount,
        childCount: input.childCount,
        infantCount: input.infantCount,
        customer: input.customer,
        formData: input.formData,
      },
      { Authorization: `Bearer ${input.sessionToken}` },
    )
    return res.data
  }

  async listMine(params: ListMyReservationsParams): Promise<Reservation[]> {
    const query = params.status ? `?${new URLSearchParams({ status: params.status })}` : ''
    const res = await this.http.get<ApiResponse<Reservation[]>>(
      `/api/public/me/reservations${query}`,
      { Authorization: `Bearer ${params.sessionToken}` },
    )
    return res.data
  }

  async getPublicDetail(input: GetPublicReservationDetailInput): Promise<Reservation> {
    const query = new URLSearchParams({ token: input.detailToken })
    const res = await this.http.get<ApiResponse<Reservation>>(
      `/api/public/reservations/${encodeURIComponent(input.reservationId)}?${query}`,
    )
    return res.data
  }

  async issuePublicTokens(input: IssuePublicReservationTokensInput): Promise<ReservationAccessTokensResponse> {
    const res = await this.http.post<ApiResponse<ReservationAccessTokensResponse>>(
      `/api/public/reservations/${encodeURIComponent(input.reservationId)}/tokens`,
      {},
      { Authorization: `Bearer ${input.sessionToken}` },
    )
    return res.data
  }

  async cancelPublic(input: CancelPublicReservationInput): Promise<ReservationCancelResponse> {
    const res = await this.http.post<ApiResponse<ReservationCancelResponse>>(
      `/api/public/reservations/${encodeURIComponent(input.reservationId)}/cancel`,
      {
        token: input.cancelToken,
        reason: input.reason,
      },
    )
    return res.data
  }

  async importJalan(input: ImportJalanReservationInput): Promise<ReservationImportResponse> {
    const res = await this.http.post<ApiResponse<ReservationImportResponse>>(
      '/api/integrations/jalan/reservations/import',
      input,
    )
    return res.data
  }

  async importJalanGmail(input: ImportJalanGmailInput): Promise<JalanGmailImportResponse> {
    const res = await this.http.post<ApiResponse<JalanGmailImportResponse>>(
      '/api/integrations/jalan/gmail/import',
      input,
    )
    return res.data
  }

  async listExternalSources(params: ListExternalReservationSourcesParams = {}): Promise<ExternalReservationSourceResponse[]> {
    const query = new URLSearchParams()
    if (params.source) query.set('source', params.source)
    if (params.parseStatus) query.set('parseStatus', params.parseStatus)
    if (params.limit !== undefined) query.set('limit', String(params.limit))
    const suffix = query.toString() ? `?${query}` : ''
    const res = await this.http.get<ApiResponse<ExternalReservationSourceResponse[]>>(
      `/api/external-reservation-sources${suffix}`,
    )
    return res.data
  }

  async updateExternalSourceParseStatus(
    id: string,
    input: UpdateExternalReservationSourceParseStatusInput,
  ): Promise<ExternalReservationSourceResponse> {
    const res = await this.http.put<ApiResponse<ExternalReservationSourceResponse>>(
      `/api/external-reservation-sources/${encodeURIComponent(id)}/parse-status`,
      input,
    )
    return res.data
  }

  startGoogleCalendarOAuth(input: StartGoogleCalendarOAuthInput = {}): string {
    const query = new URLSearchParams()
    if (input.calendarId) query.set('calendarId', input.calendarId)
    if (input.returnTo) query.set('returnTo', input.returnTo)
    const suffix = query.toString() ? `?${query}` : ''
    return this.http.url(`/api/integrations/google-calendar/oauth/start${suffix}`)
  }
}
