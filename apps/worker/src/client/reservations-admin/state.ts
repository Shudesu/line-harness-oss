import { startOfWeekYmd, todayJst } from './date.js';
import type { AdminMode, AdminState } from './types.js';

const API_KEY_STORAGE_KEY = 'lh_reservation_admin_api_key';

function readSessionApiKey(): string {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function saveSessionApiKey(value: string): void {
  try {
    if (value) {
      sessionStorage.setItem(API_KEY_STORAGE_KEY, value);
    } else {
      sessionStorage.removeItem(API_KEY_STORAGE_KEY);
    }
  } catch {
    // sessionStorage may be unavailable in strict browser modes.
  }
}

function readAdminMode(): AdminMode {
  const params = new URLSearchParams(window.location.search);
  return params.get('mode') === 'settings' ? 'settings' : 'overview';
}

export const state: AdminState = {
  apiKey: readSessionApiKey(),
  mode: readAdminMode(),
  date: todayJst(),
  viewMode: 'week',
  weekStart: startOfWeekYmd(todayJst()),
  resourceId: '',
  resources: [],
  menus: [],
  schedules: [],
  slots: [],
  slotsByDate: {},
  reservations: [],
  externalSources: [],
  selectedReservation: null,
  selectedSlotId: null,
  bulkPreviewSlots: [],
  loading: false,
  message: null,
  error: null,
};

export function setAdminMode(mode: AdminMode): void {
  state.mode = mode;
  const url = new URL(window.location.href);
  url.searchParams.set('page', 'admin-reservations');
  if (mode === 'settings') {
    url.searchParams.set('mode', 'settings');
  } else {
    url.searchParams.delete('mode');
  }
  window.history.replaceState(null, '', url.toString());
}

export function syncApiKeyFromInput(): void {
  const element = document.getElementById('adminApiKey');
  if (!(element instanceof HTMLInputElement)) return;

  const value = element.value.trim();
  if (value === state.apiKey) return;

  state.apiKey = value;
  saveSessionApiKey(value);
}
