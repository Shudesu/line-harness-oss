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
  listAvailabilitySummary,
  listMyReservations,
  listMenus,
  listResources,
  listSlots,
} from './booking/api.js';
import { addDays, dateToString, isPastDate } from './booking/date.js';
import { getApp } from './booking/html.js';
import { renderError, renderHeader, renderScreen } from './booking/render.js';
import { selectedMenu, state, totalPeople, UUID_STORAGE_KEY } from './booking/state.js';
import { storeReservationTokens, storeTokensForReservation, tokenForReservation } from './booking/tokens.js';
import type { AvailabilitySummary, Slot } from './booking/types.js';

const SLOT_CACHE_TTL_MS = 30_000;
const slotCache = new Map<string, { slots: Slot[]; expiresAt: number }>();
const summaryCache = new Map<string, { summaries: Record<string, AvailabilitySummary>; expiresAt: number }>();

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

function currentLiffId(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('liffId') || import.meta.env?.VITE_LIFF_ID || null;
}

async function refreshReservationSession(): Promise<void> {
  const idToken = liff.getIDToken();
  if (!idToken) throw new Error('LINEログイン情報を取得できませんでした。もう一度開き直してください。');

  const session = await createReservationSession({
    idToken,
    displayName: state.profile?.displayName ?? state.form.customerName,
    liffId: currentLiffId(),
  });
  state.sessionToken = session.token;
  state.sessionExpiresAt = Date.now() + Math.max(60, (session.expiresIn ?? 3600) - 60) * 1000;
  state.friendId = session.friendId;
  state.userId = session.userId;
  try {
    localStorage.setItem(UUID_STORAGE_KEY, session.userId);
  } catch {
    // optional only
  }
}

async function ensureReservationSession(): Promise<string> {
  if (!state.sessionToken || !state.sessionExpiresAt || Date.now() >= state.sessionExpiresAt) {
    await refreshReservationSession();
  }
  if (!state.sessionToken) throw new Error('予約セッションを取得できませんでした。画面を開き直してください。');
  return state.sessionToken;
}

function eventElement(target: EventTarget | null): HTMLElement | null {
  if (target instanceof HTMLElement) return target;
  if (target instanceof Node && target.parentElement instanceof HTMLElement) {
    return target.parentElement;
  }
  return null;
}

function renderShell(): void {
  const app = getApp();
  if (!app.querySelector('[data-booking-shell]')) {
    app.innerHTML = `
      <div class="booking-page reservation-liff" data-booking-shell>
        ${renderHeader()}
        <div data-booking-content></div>
      </div>
    `;
    bindEvents();
    return;
  }

  const shell = app.querySelector<HTMLElement>('[data-booking-shell]');
  if (!shell) return;
  shell.innerHTML = `
    ${renderHeader()}
    <div data-booking-content></div>
  `;
}

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

  renderShell();
  const content = app.querySelector<HTMLElement>('[data-booking-content]');
  if (content) content.innerHTML = renderScreen();
}

function bindEvents(): void {
  const app = getApp();
  app.onclick = (event) => {
    const target = eventElement(event.target);
    if (!target) return;

    const actionEl = target.closest<HTMLElement>('[data-action]');
    if (actionEl && app.contains(actionEl)) {
      event.preventDefault();
      event.stopPropagation();
      void handleAction(actionEl.dataset.action ?? '', actionEl);
    }
  };

  app.oninput = (event) => {
    const element = eventElement(event.target);
    if (!(element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement)) return;
    const field = element.dataset.field;
    if (field) handleField(field, element.value);
  };

  app.onchange = (event) => {
    const element = eventElement(event.target);
    if (!(element instanceof HTMLSelectElement)) return;
    const field = element.dataset.field;
    if (field) handleField(field, element.value);
  };
}

function handleField(field: string, value: string): void {
  state.notice = null;
  if (state.validationErrors[field]) {
    const nextErrors = { ...state.validationErrors };
    delete nextErrors[field];
    state.validationErrors = nextErrors;
  }
  if (field === 'resourceId') {
    void changeResource(value);
    return;
  }
  if (field === 'menuId') {
    delete state.validationErrors.menuId;
    state.menuId = value;
    ensurePeopleWithinSelectedMenu();
    state.selectedDate = null;
    state.selectedSlot = null;
    state.slotsByDate = {};
    state.availabilityByDate = {};
    summaryCache.clear();
    void loadVisibleAvailability();
    render();
    return;
  }
  if (field === 'adultCount' || field === 'childCount' || field === 'infantCount') {
    delete state.validationErrors.people;
    const parsed = Math.max(0, Number.parseInt(value, 10) || 0);
    state.form[field] = parsed;
    state.selectedSlot = null;
    state.slotsByDate = {};
    state.availabilityByDate = {};
    void loadVisibleAvailability();
    render();
    return;
  }
  if (field === 'customerName' || field === 'customerPhone' || field === 'customerEmail' || field === 'note') {
    state.form[field] = value;
  }
}

async function handleAction(action: string, element: HTMLElement): Promise<void> {
  if (action === 'people-step') {
    const field = element.dataset.field;
    const delta = Number.parseInt(element.dataset.delta ?? '0', 10);
    if (field === 'adultCount' || field === 'childCount' || field === 'infantCount') {
      handleField(field, String(Math.max(0, state.form[field] + (Number.isFinite(delta) ? delta : 0))));
    }
    return;
  }
  if (action === 'select-date') {
    selectDate(element.dataset.date ?? '');
    return;
  }
  if (action === 'select-slot') {
    selectSlot(element.dataset.slotId ?? '');
    return;
  }
  if (action === 'select-reservation') {
    selectReservation(element.dataset.reservationId ?? '');
    return;
  }
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
    const errors = validateBooking();
    if (Object.keys(errors).length > 0) {
      state.validationErrors = errors;
      state.notice = '未入力の項目があります。赤い注釈を確認してください。';
      state.screen = 'booking';
      render();
      return;
    }
    state.validationErrors = {};
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
  if (action === 'issue-tokens') {
    await issueTokensForSelectedReservation();
    return;
  }
  if (action === 'go-cancel') {
    state.screen = 'cancel-confirm';
    render();
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
}

function validateBooking(): Record<string, string> {
  const menu = selectedMenu();
  const people = totalPeople();
  const errors: Record<string, string> = {};
  if (!menu) errors.menuId = 'メニューを選択してください。';
  if (!state.selectedDate || !state.selectedSlot) errors.slot = '予約する日付と時間枠を選択してください。';
  if (menu && people < menu.minPeople) errors.people = `人数は${menu.minPeople}名以上で入力してください。`;
  if (menu?.maxPeople && people > menu.maxPeople) errors.people = `人数は${menu.maxPeople}名以下で入力してください。`;
  if (!state.form.customerName.trim()) errors.customerName = '氏名を入力してください。';
  if (!state.form.customerPhone.trim()) {
    errors.customerPhone = '電話番号を入力してください。';
  } else if (!/^[0-9+\-\s()]{8,20}$/.test(state.form.customerPhone.trim())) {
    errors.customerPhone = '電話番号の形式を確認してください。';
  }
  return errors;
}

function selectDate(date: string): void {
  if (!date || isPastDate(date)) return;
  state.notice = null;
  delete state.validationErrors.slot;
  state.selectedDate = date;
  state.selectedSlot = null;
  render();
  void loadSlotsForSelectedDate();
}

function selectSlot(slotId: string): void {
  const slot = Object.values(state.slotsByDate).flat().find((item) => item.slotId === slotId);
  if (!slot || !slot.available) return;
  state.notice = null;
  delete state.validationErrors.slot;
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
  } else if (!state.resources.some((resource) => resource.id === state.resourceId)) {
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
  ensurePeopleWithinSelectedMenu();
}

function ensurePeopleWithinSelectedMenu(): void {
  const menu = selectedMenu();
  if (menu && totalPeople() < menu.minPeople) {
    state.form.adultCount = menu.minPeople;
    state.form.childCount = 0;
    state.form.infantCount = 0;
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
  state.availabilityByDate = {};
  slotCache.clear();
  summaryCache.clear();
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
  const cacheKey = [
    resourceId,
    menuId,
    date,
    state.form.adultCount,
    state.form.childCount,
    state.form.infantCount,
  ].join(':');
  const cached = slotCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    state.slotsByDate[date] = cached.slots;
    return cached.slots;
  }
  const slots = await listSlots({
    resourceId,
    menuId,
    date,
    people: totalPeople(),
    adultCount: state.form.adultCount,
    childCount: state.form.childCount,
    infantCount: state.form.infantCount,
  });
  if (state.resourceId === resourceId && state.menuId === menuId) {
    state.slotsByDate[date] = slots;
    slotCache.set(cacheKey, { slots, expiresAt: Date.now() + SLOT_CACHE_TTL_MS });
  }
  return slots;
}

function visibleDateRange(): { dateFrom: string; dateTo: string; dates: string[] } {
  if (state.viewMode === 'week') {
    const dates = Array.from({ length: 7 }, (_, index) => dateToString(addDays(state.weekStart, index)));
    return { dateFrom: dates[0], dateTo: dates[dates.length - 1], dates };
  }
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const dates = Array.from({ length: daysInMonth }, (_, index) => dateToString(new Date(state.currentYear, state.currentMonth, index + 1)));
  return { dateFrom: dates[0], dateTo: dates[dates.length - 1], dates };
}

async function loadVisibleAvailability(): Promise<void> {
  if (!state.resourceId || !state.menuId) return;
  const requestId = ++state.availabilityRequestId;
  state.loadingSlots = true;
  render();
  try {
    const { dateFrom, dateTo, dates } = visibleDateRange();
    if (state.selectedDate && !dates.includes(state.selectedDate)) {
      state.selectedDate = null;
      state.selectedSlot = null;
    }
    const cacheKey = [
      state.resourceId,
      state.menuId,
      dateFrom,
      dateTo,
      state.form.adultCount,
      state.form.childCount,
      state.form.infantCount,
    ].join(':');
    const cachedSummary = summaryCache.get(cacheKey);
    if (cachedSummary && cachedSummary.expiresAt > Date.now()) {
      state.availabilityByDate = cachedSummary.summaries;
    } else {
      const summary = await listAvailabilitySummary({
        resourceId: state.resourceId,
        menuId: state.menuId,
        dateFrom,
        dateTo,
        people: totalPeople(),
        adultCount: state.form.adultCount,
        childCount: state.form.childCount,
        infantCount: state.form.infantCount,
      });
      if (requestId === state.availabilityRequestId) {
        const summaries = Object.fromEntries(summary.map((item) => [item.date, item]));
        state.availabilityByDate = summaries;
        summaryCache.set(cacheKey, { summaries, expiresAt: Date.now() + SLOT_CACHE_TTL_MS });
      }
    }
    if (state.selectedSlot) {
      const updated = (state.slotsByDate[state.selectedSlot.date] ?? []).find((s) => s.slotId === state.selectedSlot!.slotId);
      if (!updated || !updated.available) {
        state.selectedSlot = null;
      }
    }
  } finally {
    if (requestId !== state.availabilityRequestId) return;
    state.loadingSlots = false;
    render();
  }
}

async function loadSlotsForSelectedDate(): Promise<void> {
  if (!state.selectedDate) return;
  const requestId = ++state.availabilityRequestId;
  state.loadingSlots = true;
  render();
  try {
    await fetchSlots(state.selectedDate);
  } finally {
    if (requestId !== state.availabilityRequestId) return;
    state.loadingSlots = false;
    render();
  }
}

async function submitBooking(): Promise<void> {
  const errors = validateBooking();
  if (Object.keys(errors).length > 0) {
    state.validationErrors = errors;
    state.notice = '未入力の項目があります。赤い注釈を確認してください。';
    state.screen = 'booking';
    render();
    return;
  }
  state.validationErrors = {};
  if (!state.selectedSlot || state.submitting) return;
  state.submitting = true;
  render();
  try {
    const sessionToken = await ensureReservationSession();
    const reservation = await createReservation({
      token: sessionToken,
      resourceId: state.resourceId,
      menuId: state.menuId,
      slotId: state.selectedSlot.slotId,
      adultCount: state.form.adultCount,
      childCount: state.form.childCount,
      infantCount: state.form.infantCount,
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
    state.availabilityByDate = {};
    slotCache.clear();
    summaryCache.clear();
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
  state.notice = null;
  state.selectedReservation = reservation;
  state.screen = reservation ? 'detail' : 'mine';
  render();
}

async function loadMine(): Promise<void> {
  state.notice = null;
  state.loadingSlots = true;
  render();
  try {
    state.reservations = await listMyReservations(await ensureReservationSession());
  } catch (err) {
    state.notice = err instanceof Error ? err.message : '予約一覧を取得できませんでした。';
  } finally {
    state.loadingSlots = false;
    render();
  }
}

async function issueTokensForSelectedReservation(): Promise<void> {
  const reservation = state.selectedReservation;
  if (!reservation || state.submitting) return;
  state.submitting = true;
  state.notice = null;
  render();
  try {
    const tokens = await issueReservationTokens({
      reservationId: reservation.id,
      token: await ensureReservationSession(),
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
  state.notice = null;
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

    try {
      state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
    } catch {
      // optional only
    }

    await refreshReservationSession();

    await loadResources();
    await loadMenusForSelectedResource();

    state.loading = false;
    render();
    if (state.screen === 'mine') {
      await loadMine();
    } else {
      await loadVisibleAvailability();
    }
  } catch (err) {
    state.loading = false;
    state.error = err instanceof Error ? err.message : '予約画面の初期化に失敗しました。';
    render();
  }
}
