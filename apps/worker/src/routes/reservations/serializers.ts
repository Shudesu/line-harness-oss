import type {
  Reservation,
  ReservationMenu,
  ReservationResource,
  ReservationSchedule,
  ReservationSlot,
} from '@line-crm/db';
import type {
  ReservationSlotAvailability,
  ReservationMenu as ReservationMenuResponse,
  ReservationResource as ReservationResourceResponse,
  ReservationResponse,
  ReservationSchedule as ReservationScheduleResponse,
  ReservationSlot as ReservationSlotResponse,
  ExternalReservationSourceResponse,
} from '@line-crm/shared';
import type { ExternalReservationSourceRow } from '@line-crm/db';

export function toResourceResponse(item: ReservationResource): ReservationResourceResponse {
  return {
    id: item.id,
    lineAccountId: item.line_account_id,
    name: item.name,
    description: item.description,
    defaultDurationMinutes: item.default_duration_minutes,
    defaultCapacity: item.default_capacity,
    defaultLineCapacity: item.default_line_capacity,
    defaultExternalCapacity: item.default_external_capacity,
    defaultBufferCapacity: item.default_buffer_capacity,
    googleCalendarConnectionId: item.google_calendar_connection_id,
    slotIntervalMinutes: item.slot_interval_minutes,
    timezone: item.timezone,
    isActive: item.is_active === 1,
    displayOrder: item.display_order,
    metadata: item.metadata,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function toMenuResponse(item: ReservationMenu): ReservationMenuResponse {
  return {
    id: item.id,
    resourceId: item.resource_id,
    name: item.name,
    description: item.description,
    durationMinutes: item.duration_minutes,
    unitType: item.unit_type,
    minPeople: item.min_people,
    maxPeople: item.max_people,
    priceAdult: item.price_adult,
    priceChild: item.price_child,
    formFields: item.form_fields,
    isActive: item.is_active === 1,
    displayOrder: item.display_order,
    metadata: item.metadata,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function toScheduleResponse(item: ReservationSchedule): ReservationScheduleResponse {
  return {
    id: item.id,
    resourceId: item.resource_id,
    dayOfWeek: item.day_of_week,
    startTime: item.start_time,
    endTime: item.end_time,
    slotIntervalMinutes: item.slot_interval_minutes,
    defaultCapacity: item.default_capacity,
    defaultLineCapacity: item.default_line_capacity,
    defaultExternalCapacity: item.default_external_capacity,
    defaultBufferCapacity: item.default_buffer_capacity,
    isActive: item.is_active === 1,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function toSlotResponse(item: ReservationSlot): ReservationSlotResponse {
  return {
    id: item.id,
    resourceId: item.resource_id,
    date: item.date,
    startAt: item.start_at,
    endAt: item.end_at,
    totalCapacity: item.total_capacity,
    lineCapacity: item.line_capacity,
    externalCapacity: item.external_capacity,
    bufferCapacity: item.buffer_capacity,
    reservedCount: item.reserved_count,
    lineReservedCount: item.line_reserved_count,
    externalReservedCount: item.external_reserved_count,
    status: item.status,
    note: item.note,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function toSlotAvailabilityResponse(item: {
  slot_id: string;
  resource_id: string;
  date: string;
  start_at: string;
  end_at: string;
  remaining_capacity: number;
  line_remaining_capacity: number;
  external_remaining_capacity: number;
  available: boolean;
}): ReservationSlotAvailability {
  return {
    slotId: item.slot_id,
    resourceId: item.resource_id,
    date: item.date,
    startAt: item.start_at,
    endAt: item.end_at,
    remainingCapacity: item.remaining_capacity,
    lineRemainingCapacity: item.line_remaining_capacity,
    externalRemainingCapacity: item.external_remaining_capacity,
    available: item.available,
  };
}

export function toReservationResponse(item: Reservation): ReservationResponse {
  return {
    id: item.id,
    lineAccountId: item.line_account_id,
    userId: item.user_id,
    friendId: item.friend_id,
    slotId: item.slot_id,
    source: item.source,
    capacityChannel: item.capacity_channel,
    externalReservationId: item.external_reservation_id,
    dedupeKey: item.dedupe_key,
    title: item.title,
    reservationDate: item.reservation_date,
    startAt: item.start_at,
    endAt: item.end_at,
    status: item.status,
    adultCount: item.adult_count,
    childCount: item.child_count,
    totalPeople: item.total_people,
    customerName: item.customer_name_snapshot,
    customerPhone: item.customer_phone_snapshot,
    customerEmail: item.customer_email_snapshot,
    cancelReason: item.cancel_reason,
    formData: item.form_data,
    metadata: item.metadata,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}

export function toExternalReservationSourceResponse(item: ExternalReservationSourceRow): ExternalReservationSourceResponse {
  return {
    id: item.id,
    source: item.source,
    eventType: item.event_type,
    externalId: item.external_id,
    dedupeKey: item.dedupe_key,
    reservationId: item.reservation_id,
    rawText: item.raw_text,
    parsedPayload: item.parsed_payload,
    parseStatus: item.parse_status,
    receivedAt: item.received_at,
    lastError: item.last_error,
    createdAt: item.created_at,
    updatedAt: item.updated_at,
  };
}
