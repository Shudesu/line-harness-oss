/**
 * LIFF Booking Page — Calendar-based slot booking
 *
 * Flow:
 * 1. Show calendar date picker (current month)
 * 2. Tap date → fetch available slots from API
 * 3. Tap slot → show confirm section
 * 4. Submit booking → show confirmation
 */

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  getDecodedIDToken(): { sub: string; name?: string; email?: string; picture?: string } | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const params = new URLSearchParams(window.location.search);
const RESOURCE_ID = params.get('resourceId') || import.meta.env?.VITE_RESERVATION_RESOURCE_ID || '';
const MENU_ID = params.get('menuId') || import.meta.env?.VITE_RESERVATION_MENU_ID || '';

interface Slot {
  slotId: string;
  startAt: string;
  endAt: string;
  available: boolean;
  lineRemainingCapacity?: number;
}

interface BookingState {
  currentYear: number;
  currentMonth: number; // 0-indexed
  selectedDate: string | null;
  slots: Slot[];
  selectedSlot: Slot | null;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  userId: string | null;
  sessionToken: string | null;
  loading: boolean;
  submitting: boolean;
}

const state: BookingState = {
  currentYear: new Date().getFullYear(),
  currentMonth: new Date().getMonth(),
  selectedDate: null,
  slots: [],
  selectedSlot: null,
  profile: null,
  friendId: null,
  userId: null,
  sessionToken: null,
  loading: false,
  submitting: false,
};

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateJa(dateStr: string): string {
  const d = new Date(dateStr + 'T00:00:00');
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

// ========== Calendar Rendering ==========

function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

function getFirstDayOfWeek(year: number, month: number): number {
  return new Date(year, month, 1).getDay();
}

function isToday(year: number, month: number, day: number): boolean {
  const now = new Date();
  return now.getFullYear() === year && now.getMonth() === month && now.getDate() === day;
}

function isPast(year: number, month: number, day: number): boolean {
  const now = new Date();
  const target = new Date(year, month, day);
  now.setHours(0, 0, 0, 0);
  return target < now;
}

function dateToString(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function renderCalendar(): string {
  const { currentYear, currentMonth, selectedDate } = state;
  const daysInMonth = getDaysInMonth(currentYear, currentMonth);
  const firstDay = getFirstDayOfWeek(currentYear, currentMonth);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];

  let html = `
    <div class="booking-calendar">
      <div class="calendar-header">
        <button class="cal-nav" data-action="prev-month">&lt;</button>
        <span class="cal-title">${currentYear}年${currentMonth + 1}月</span>
        <button class="cal-nav" data-action="next-month">&gt;</button>
      </div>
      <div class="cal-weekdays">
        ${weekdays.map((d, i) => `<span class="${i === 0 ? 'sun' : i === 6 ? 'sat' : ''}">${d}</span>`).join('')}
      </div>
      <div class="cal-days">
  `;

  // Empty cells before first day
  for (let i = 0; i < firstDay; i++) {
    html += '<span class="cal-day empty"></span>';
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const dateStr = dateToString(currentYear, currentMonth, day);
    const past = isPast(currentYear, currentMonth, day);
    const today = isToday(currentYear, currentMonth, day);
    const selected = selectedDate === dateStr;
    const classes = [
      'cal-day',
      past ? 'past' : 'active',
      today ? 'today' : '',
      selected ? 'selected' : '',
      new Date(currentYear, currentMonth, day).getDay() === 0 ? 'sun' : '',
      new Date(currentYear, currentMonth, day).getDay() === 6 ? 'sat' : '',
    ].filter(Boolean).join(' ');

    html += `<span class="${classes}" ${past ? '' : `data-date="${dateStr}"`}>${day}</span>`;
  }

  html += '</div></div>';
  return html;
}

// ========== Slots Rendering ==========

function renderSlots(): string {
  const { slots, selectedDate, selectedSlot, loading } = state;

  if (!selectedDate) return '';

  if (loading) {
    return `
      <div class="slots-section">
        <h3>${formatDateJa(selectedDate)}</h3>
        <div class="slots-loading">
          <div class="loading-spinner"></div>
          <p>空き状況を確認中...</p>
        </div>
      </div>
    `;
  }

  if (slots.length === 0) {
    return `
      <div class="slots-section">
        <h3>${formatDateJa(selectedDate)}</h3>
        <p class="no-slots">この日は予約枠がありません</p>
      </div>
    `;
  }

  const slotButtons = slots.map((slot) => {
    const isSelected = selectedSlot?.startAt === slot.startAt;
    const cls = slot.available
      ? (isSelected ? 'slot-btn selected' : 'slot-btn available')
      : 'slot-btn full';
    return `<button class="${cls}" ${slot.available ? `data-slot-id="${slot.slotId}" data-start="${slot.startAt}" data-end="${slot.endAt}"` : 'disabled'}>${formatTime(slot.startAt)} - ${formatTime(slot.endAt)}</button>`;
  }).join('');

  return `
    <div class="slots-section">
      <h3>${formatDateJa(selectedDate)}</h3>
      <div class="slots-grid">${slotButtons}</div>
    </div>
  `;
}

// ========== Confirm Section ==========

function renderConfirm(): string {
  const { selectedSlot, selectedDate, profile } = state;
  if (!selectedSlot || !selectedDate) return '';

  return `
    <div class="confirm-section">
      <div class="confirm-card">
        <h3>予約内容の確認</h3>
        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">日付</span>
            <span class="confirm-value">${formatDateJa(selectedDate)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">時間</span>
            <span class="confirm-value">${formatTime(selectedSlot.startAt)} - ${formatTime(selectedSlot.endAt)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">お名前</span>
            <span class="confirm-value">${profile ? escapeHtml(profile.displayName) : '---'}</span>
          </div>
        </div>
        <button class="book-btn" data-action="confirm-booking">予約を確定する</button>
      </div>
    </div>
  `;
}

// ========== Main Render ==========

function render(): void {
  const app = getApp();
  app.innerHTML = `
    <div class="booking-page">
      <div class="booking-header">
        <h1>予約</h1>
        <p>ご希望の日時をお選びください</p>
      </div>
      ${renderCalendar()}
      ${renderSlots()}
      ${renderConfirm()}
    </div>
  `;
  attachEvents();
}

function renderSuccess(date: string, slot: Slot): void {
  const app = getApp();
  app.innerHTML = `
    <div class="booking-page">
      <div class="success-card">
        <div class="success-icon">✓</div>
        <h2>予約が完了しました</h2>
        <div class="confirm-details">
          <div class="confirm-row">
            <span class="confirm-label">日付</span>
            <span class="confirm-value">${formatDateJa(date)}</span>
          </div>
          <div class="confirm-row">
            <span class="confirm-label">時間</span>
            <span class="confirm-value">${formatTime(slot.startAt)} - ${formatTime(slot.endAt)}</span>
          </div>
        </div>
        <p class="success-message">ご予約ありがとうございます。<br>当日のお越しをお待ちしております。</p>
        <button class="close-btn" data-action="close">閉じる</button>
      </div>
    </div>
  `;

  const closeBtn = app.querySelector('[data-action="close"]');
  closeBtn?.addEventListener('click', () => {
    if (liff.isInClient()) {
      liff.closeWindow();
    } else {
      window.close();
    }
  });
}

function renderError(message: string): void {
  const app = getApp();
  app.innerHTML = `
    <div class="booking-page">
      <div class="card">
        <h2 style="color: #e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
        <button class="close-btn" data-action="retry" style="margin-top:16px;">やり直す</button>
      </div>
    </div>
  `;
  app.querySelector('[data-action="retry"]')?.addEventListener('click', () => {
    state.selectedDate = null;
    state.selectedSlot = null;
    state.slots = [];
    render();
  });
}

// ========== Event Handlers ==========

function attachEvents(): void {
  const app = getApp();

  // Month navigation
  app.querySelectorAll('.cal-nav').forEach((btn) => {
    btn.addEventListener('click', () => {
      const action = (btn as HTMLElement).dataset.action;
      if (action === 'prev-month') {
        state.currentMonth--;
        if (state.currentMonth < 0) {
          state.currentMonth = 11;
          state.currentYear--;
        }
      } else {
        state.currentMonth++;
        if (state.currentMonth > 11) {
          state.currentMonth = 0;
          state.currentYear++;
        }
      }
      state.selectedDate = null;
      state.selectedSlot = null;
      state.slots = [];
      render();
    });
  });

  // Date selection
  app.querySelectorAll('.cal-day.active').forEach((el) => {
    el.addEventListener('click', () => {
      const date = (el as HTMLElement).dataset.date;
      if (date) {
        state.selectedDate = date;
        state.selectedSlot = null;
        state.slots = [];
        state.loading = true;
        render();
        fetchSlots(date);
      }
    });
  });

  // Slot selection
  app.querySelectorAll('.slot-btn.available').forEach((btn) => {
    btn.addEventListener('click', () => {
      const startAt = (btn as HTMLElement).dataset.start!;
      const endAt = (btn as HTMLElement).dataset.end!;
      const slotId = (btn as HTMLElement).dataset.slotId!;
      state.selectedSlot = { slotId, startAt, endAt, available: true };
      render();
      // Scroll to confirm
      setTimeout(() => {
        const confirmEl = getApp().querySelector('.confirm-section');
        confirmEl?.scrollIntoView({ behavior: 'smooth' });
      }, 50);
    });
  });

  // Confirm booking
  const confirmBtn = app.querySelector('[data-action="confirm-booking"]');
  confirmBtn?.addEventListener('click', () => submitBooking());
}

// ========== API Calls ==========

async function fetchSlots(date: string): Promise<void> {
  try {
    if (!RESOURCE_ID || !MENU_ID) throw new Error('予約対象またはメニューが未設定です');
    const query = new URLSearchParams({ date, menuId: MENU_ID, people: '1' });
    const res = await apiCall(`/api/public/reservation-resources/${encodeURIComponent(RESOURCE_ID)}/slots?${query}`);
    if (!res.ok) throw new Error('スロット取得に失敗しました');
    const json = await res.json() as {
      success: boolean;
      data: Array<{
        slotId: string;
        startAt: string;
        endAt: string;
        available: boolean;
        lineRemainingCapacity: number;
      }>;
    };
    if (!json.success) throw new Error('スロット取得に失敗しました');
    state.slots = json.data.map((slot) => ({
      slotId: slot.slotId,
      startAt: slot.startAt,
      endAt: slot.endAt,
      available: slot.available,
      lineRemainingCapacity: slot.lineRemainingCapacity,
    }));
  } catch (err) {
    state.slots = [];
    console.error('fetchSlots error:', err);
  } finally {
    state.loading = false;
    render();
  }
}

async function submitBooking(): Promise<void> {
  const { selectedSlot, selectedDate, profile, sessionToken } = state;
  if (!selectedSlot || !selectedDate || !profile || !sessionToken || state.submitting) return;
  state.submitting = true;

  const confirmBtn = getApp().querySelector('[data-action="confirm-booking"]') as HTMLButtonElement | null;
  if (confirmBtn) {
    confirmBtn.disabled = true;
    confirmBtn.textContent = '送信中...';
  }

  try {
    if (!RESOURCE_ID || !MENU_ID) throw new Error('予約対象またはメニューが未設定です');

    const res = await apiCall('/api/public/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${sessionToken}` },
      body: JSON.stringify({
        resourceId: RESOURCE_ID,
        menuId: MENU_ID,
        slotId: selectedSlot.slotId,
        adultCount: 1,
        childCount: 0,
        customer: { name: profile.displayName },
      }),
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => null) as { error?: string } | null;
      throw new Error(errData?.error || '予約に失敗しました');
    }

    renderSuccess(selectedDate, selectedSlot);
  } catch (err) {
    state.submitting = false;
    renderError(err instanceof Error ? err.message : '予約に失敗しました');
  }
}

// ========== Init ==========

export async function initBooking(): Promise<void> {
  if (!RESOURCE_ID || !MENU_ID) {
    renderError('予約対象またはメニューが未設定です。URLに resourceId と menuId を指定してください。');
    return;
  }

  const profile = await liff.getProfile();
  state.profile = profile;

  // Try to get friendId from UUID linking
  const UUID_STORAGE_KEY = 'lh_uuid';
  try {
    state.friendId = localStorage.getItem(UUID_STORAGE_KEY);
  } catch {
    // silent
  }

  const rawIdToken = liff.getIDToken();
  if (!rawIdToken) {
    renderError('LINEログイン情報を取得できませんでした。もう一度開き直してください。');
    return;
  }

  try {
    const sessionRes = await apiCall('/api/public/reservation-session', {
      method: 'POST',
      body: JSON.stringify({
        idToken: rawIdToken,
        displayName: profile.displayName,
      }),
    });
    const sessionJson = await sessionRes.json() as {
      success: boolean;
      data?: { token: string; friendId: string; userId: string };
      error?: string;
    };
    if (!sessionRes.ok || !sessionJson.success || !sessionJson.data?.token) {
      throw new Error(sessionJson.error || '予約セッションの作成に失敗しました');
    }
    state.sessionToken = sessionJson.data.token;
    state.friendId = sessionJson.data.friendId;
    state.userId = sessionJson.data.userId;
    try {
      localStorage.setItem(UUID_STORAGE_KEY, sessionJson.data.userId);
    } catch { /* silent */ }
  } catch (err) {
    renderError(err instanceof Error ? err.message : '予約セッションの作成に失敗しました');
    return;
  }

  render();
}
