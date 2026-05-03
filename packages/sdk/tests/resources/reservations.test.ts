import { describe, it, expect, vi } from 'vitest'
import { ReservationsResource } from '../../src/resources/reservations.js'
import type { HttpClient } from '../../src/http.js'
import type { Reservation, ReservationResource } from '@line-crm/shared'

function mockHttp(overrides: Partial<HttpClient> = {}): HttpClient {
  return {
    url: vi.fn((path: string) => `https://api.example.test${path}`),
    get: vi.fn(),
    post: vi.fn(),
    put: vi.fn(),
    patch: vi.fn(),
    delete: vi.fn(),
    ...overrides,
  } as unknown as HttpClient
}

const reservationResource: ReservationResource = {
  id: 'res_blueberry',
  lineAccountId: null,
  name: 'Blueberry',
  description: null,
  defaultDurationMinutes: 60,
  defaultCapacity: 10,
  defaultLineCapacity: 5,
  defaultExternalCapacity: 5,
  defaultBufferCapacity: 0,
  googleCalendarConnectionId: null,
  slotIntervalMinutes: 60,
  timezone: 'Asia/Tokyo',
  isActive: true,
  displayOrder: 0,
  metadata: '{}',
  createdAt: '2026-05-03T00:00:00+09:00',
  updatedAt: '2026-05-03T00:00:00+09:00',
}

const reservation: Reservation = {
  id: 'reservation-1',
  lineAccountId: null,
  userId: 'user-1',
  friendId: 'friend-1',
  slotId: 'slot-1',
  source: 'line',
  capacityChannel: 'line',
  externalReservationId: null,
  dedupeKey: null,
  title: 'Blueberry',
  reservationDate: '2026-06-01',
  startAt: '2026-06-01T09:00:00+09:00',
  endAt: '2026-06-01T10:00:00+09:00',
  status: 'confirmed',
  adultCount: 1,
  childCount: 0,
  totalPeople: 1,
  customerName: 'Yamada',
  customerPhone: null,
  customerEmail: null,
  cancelReason: null,
  formData: '{}',
  metadata: '{}',
  createdAt: '2026-05-03T00:00:00+09:00',
  updatedAt: '2026-05-03T00:00:00+09:00',
}

describe('ReservationsResource', () => {
  it('listResources() calls GET /api/reservation-resources', async () => {
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [reservationResource] }) })
    const resource = new ReservationsResource(http)

    const result = await resource.listResources()

    expect(http.get).toHaveBeenCalledWith('/api/reservation-resources')
    expect(result).toEqual([reservationResource])
  })

  it('create() calls POST /api/reservations with input', async () => {
    const input = {
      resourceId: 'res_blueberry',
      menuId: 'menu_60',
      slotId: 'slot-1',
      adultCount: 1,
      childCount: 0,
    }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: reservation }) })
    const resource = new ReservationsResource(http)

    const result = await resource.create(input)

    expect(http.post).toHaveBeenCalledWith('/api/reservations', input)
    expect(result).toEqual(reservation)
  })

  it('updateResource() calls resource update endpoint', async () => {
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: reservationResource }) })
    const resource = new ReservationsResource(http)

    const result = await resource.updateResource('res_blueberry', { isActive: false })

    expect(http.put).toHaveBeenCalledWith('/api/reservation-resources/res_blueberry', { isActive: false })
    expect(result).toEqual(reservationResource)
  })

  it('createPublic() sends LIFF session token in Authorization header', async () => {
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: reservation }) })
    const resource = new ReservationsResource(http)

    await resource.createPublic({
      sessionToken: 'session-token',
      resourceId: 'res_blueberry',
      menuId: 'menu_60',
      slotId: 'slot-1',
      adultCount: 1,
    })

    expect(http.post).toHaveBeenCalledWith(
      '/api/public/reservations',
      {
        resourceId: 'res_blueberry',
        menuId: 'menu_60',
        slotId: 'slot-1',
        adultCount: 1,
        childCount: undefined,
        customer: undefined,
        formData: undefined,
      },
      { Authorization: 'Bearer session-token' },
    )
  })

  it('updateSlot() calls slot update endpoint', async () => {
    const slot = {
      id: 'slot-1',
      resourceId: 'res_blueberry',
      date: '2026-06-01',
      startAt: '2026-06-01T09:00:00+09:00',
      endAt: '2026-06-01T10:00:00+09:00',
      totalCapacity: 20,
      lineCapacity: 10,
      externalCapacity: 10,
      bufferCapacity: 0,
      reservedCount: 0,
      lineReservedCount: 0,
      externalReservedCount: 0,
      status: 'closed',
      note: 'rain',
      createdAt: '2026-05-03T00:00:00+09:00',
      updatedAt: '2026-05-03T00:00:00+09:00',
    }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: slot }) })
    const resource = new ReservationsResource(http)

    const result = await resource.updateSlot('slot-1', { status: 'closed', note: 'rain' })

    expect(http.put).toHaveBeenCalledWith('/api/reservation-slots/slot-1', { status: 'closed', note: 'rain' })
    expect(result).toEqual(slot)
  })

  it('importJalan() calls integration endpoint', async () => {
    const payload = { status: 'duplicate' as const, reservation }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: payload }) })
    const resource = new ReservationsResource(http)

    const result = await resource.importJalan({ eventType: 'created', externalId: 'jalan-1' })

    expect(http.post).toHaveBeenCalledWith('/api/integrations/jalan/reservations/import', {
      eventType: 'created',
      externalId: 'jalan-1',
    })
    expect(result).toEqual(payload)
  })

  it('importJalanGmail() calls raw Gmail integration endpoint', async () => {
    const payload = { status: 'needs_review' as const, source: { id: 'source-1' }, parsed: { eventType: 'updated' } }
    const input = {
      gmailMessageId: 'gmail-message-1',
      rawText: '予約内容変更 予約番号: jalan-1',
      resourceId: 'res_blueberry',
      menuId: 'menu_60',
    }
    const http = mockHttp({ post: vi.fn().mockResolvedValue({ success: true, data: payload }) })
    const resource = new ReservationsResource(http)

    const result = await resource.importJalanGmail(input)

    expect(http.post).toHaveBeenCalledWith('/api/integrations/jalan/gmail/import', input)
    expect(result).toEqual(payload)
  })

  it('startGoogleCalendarOAuth() returns OAuth start URL without fetching', () => {
    const http = mockHttp()
    const resource = new ReservationsResource(http)

    const url = resource.startGoogleCalendarOAuth({
      calendarId: 'primary',
      returnTo: 'https://app.example.test/settings',
    })

    expect(http.url).toHaveBeenCalledWith(
      '/api/integrations/google-calendar/oauth/start?calendarId=primary&returnTo=https%3A%2F%2Fapp.example.test%2Fsettings',
    )
    expect(url).toBe(
      'https://api.example.test/api/integrations/google-calendar/oauth/start?calendarId=primary&returnTo=https%3A%2F%2Fapp.example.test%2Fsettings',
    )
  })

  it('listExternalSources() filters needs_review sources', async () => {
    const source = {
      id: 'external-source-1',
      source: 'jalan',
      eventType: 'updated',
      externalId: 'jalan-1',
      dedupeKey: null,
      reservationId: 'reservation-1',
      rawText: 'changed',
      parsedPayload: '{}',
      parseStatus: 'needs_review',
      receivedAt: '2026-05-03T00:00:00+09:00',
      lastError: null,
      createdAt: '2026-05-03T00:00:00+09:00',
      updatedAt: '2026-05-03T00:00:00+09:00',
    }
    const http = mockHttp({ get: vi.fn().mockResolvedValue({ success: true, data: [source] }) })
    const resource = new ReservationsResource(http)

    const result = await resource.listExternalSources({ parseStatus: 'needs_review', limit: 20 })

    expect(http.get).toHaveBeenCalledWith('/api/external-reservation-sources?parseStatus=needs_review&limit=20')
    expect(result).toEqual([source])
  })

  it('updateExternalSourceParseStatus() marks source as ignored', async () => {
    const source = {
      id: 'external-source-1',
      source: 'jalan',
      eventType: 'updated',
      externalId: 'jalan-1',
      dedupeKey: null,
      reservationId: 'reservation-1',
      rawText: null,
      parsedPayload: '{}',
      parseStatus: 'ignored',
      receivedAt: null,
      lastError: null,
      createdAt: '2026-05-03T00:00:00+09:00',
      updatedAt: '2026-05-03T00:00:00+09:00',
    }
    const http = mockHttp({ put: vi.fn().mockResolvedValue({ success: true, data: source }) })
    const resource = new ReservationsResource(http)

    const result = await resource.updateExternalSourceParseStatus('external-source-1', { parseStatus: 'ignored' })

    expect(http.put).toHaveBeenCalledWith(
      '/api/external-reservation-sources/external-source-1/parse-status',
      { parseStatus: 'ignored' },
    )
    expect(result).toEqual(source)
  })
})
