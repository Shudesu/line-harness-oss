import { startOfWeek } from './date.js';
import type { BookingState } from './types.js';

const params = new URLSearchParams(window.location.search);
const INITIAL_RESOURCE_ID = params.get('resourceId') || import.meta.env?.VITE_RESERVATION_RESOURCE_ID || '';
const INITIAL_MENU_ID = params.get('menuId') || import.meta.env?.VITE_RESERVATION_MENU_ID || '';
const today = new Date();

export const UUID_STORAGE_KEY = 'lh_uuid';

export const state: BookingState = {
  screen: 'booking',
  resourceId: INITIAL_RESOURCE_ID,
  menuId: INITIAL_MENU_ID,
  resources: [],
  menus: [],
  currentYear: today.getFullYear(),
  currentMonth: today.getMonth(),
  weekStart: startOfWeek(today),
  viewMode: 'week',
  selectedDate: null,
  selectedSlot: null,
  slotsByDate: {},
  availabilityByDate: {},
  profile: null,
  friendId: null,
  userId: null,
  sessionToken: null,
  sessionExpiresAt: null,
  form: {
    adultCount: 1,
    childCount: 0,
    infantCount: 0,
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
  availabilityRequestId: 0,
};

export function selectedMenu() {
  return state.menus.find((menu) => menu.id === state.menuId) ?? null;
}

export function selectedResource() {
  return state.resources.find((resource) => resource.id === state.resourceId) ?? null;
}

export function totalPeople(): number {
  return state.form.adultCount + state.form.childCount + state.form.infantCount;
}
