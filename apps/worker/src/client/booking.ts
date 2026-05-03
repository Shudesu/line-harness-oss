/**
 * LIFF reservation page.
 *
 * Public APIs never trust lineUserId from query params. This screen first
 * exchanges the LIFF ID token for a short-lived reservation session token.
 */

import {
  cancelReservation,
  createReservation,
  createReservationSession,
  issueReservationTokens,
  listMenus,
  listMyReservations,
  listResources,
  listSlots,
} from './booking/api.js';
import { addDays, dateToString, isPastDate } from './booking/date.js';
import { getApp } from './booking/html.js';
import { renderError, renderHeader, renderScreen } from './booking/render.js';
import { selectedMenu, state, totalPeople, UUID_STORAGE_KEY } from './booking/state.js';
import { storeReservationTokens, storeTokensForReservation, tokenForReservation } from './booking/tokens.js';
import type { Menu, Reservation, Resource, Slot } from './booking/types.js';

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

function render(): void {
  const app = getApp();
  if (state.loading) {
    app.innerHTML = `
      <div class="booking-page">
        <div class="card">
          <div class="loading-spinner"></div>
          <p class="message">予約画面を準備しています...</p>
        </div>
      </div>
    `;
    return;
  }

  if (state.error) {
    app.innerHTML = renderError(state.error);
    bindEvents();
    return;
  }

  app.innerHTML = `
    <div class="booking-page reservation-liff">
      ${renderHeader()}
      ${renderScreen()}
    </div>
  `;
  bindEvents();
}

function bindEvents(): void {
  const app = getApp();
  app.onclick = null;
  app.oninput = null;
  app.onchange = null;

  app.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      void handleAction(element.dataset.action ?? '', element);
    });
  });
  app.querySelectorAll<HTMLElement>('[data-date]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectDate(element.dataset.date ?? '');
    });
  });
  app.querySelectorAll<HTMLElement>('[data-slot-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectSlot(element.dataset.slotId ?? '');
    });
  });
  app.querySelectorAll<HTMLElement>('[data-reservation-id]').forEach((element) => {
    element.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      selectReservation(element.dataset.reservationId ?? '');
    });
  });
  app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>('[data-field]').forEach((element) => {
    if (element instanceof HTMLSelectElement) return;
    element.addEventListener('input', () => handleField(element.dataset.field ?? '', element.value));
  });
  app.querySelectorAll<HTMLSelectElement>('select[data-field]').forEach((element) => {
    element.addEventListener('change', () => handleField(element.dataset.field ?? '', element.value));
  });
}

function handleField(field: string, value: string): void {
  state.notice = null;
  if (field === 'resourceId') {
    void changeResource(value);
    return;
  }
  if (field === 'menuId') {
    state.menuId = value;
    state.selectedSlot = null;
    state.slotsByDate = {};
    void loadVisibleAvailability();
    render();
    return;
  }
  if (field === 'adultCount' || field === 'childCount') {
    const parsed = Math.max(0, Number.parseInt(value, 10) || 0);
    state.form[field] = parsed;
    state.selectedSlot = null;
    state.slotsByDate = {};
    void loadVisibleAvailability();
    render();
    return;
  }
  if (field === 'customerName' || field === 'customerPhone' || field === 'customerEmail' || field === 'note') {
    state.form[field] = value;
  }
}

async function handleAction(action: string, element: HTMLElement): Promise<void> {
  if (action === 'show-booking' || action === 'back-booking') {
    state.screen = 'booking';
    state.error = null;
    state.notice = null;
    render();
    return;
  }
  if (action === 'show-mine' || action === 'reload-mine') {
    state.screen = 'mine';
    await loadMine();
    return;
  }
  if (action === 'view-week' || action === 'view-month') {
    state.viewMode = action === 'view-week' ? 'week' : 'month';
    state.notice = null;
    state.selectedDate = null;
    state.selectedSlot = null;
    await loadVisibleAvailability();
    return;
  }
  if (action === 'prev-week' || action === 'next-week') {
    state.weekStart = addDays(state.weekStart, action === 'next-week' ? 7 : -7);
    await loadVisibleAvailability();
    return;
  }
  if (action === 'prev-month' || action === 'next-month') {
    state.currentMonth += action === 'next-month' ? 1 : -1;
    if (state.currentMonth > 11) {
      state.currentMonth = 0;
      state.currentYear++;
    }
    if (state.currentMonth < 0) {
      state.currentMonth = 11;
      state.currentYear--;
    }
    await loadVisibleAvailability();
    return;
  }
  if (action === 'go-confirm') {
    const error = validateBooking();
    if (error) {
      state.notice = error;
      state.screen = 'booking';
      render();
      return;
    }
    state.notice = null;
    state.screen = 'confirm';
    render();
    return;
  }
  if (action === 'submit-booking') {
    await submitBooking();
    return;
  }
  if (action === 'show-created-detail') {
    if (state.lastReservation) {
      state.selectedReservation = state.lastReservation;
      state.screen = 'detail';
      render();
    }
    return;
  }
  if (action === 'go-cancel') {
    state.screen = 'cancel-confirm';
    render();
    return;
  }
  if (action === 'issue-tokens') {
    await issueTokensForSelectedReservation();
    return;
  }
  if (action === 'back-detail') {
    state.screen = 'detail';
    render();
    return;
  }
  if (action === 'submit-cancel') {
    await submitCancel();
    return;
  }
  if (action === 'close') {
    if (liff.isInClient()) liff.closeWindow();
    else window.close();
    return;
  }
  if (element.dataset.date) selectDate(element.dataset.date);
}

function validateBooking(): string | null {
  const menu = selectedMenu();
  const people = totalPeople();
  if (!menu) return 'メニューを選択してください。';
  if (!state.selectedDate || !state.selectedSlot) return '日付と時間を選択してください。';
  if (people < menu.minPeople) return `人数は${menu.minPeople}名以上で入力してください。`;
  if (menu.maxPeople && people > menu.maxPeople) return `人数は${menu.maxPeople}名以下で入力してください。`;
  if (!state.form.customerName.trim()) return '氏名を入力してください。';
  if (!state.form.customerPhone.trim()) return '電話番号を入力してください。';
  if (!/^[0-9+\-\s()]{8,20}$/.test(state.form.customerPhone.trim())) return '電話番号の形式を確認してください。';
  return null;
}

function selectDate(date: string): void {
  if (!date || isPastDate(date)) return;
  state.notice = null;
  state.selectedDate = date;
  state.selectedSlot = null;
  if (!state.slotsByDate[date]) void fetchSlots(date).catch((err) => {
    state.notice = err instanceof Error ? err.message : '予約枠を取得できませんでした。';
    render();
  });
  render();
}

function selectSlot(slotId: string): void {
  const slot = Object.values(state.slotsByDate).flat().find((item) => item.slotId === slotId);
  if (!slot || !slot.available) return;
  state.notice = null;
  state.selectedDate = slot.date;
  state.selectedSlot = slot;
  render();
}

async function loadResources(): Promise<void> {
  try {
    state.resources = await listResources();
  } catch {
    if (state.resourceId) {
      state.resources = [{ id: state.resourceId, name: state.resourceId, isActive: true }];
      state.notice = '予約対象一覧を取得できないため、URLで指定された予約対象を使います。';
      return;
    }
    throw new Error('予約対象を取得できません。LIFF URLに resourceId を指定してください。');
  }
  if (!state.resourceId) {
    state.resourceId = state.resources[0].id;
    return;
  }
  if (!state.resources.some((resource) => resource.id === state.resourceId)) {
    state.resources = [{ id: state.resourceId, name: state.resourceId, isActive: true }, ...state.resources];
    state.notice = 'URLで指定された予約対象を使います。';
  }
}

async function loadMenusForSelectedResource(): Promise<void> {
  if (!state.resourceId) return;
  state.menus = await listMenus(state.resourceId);
  if (!state.menus.length) {
    throw new Error('この予約対象には有効なメニューがありません。店舗側でメニューを有効化してください。');
  }
  if (!state.menuId || !state.menus.some((menu) => menu.id === state.menuId)) {
    state.menuId = state.menus[0].id;
  }
  const menu = selectedMenu();
  if (menu && totalPeople() < menu.minPeople) {
    state.form.adultCount = menu.minPeople;
    state.form.childCount = 0;
  }
}

async function changeResource(resourceId: string): Promise<void> {
  if (!resourceId || resourceId === state.resourceId) return;
  state.resourceId = resourceId;
  state.menuId = '';
  state.menus = [];
  state.selectedDate = null;
  state.selectedSlot = null;
  state.slotsByDate = {};
  state.loadingSlots = true;
  render();
  try {
    await loadMenusForSelectedResource();
    await loadVisibleAvailability();
  } catch (err) {
    state.error = err instanceof Error ? err.message : '予約対象の切り替えに失敗しました。';
    render();
  } finally {
    state.loadingSlots = false;
  }
}

async function fetchSlots(date: string): Promise<Slot[]> {
  if (!state.resourceId || !state.menuId) return [];
  const resourceId = state.resourceId;
  const menuId = state.menuId;
  const slots = await listSlots({ resourceId, menuId, date, people: totalPeople() });
  if (state.resourceId === resourceId && state.menuId === menuId) {
    state.slotsByDate[date] = slots;
  }
  return slots;
}

async function loadVisibleAvailability(): Promise<void> {
  if (!state.resourceId || !state.menuId) return;
  const requestId = ++state.availabilityRequestId;
  state.loadingSlots = true;
  render();
  try {
    const dates = state.viewMode === 'week'
      ? Array.from({ length: 7 }, (_, index) => dateToString(addDays(state.weekStart, index)))
      : Array.from({ length: new Date(state.currentYear, state.currentMonth + 1, 0).getDate() }, (_, index) => dateToString(new Date(state.currentYear, state.currentMonth, index + 1)));
    if (state.selectedDate && !dates.includes(state.selectedDate)) {
      state.selectedDate = null;
      state.selectedSlot = null;
    }
    await Promise.all(dates.filter((date) => !isPastDate(date)).map((date) => fetchSlots(date).catch(() => [])));
  } finally {
    if (requestId !== state.availabilityRequestId) return;
    state.loadingSlots = false;
    render();
  }
}

async function submitBooking(): Promise<void> {
  const error = validateBooking();
  if (error) {
    state.notice = error;
    state.screen = 'booking';
    render();
    return;
  }
  if (!state.selectedSlot || !state.sessionToken || state.submitting) return;
  state.submitting = true;
  render();
  try {
    const reservation = await createReservation({
      token: state.sessionToken,
      resourceId: state.resourceId,
      menuId: state.menuId,
      slotId: state.selectedSlot.slotId,
      adultCount: state.form.adultCount,
      childCount: state.form.childCount,
      customer: {
        name: state.form.customerName.trim(),
        phone: state.form.customerPhone.trim(),
        email: state.form.customerEmail.trim() || null,
      },
      formData: {
        note: state.form.note.trim() || null,
      },
    });
    storeReservationTokens(reservation);
    state.lastReservation = reservation;
    state.selectedReservation = reservation;
    state.screen = 'success';
    state.slotsByDate = {};
    await loadVisibleAvailability();
  } catch (err) {
    state.submitting = false;
    state.screen = 'booking';
    state.notice = err instanceof Error ? err.message : '予約に失敗しました。';
    if (state.selectedDate) {
      await fetchSlots(state.selectedDate).catch(() => []);
    }
    render();
    return;
  }
  state.submitting = false;
  render();
}

function selectReservation(id: string): void {
  const reservation = state.reservations.find((item) => item.id === id) ?? null;
  state.selectedReservation = reservation;
  state.screen = reservation ? 'detail' : 'mine';
  render();
}

async function loadMine(): Promise<void> {
  if (!state.sessionToken) return;
  state.loadingSlots = true;
  render();
  try {
    state.reservations = await listMyReservations(state.sessionToken);
  } catch (err) {
    state.notice = err instanceof Error ? err.message : '予約一覧を取得できませんでした。';
  } finally {
    state.loadingSlots = false;
    render();
  }
}

async function issueTokensForSelectedReservation(): Promise<void> {
  const reservation = state.selectedReservation;
  if (!reservation || !state.sessionToken || state.submitting) return;
  state.submitting = true;
  render();
  try {
    const tokens = await issueReservationTokens({
      reservationId: reservation.id,
      token: state.sessionToken,
    });
    storeTokensForReservation(tokens.reservationId, {
      detailToken: tokens.detailToken,
      cancelToken: tokens.cancelToken,
    });
    state.screen = tokens.cancelToken ? 'cancel-confirm' : 'detail';
  } catch (err) {
    state.notice = err instanceof Error ? err.message : 'キャンセル用の確認情報を取得できませんでした。';
    state.screen = 'detail';
  } finally {
    state.submitting = false;
    render();
  }
}

async function submitCancel(): Promise<void> {
  const reservation = state.selectedReservation;
  if (!reservation || state.submitting) return;
  const cancelToken = tokenForReservation(reservation.id).cancelToken || reservation.cancelToken;
  if (!cancelToken) {
    await issueTokensForSelectedReservation();
    return;
  }

  state.submitting = true;
  render();
  try {
    const result = await cancelReservation({
      reservationId: reservation.id,
      cancelToken,
    });
    state.selectedReservation = result.reservation;
    state.lastReservation = result.reservation;
    state.reservations = state.reservations.map((item) => item.id === result.reservation.id ? result.reservation : item);
    state.screen = 'cancelled';
  } catch (err) {
    state.notice = err instanceof Error ? err.message : 'キャンセルに失敗しました。';
    state.screen = 'detail';
  } finally {
    state.submitting = false;
    render();
  }
}

export async function initBooking(): Promise<void> {
  try {
    const profile = await liff.getProfile();
    state.profile = profile;
    state.form.customerName = profile.displayName;

    try {
      state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
    } catch {
      // optional only
    }

    const idToken = liff.getIDToken();
    if (!idToken) throw new Error('LINEログイン情報を取得できませんでした。もう一度開き直してください。');

    const session = await createReservationSession({ idToken, displayName: profile.displayName });
    state.sessionToken = session.token;
    state.friendId = session.friendId;
    state.userId = session.userId;
    try {
      localStorage.setItem(UUID_STORAGE_KEY, session.userId);
    } catch {
      // optional only
    }

    await loadResources();
    await loadMenusForSelectedResource();

    state.loading = false;
    render();
    await loadVisibleAvailability();
  } catch (err) {
    state.loading = false;
    state.error = err instanceof Error ? err.message : '予約画面の初期化に失敗しました。';
    render();
  }
}
