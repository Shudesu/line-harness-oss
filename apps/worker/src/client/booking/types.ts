export type Screen = 'booking' | 'cafe' | 'confirm' | 'success' | 'mine' | 'detail' | 'cancel-confirm' | 'cancelled';
export type ViewMode = 'week' | 'month';

export interface Slot {
  slotId: string;
  resourceId: string;
  date: string;
  startAt: string;
  endAt: string;
  lineCapacity?: number | null;
  remainingCapacity: number;
  lineRemainingCapacity: number;
  externalRemainingCapacity: number;
  available: boolean;
}

export interface AvailabilitySummary {
  date: string;
  available: boolean;
  slotCount: number;
  availableSlotCount: number;
}

export interface Resource {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
}

export interface Menu {
  id: string;
  resourceId: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  minPeople: number;
  maxPeople?: number | null;
  priceAdult?: number | null;
  priceChild?: number | null;
  priceInfant?: number | null;
  priceUnderThree?: number | null;
  capacityCountAdult?: boolean;
  capacityCountChild?: boolean;
  capacityCountInfant?: boolean;
  capacityCountUnderThree?: boolean;
}

export interface Reservation {
  id: string;
  slotId: string;
  title: string;
  reservationDate: string;
  startAt: string;
  endAt: string;
  status: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  underThreeCount: number;
  totalPeople: number;
  capacityPeople: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  cancelReason?: string | null;
  formData?: string | null;
  createdAt: string;
  detailToken?: string;
  cancelToken?: string;
}

export interface StoredTokens {
  detailToken?: string;
  cancelToken?: string;
}

export interface ReservationAccessTokens {
  reservationId: string;
  detailToken: string;
  cancelToken?: string;
  expiresIn: number;
}

export interface BookingForm {
  adultCount: number;
  childCount: number;
  infantCount: number;
  underThreeCount: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
}

export interface BookingState {
  entryMode: 'line' | 'web';
  entryChannel: string;
  entryRef: string | null;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  screen: Screen;
  resourceId: string;
  menuId: string;
  resources: Resource[];
  menus: Menu[];
  currentYear: number;
  currentMonth: number;
  weekStart: Date;
  viewMode: ViewMode;
  selectedDate: string | null;
  slotModalOpen: boolean;
  selectedSlot: Slot | null;
  slotsByDate: Record<string, Slot[]>;
  availabilityByDate: Record<string, AvailabilitySummary>;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  userId: string | null;
  sessionToken: string | null;
  sessionExpiresAt: number | null;
  lookupReservationId: string;
  lookupEmail: string;
  form: BookingForm;
  reservations: Reservation[];
  selectedReservation: Reservation | null;
  lastReservation: Reservation | null;
  loading: boolean;
  loadingSlots: boolean;
  submitting: boolean;
  error: string | null;
  notice: string | null;
  validationErrors: Record<string, string>;
  availabilityRequestId: number;
}
