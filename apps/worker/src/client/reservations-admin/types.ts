import type {
  ExternalReservationSourceResponse,
  ReservationMenu,
  ReservationResource,
  ReservationResponse,
  ReservationSchedule,
  ReservationSlotWithAvailability,
} from '@line-crm/shared';

export type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

export type StatusUpdateResponse = {
  reservation: ReservationResponse;
  changed: boolean;
};

export type AdminMode = 'overview' | 'settings';
export type AdminViewMode = 'week' | 'month';

export type AdminState = {
  apiKey: string;
  mode: AdminMode;
  date: string;
  viewMode: AdminViewMode;
  weekStart: string;
  resourceId: string;
  resources: ReservationResource[];
  menus: ReservationMenu[];
  schedules: ReservationSchedule[];
  slots: ReservationSlotWithAvailability[];
  slotsByDate: Record<string, ReservationSlotWithAvailability[]>;
  reservations: ReservationResponse[];
  externalSources: ExternalReservationSourceResponse[];
  selectedReservation: ReservationResponse | null;
  selectedSlotId: string | null;
  bulkPreviewSlots: ReservationSlotWithAvailability[];
  loading: boolean;
  message: string | null;
  error: string | null;
};
