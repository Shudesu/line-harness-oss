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
  id: 'aonisai',
  name: 'AONISAI FARM',
  displayName: 'アオニサイファーム ブルーベリー観光農園',
  shortName: 'アオニサイファーム',
  description: 'つくばの農園で、旬のブルーベリーとカフェを楽しめます。',
  address: '〒300-2645 茨城県つくば市上郷 2223-1',
  phone: '',
  siteUrl: 'https://aonisai-blueberry.com/',
  colors: {
    primary: '#272f72',
    accent: '#69a3d0',
    background: '#fbfaf6',
    text: '#1c2440',
  },
  assets: {
    logoUrl: '/aonisai/aonisai_blue.jpg',
    heroImageUrl: '/aonisai/cafe/cafe-hero.webp',
    faviconUrl: '',
  },
  reservation: {
    title: 'ブルーベリー体験予約',
    introTitle: 'つくばの農園で、旬のブルーベリーを楽しむ体験',
    introBody: '日付を選んで、空いている時間枠から予約できます。',
    lineLinkTitle: 'LINEで予約確認',
    lineLinkBody: 'LINEで連携すると、予約確認やキャンセルが簡単になります。',
    enableCafeTab: true,
    enableLineLinkPanel: true,
  },
  email: {
    fromName: 'アオニサイファーム予約',
    footerText: 'アオニサイファーム ブルーベリー観光農園',
    heroImageUrl: '/aonisai/cafe/cafe-hero.webp',
  },
  externalImport: {
    enabled: true,
    label: 'じゃらん / Gmail設定',
    provider: 'jalan',
    defaultFromEmail: 'reservation@activityboard.jp,reservation_cancel@activityboard.jp',
    defaultQuery: '{from:reservation@activityboard.jp from:reservation_cancel@activityboard.jp} newer_than:30d',
    defaultLabels: {
      unprocessed: 'じゃらん予約/未処理',
      processed: 'じゃらん予約/処理済み',
      review: 'じゃらん予約/要確認',
      failed: 'じゃらん予約/失敗',
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
