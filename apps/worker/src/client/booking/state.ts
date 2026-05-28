import { startOfWeek } from './date.js';
import type { BookingState, ProviderConfig } from './types.js';

const params = new URLSearchParams(window.location.search);
const INITIAL_RESOURCE_ID = params.get('resourceId') || import.meta.env?.VITE_RESERVATION_RESOURCE_ID || '';
const INITIAL_MENU_ID = params.get('menuId') || import.meta.env?.VITE_RESERVATION_MENU_ID || '';
const screenParam = params.get('screen');
const INITIAL_SCREEN = screenParam === 'mine' || params.get('mode') === 'mine'
  ? 'mine'
  : screenParam === 'detail'
    ? 'detail'
    : screenParam === 'cancel'
      ? 'cancel-confirm'
      : screenParam === 'claim'
        ? 'claim'
        : 'booking';
const ENTRY_MODE = params.get('mode') === 'web' || Boolean(params.get('channel')) ? 'web' : 'line';
const today = new Date();
const initialCalendarMonth = today.getMonth() < 5 ? new Date(today.getFullYear(), 5, 1) : today;

export const UUID_STORAGE_KEY = 'lh_uuid';

export const defaultProviderConfig: ProviderConfig = {
  id: 'generic',
  name: 'Generic Reservation Provider',
  displayName: '予約サービス',
  shortName: '予約',
  description: '日付と時間を選んで予約できます。',
  address: '',
  phone: '',
  siteUrl: '',
  colors: {
    primary: '#1f4f7a',
    accent: '#69a3d0',
    background: '#f7fafc',
    text: '#172033',
  },
  assets: {
    logoUrl: '',
    heroImageUrl: '',
    faviconUrl: '',
  },
  reservation: {
    title: '予約',
    introTitle: '日付を選んで予約する',
    introBody: '空いている日付と時間枠を選んで、必要事項を入力してください。',
    lineLinkTitle: 'LINEで予約確認',
    lineLinkBody: 'LINE連携をすると、予約確認やキャンセルが簡単になります。',
    enableCafeTab: false,
    enableLineLinkPanel: true,
  },
  email: {
    fromName: '予約受付',
    footerText: 'このメールは予約受付システムから自動送信されています。',
    heroImageUrl: '',
  },
  externalImport: {
    enabled: false,
    label: '外部予約メール取り込み',
    provider: 'none',
    defaultFromEmail: '',
    defaultQuery: '',
    defaultLabels: {
      unprocessed: '外部予約/未処理',
      processed: '外部予約/処理済み',
      review: '外部予約/要確認',
      failed: '外部予約/失敗',
    },
  },
};

export const state: BookingState = {
  provider: defaultProviderConfig,
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
  urlDetailToken: INITIAL_SCREEN === 'detail' ? params.get('token') : null,
  urlCancelToken: INITIAL_SCREEN === 'cancel-confirm' ? params.get('token') : null,
  claimToken: params.get('claimToken') || null,
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
