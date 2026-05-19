import { startOfWeek } from './date.js';
import type { BookingState } from './types.js';

const params = new URLSearchParams(window.location.search);
const INITIAL_RESOURCE_ID = params.get('resourceId') || import.meta.env?.VITE_RESERVATION_RESOURCE_ID || '';
const INITIAL_MENU_ID = params.get('menuId') || import.meta.env?.VITE_RESERVATION_MENU_ID || '';
const INITIAL_SCREEN = params.get('screen') === 'mine' || params.get('mode') === 'mine' ? 'mine' : 'booking';
const ENTRY_MODE = params.get('mode') === 'web' || Boolean(params.get('channel')) ? 'web' : 'line';
const today = new Date();
const initialCalendarMonth = today.getMonth() < 5 ? new Date(today.getFullYear(), 5, 1) : today;

export const UUID_STORAGE_KEY = 'lh_uuid';

export const state: BookingState = {
  entryMode: ENTRY_MODE,
  entryChannel: params.get('channel') || (ENTRY_MODE === 'web' ? 'web' : 'line'),
  entryRef: params.get('ref'),
  utmSource: params.get('utm_source'),
  utmMedium: params.get('utm_medium'),
  utmCampaign: params.get('utm_campaign'),
  screen: INITIAL_SCREEN,
  resourceId: INITIAL_RESOURCE_ID,
  menuId: INITIAL_MENU_ID,
  resources: [],
  menus: [],
  currentYear: initialCalendarMonth.getFullYear(),
  currentMonth: initialCalendarMonth.getMonth(),
  weekStart: startOfWeek(today),
  viewMode: 'month',
  selectedDate: null,
  slotModalOpen: false,
  selectedCafeMenu: null,
  selectedSlot: null,
  slotsByDate: {},
  availabilityByDate: {},
  profile: null,
  friendId: null,
  userId: null,
  sessionToken: null,
  sessionExpiresAt: null,
  lookupReservationId: params.get('reservationId') || '',
  lookupEmail: params.get('email') || '',
  form: {
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
    underThreeCount: 0,
    customerName: '',
    customerPhone: '',
    customerEmail: '',
    note: '',
  },
  reservations: [],
  selectedReservation: null,
  lastReservation: null,
  loading: true,
  loadingSlots: false,
  submitting: false,
  error: null,
  notice: null,
  validationErrors: {},
  availabilityRequestId: 0,
};

export function selectedMenu() {
  return state.menus.find((menu) => menu.id === state.menuId) ?? null;
}

export function selectedResource() {
  return state.resources.find((resource) => resource.id === state.resourceId) ?? null;
}

export function totalPeople(): number {
  return state.form.adultCount + state.form.childCount + state.form.infantCount + state.form.underThreeCount;
}

export function capacityPeople(): number {
  const menu = selectedMenu();
  const countAdult = menu?.capacityCountAdult ?? true;
  const countChild = menu?.capacityCountChild ?? true;
  const countInfant = menu?.capacityCountInfant ?? true;
  const countUnderThree = menu?.capacityCountUnderThree ?? false;
  return (
    (countAdult ? state.form.adultCount : 0) +
    (countChild ? state.form.childCount : 0) +
    (countInfant ? state.form.infantCount : 0) +
    (countUnderThree ? state.form.underThreeCount : 0)
  );
}
