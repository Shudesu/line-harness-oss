/**
 * LIFF reservation page.
 *
 * Public APIs never trust lineUserId from query params. This screen first
 * exchanges the LIFF ID token for a short-lived reservation session token.
 */

declare const liff: {
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string }>;
  getIDToken(): string | null;
  isInClient(): boolean;
  closeWindow(): void;
};

const params = new URLSearchParams(window.location.search);
const INITIAL_RESOURCE_ID = params.get('resourceId') || import.meta.env?.VITE_RESERVATION_RESOURCE_ID || '';
const INITIAL_MENU_ID = params.get('menuId') || import.meta.env?.VITE_RESERVATION_MENU_ID || '';
const TOKEN_STORAGE_KEY = 'lh_reservation_tokens';
const UUID_STORAGE_KEY = 'lh_uuid';

type Screen = 'booking' | 'confirm' | 'success' | 'mine' | 'detail' | 'cancel-confirm' | 'cancelled';
type ViewMode = 'week' | 'month';

interface Slot {
  slotId: string;
  resourceId: string;
  date: string;
  startAt: string;
  endAt: string;
  remainingCapacity: number;
  lineRemainingCapacity: number;
  externalRemainingCapacity: number;
  available: boolean;
}

interface Menu {
  id: string;
  resourceId: string;
  name: string;
  description?: string | null;
  durationMinutes: number;
  minPeople: number;
  maxPeople?: number | null;
  priceAdult?: number | null;
  priceChild?: number | null;
}

interface Reservation {
  id: string;
  slotId: string;
  title: string;
  reservationDate: string;
  startAt: string;
  endAt: string;
  status: string;
  adultCount: number;
  childCount: number;
  totalPeople: number;
  customerName?: string | null;
  customerPhone?: string | null;
  customerEmail?: string | null;
  cancelReason?: string | null;
  formData?: string | null;
  createdAt: string;
  detailToken?: string;
  cancelToken?: string;
}

interface StoredTokens {
  detailToken?: string;
  cancelToken?: string;
}

interface ReservationAccessTokens {
  reservationId: string;
  detailToken: string;
  cancelToken?: string;
  expiresIn: number;
}

interface BookingForm {
  adultCount: number;
  childCount: number;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  note: string;
}

interface BookingState {
  screen: Screen;
  resourceId: string;
  menuId: string;
  menus: Menu[];
  currentYear: number;
  currentMonth: number;
  weekStart: Date;
  viewMode: ViewMode;
  selectedDate: string | null;
  selectedSlot: Slot | null;
  slotsByDate: Record<string, Slot[]>;
  profile: { userId: string; displayName: string; pictureUrl?: string } | null;
  friendId: string | null;
  userId: string | null;
  sessionToken: string | null;
  form: BookingForm;
  reservations: Reservation[];
  selectedReservation: Reservation | null;
  lastReservation: Reservation | null;
  loading: boolean;
  loadingSlots: boolean;
  submitting: boolean;
  error: string | null;
}

const today = new Date();

const state: BookingState = {
  screen: 'booking',
  resourceId: INITIAL_RESOURCE_ID,
  menuId: INITIAL_MENU_ID,
  menus: [],
  currentYear: today.getFullYear(),
  currentMonth: today.getMonth(),
  weekStart: startOfWeek(today),
  viewMode: 'week',
  selectedDate: null,
  selectedSlot: null,
  slotsByDate: {},
  profile: null,
  friendId: null,
  userId: null,
  sessionToken: null,
  form: {
    adultCount: 1,
    childCount: 0,
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
};

function getApp(): HTMLElement {
  return document.getElementById('app')!;
}

function escapeHtml(value: unknown): string {
  const div = document.createElement('div');
  div.textContent = String(value ?? '');
  return div.innerHTML;
}

async function apiJson<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
  const json = await res.json().catch(() => null) as { success?: boolean; data?: T; error?: string; code?: string } | null;
  if (!res.ok || !json?.success) {
    throw new Error(json?.error || json?.code || `API request failed: ${res.status}`);
  }
  return json.data as T;
}

function formatTime(isoString: string): string {
  const d = new Date(isoString);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function formatDateJa(dateStr: string): string {
  const d = new Date(`${dateStr}T00:00:00`);
  const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;
}

function dateToString(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function startOfWeek(date: Date): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() - next.getDay());
  return next;
}

function addDays(date: Date, amount: number): Date {
  const next = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  next.setDate(next.getDate() + amount);
  return next;
}

function isPastDate(dateStr: string): boolean {
  const now = new Date();
  now.setHours(0, 0, 0, 0);
  return new Date(`${dateStr}T00:00:00`) < now;
}

function selectedMenu(): Menu | null {
  return state.menus.find((menu) => menu.id === state.menuId) ?? null;
}

function totalPeople(): number {
  return state.form.adultCount + state.form.childCount;
}

function availabilityMark(slots: Slot[] | undefined): { mark: string; className: string; label: string } {
  if (!slots || slots.length === 0) return { mark: '-', className: 'none', label: '未生成' };
  const best = Math.max(...slots.map((slot) => slot.available ? slot.lineRemainingCapacity : 0));
  if (best >= 3) return { mark: '◎', className: 'many', label: `残り${best}` };
  if (best >= 1) return { mark: '△', className: 'few', label: `残り${best}` };
  return { mark: '×', className: 'full', label: '満席' };
}

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: '受付済み',
    confirmed: '確定',
    cancelled: 'キャンセル',
    completed: '来園済み',
    no_show: '無断キャンセル',
  };
  return labels[status] ?? status;
}

function storedTokens(): Record<string, StoredTokens> {
  try {
    return JSON.parse(localStorage.getItem(TOKEN_STORAGE_KEY) || '{}') as Record<string, StoredTokens>;
  } catch {
    return {};
  }
}

function storeReservationTokens(reservation: Reservation): void {
  if (!reservation.detailToken && !reservation.cancelToken) return;
  try {
    const tokens = storedTokens();
    tokens[reservation.id] = {
      detailToken: reservation.detailToken,
      cancelToken: reservation.cancelToken,
    };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(tokens));
  } catch {
    // The list still works; only stored cancellation tokens are unavailable.
  }
}

function storeTokensForReservation(reservationId: string, tokens: StoredTokens): void {
  try {
    const allTokens = storedTokens();
    allTokens[reservationId] = {
      ...allTokens[reservationId],
      ...tokens,
    };
    localStorage.setItem(TOKEN_STORAGE_KEY, JSON.stringify(allTokens));
  } catch {
    // Optional enhancement only.
  }
}

function tokenForReservation(id: string): StoredTokens {
  return storedTokens()[id] ?? {};
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

  app.innerHTML = `
    <div class="booking-page reservation-liff">
      ${renderHeader()}
      ${renderScreen()}
    </div>
  `;
  bindEvents();
}

function renderHeader(): string {
  return `
    <div class="booking-header">
      <p class="eyebrow">Blueberry Farm Reservation</p>
      <h1>ブルーベリー観光農園 予約</h1>
      <p>日付と時間を選んで、内容確認後に予約できます。</p>
    </div>
    <div class="booking-tabs">
      <button class="${state.screen === 'booking' || state.screen === 'confirm' || state.screen === 'success' ? 'active' : ''}" data-action="show-booking">予約する</button>
      <button class="${state.screen === 'mine' || state.screen === 'detail' || state.screen === 'cancel-confirm' ? 'active' : ''}" data-action="show-mine">自分の予約</button>
    </div>
  `;
}

function renderScreen(): string {
  if (state.screen === 'confirm') return renderConfirm();
  if (state.screen === 'success') return renderSuccess();
  if (state.screen === 'mine') return renderMine();
  if (state.screen === 'detail') return renderReservationDetail();
  if (state.screen === 'cancel-confirm') return renderCancelConfirm();
  if (state.screen === 'cancelled') return renderCancelled();
  return renderBooking();
}

function renderBooking(): string {
  return `
    ${renderBookingControls()}
    ${state.viewMode === 'week' ? renderWeekAvailability() : renderMonthAvailability()}
    ${renderSlots()}
    ${renderInputForm()}
    <div class="booking-actions">
      <button class="book-btn" data-action="go-confirm">予約内容を確認する</button>
    </div>
  `;
}

function renderBookingControls(): string {
  const menu = selectedMenu();
  return `
    <section class="booking-panel">
      <div class="section-title-row">
        <div>
          <h2>予約内容</h2>
          <p>${menu ? `${escapeHtml(menu.name)} / ${menu.durationMinutes}分` : 'メニューを選択してください'}</p>
        </div>
      </div>
      <label class="field-label">
        メニュー
        <select data-field="menuId">
          ${state.menus.map((item) => `
            <option value="${escapeHtml(item.id)}" ${item.id === state.menuId ? 'selected' : ''}>
              ${escapeHtml(item.name)}（${item.durationMinutes}分）
            </option>
          `).join('')}
        </select>
      </label>
      <div class="people-grid">
        <label class="field-label">
          大人
          <input type="number" min="0" inputmode="numeric" data-field="adultCount" value="${state.form.adultCount}">
        </label>
        <label class="field-label">
          子ども
          <input type="number" min="0" inputmode="numeric" data-field="childCount" value="${state.form.childCount}">
        </label>
      </div>
      <div class="view-toggle">
        <button class="${state.viewMode === 'week' ? 'active' : ''}" data-action="view-week">1週間で見る</button>
        <button class="${state.viewMode === 'month' ? 'active' : ''}" data-action="view-month">1か月で見る</button>
      </div>
    </section>
  `;
}

function renderWeekAvailability(): string {
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
  const timeLabels = Array.from(new Set(days.flatMap((day) => (state.slotsByDate[dateToString(day)] ?? []).map((slot) => formatTime(slot.startAt))))).sort();

  return `
    <section class="booking-panel availability-panel">
      <div class="calendar-header">
        <button class="cal-nav" data-action="prev-week">&lt;</button>
        <div>
          <h2>空き状況</h2>
          <p>${formatDateJa(dateToString(days[0]))} から1週間</p>
        </div>
        <button class="cal-nav" data-action="next-week">&gt;</button>
      </div>
      ${state.loadingSlots ? '<div class="slots-loading"><div class="loading-spinner"></div><p>空き枠を確認中...</p></div>' : ''}
      <div class="week-matrix">
        <div class="week-cell week-head">時間</div>
        ${days.map((day) => `<button class="week-cell week-day ${state.selectedDate === dateToString(day) ? 'selected' : ''}" data-date="${dateToString(day)}">${day.getMonth() + 1}/${day.getDate()}<small>${['日', '月', '火', '水', '木', '金', '土'][day.getDay()]}</small></button>`).join('')}
        ${timeLabels.length === 0 ? '<div class="week-empty">表示できる予約枠がありません</div>' : timeLabels.map((time) => {
          return `
            <div class="week-cell week-time">${time}</div>
            ${days.map((day) => {
              const date = dateToString(day);
              const slot = (state.slotsByDate[date] ?? []).find((item) => formatTime(item.startAt) === time);
              if (!slot) return '<div class="week-cell mark none">-</div>';
              const mark = availabilityMark([slot]);
              return `<button class="week-cell mark ${mark.className} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}><span>${mark.mark}</span><small>${escapeHtml(mark.label)}</small></button>`;
            }).join('')}
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderMonthAvailability(): string {
  const first = new Date(state.currentYear, state.currentMonth, 1);
  const daysInMonth = new Date(state.currentYear, state.currentMonth + 1, 0).getDate();
  const blanks = first.getDay();

  return `
    <section class="booking-panel availability-panel">
      <div class="calendar-header">
        <button class="cal-nav" data-action="prev-month">&lt;</button>
        <div>
          <h2>${state.currentYear}年${state.currentMonth + 1}月</h2>
          <p>日付を押すと時間別の枠を表示します</p>
        </div>
        <button class="cal-nav" data-action="next-month">&gt;</button>
      </div>
      ${state.loadingSlots ? '<div class="slots-loading"><div class="loading-spinner"></div><p>月の空き状況を確認中...</p></div>' : ''}
      <div class="cal-weekdays">
        ${['日', '月', '火', '水', '木', '金', '土'].map((day, index) => `<span class="${index === 0 ? 'sun' : index === 6 ? 'sat' : ''}">${day}</span>`).join('')}
      </div>
      <div class="month-grid">
        ${Array.from({ length: blanks }, () => '<span class="month-day empty"></span>').join('')}
        ${Array.from({ length: daysInMonth }, (_, index) => {
          const day = index + 1;
          const date = dateToString(new Date(state.currentYear, state.currentMonth, day));
          const mark = availabilityMark(state.slotsByDate[date]);
          const disabled = isPastDate(date);
          return `
            <button class="month-day ${mark.className} ${state.selectedDate === date ? 'selected' : ''}" ${disabled ? 'disabled' : `data-date="${date}"`}>
              <strong>${day}</strong>
              <span>${disabled ? '-' : mark.mark}</span>
              <small>${disabled ? '終了' : escapeHtml(mark.label)}</small>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderSlots(): string {
  if (!state.selectedDate) {
    return `
      <section class="booking-panel">
        <h2>時間を選択</h2>
        <p class="muted">上のカレンダーから日付を選んでください。</p>
      </section>
    `;
  }

  const slots = state.slotsByDate[state.selectedDate] ?? [];
  if (slots.length === 0) {
    return `
      <section class="booking-panel">
        <h2>${formatDateJa(state.selectedDate)}</h2>
        <p class="muted">この日は予約枠がありません。</p>
      </section>
    `;
  }

  return `
    <section class="booking-panel">
      <h2>${formatDateJa(state.selectedDate)}</h2>
      <div class="slots-grid">
        ${slots.map((slot) => {
          const mark = availabilityMark([slot]);
          return `
            <button class="slot-btn ${slot.available ? 'available' : 'full'} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}>
              <strong>${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</strong>
              <span>${mark.mark} ${escapeHtml(mark.label)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderInputForm(): string {
  return `
    <section class="booking-panel">
      <h2>受付情報</h2>
      <label class="field-label">
        氏名
        <input type="text" data-field="customerName" value="${escapeHtml(state.form.customerName)}" placeholder="山田 太郎">
      </label>
      <label class="field-label">
        電話番号
        <input type="tel" inputmode="tel" data-field="customerPhone" value="${escapeHtml(state.form.customerPhone)}" placeholder="09012345678">
      </label>
      <label class="field-label">
        メールアドレス（任意）
        <input type="email" data-field="customerEmail" value="${escapeHtml(state.form.customerEmail)}" placeholder="example@example.com">
      </label>
      <label class="field-label">
        備考（任意）
        <textarea data-field="note" rows="3" placeholder="犬連れ、到着時間、質問など">${escapeHtml(state.form.note)}</textarea>
      </label>
    </section>
  `;
}

function renderConfirm(): string {
  const menu = selectedMenu();
  const slot = state.selectedSlot;
  return `
    <section class="booking-panel confirm-card">
      <h2>予約内容の確認</h2>
      ${renderReservationSummary({
        menuName: menu?.name ?? '未選択',
        date: state.selectedDate,
        startAt: slot?.startAt,
        endAt: slot?.endAt,
        adultCount: state.form.adultCount,
        childCount: state.form.childCount,
        name: state.form.customerName,
        phone: state.form.customerPhone,
        email: state.form.customerEmail,
        note: state.form.note,
      })}
      <p class="policy-note">内容に間違いがなければ予約を確定してください。満席になった場合は確定時にエラーになります。</p>
      <div class="booking-actions split">
        <button class="close-btn" data-action="back-booking">入力に戻る</button>
        <button class="book-btn" data-action="submit-booking" ${state.submitting ? 'disabled' : ''}>${state.submitting ? '送信中...' : '予約を確定する'}</button>
      </div>
    </section>
  `;
}

function renderSuccess(): string {
  const reservation = state.lastReservation;
  if (!reservation) return renderError('予約情報を表示できません');
  return `
    <section class="success-card">
      <div class="success-icon">✓</div>
      <h2>予約を受け付けました</h2>
      <p class="success-message">予約ID: ${escapeHtml(reservation.id)}</p>
      ${renderReservationSummary({
        menuName: selectedMenu()?.name ?? reservation.title,
        date: reservation.reservationDate,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        adultCount: reservation.adultCount,
        childCount: reservation.childCount,
        name: reservation.customerName ?? state.form.customerName,
        phone: reservation.customerPhone ?? state.form.customerPhone,
        email: reservation.customerEmail ?? state.form.customerEmail,
        note: state.form.note,
      })}
      <p class="policy-note">当日は予約時間に合わせてお越しください。変更が必要な場合は、予約詳細またはLINEからご連絡ください。</p>
      <div class="booking-actions">
        <button class="book-btn" data-action="show-created-detail">予約詳細を見る</button>
        <button class="close-btn danger" data-action="cancel-created">キャンセルする</button>
        <button class="close-btn" data-action="close">LINEに戻る</button>
      </div>
    </section>
  `;
}

function renderMine(): string {
  return `
    <section class="booking-panel">
      <div class="section-title-row">
        <div>
          <h2>自分の予約</h2>
          <p>このLINEアカウントに紐づく予約を表示します。</p>
        </div>
        <button class="mini-btn" data-action="reload-mine">更新</button>
      </div>
      ${state.loading ? '<div class="slots-loading"><div class="loading-spinner"></div><p>予約を確認中...</p></div>' : ''}
      ${state.reservations.length === 0 ? '<p class="muted">現在表示できる予約はありません。</p>' : `
        <div class="reservation-list">
          ${state.reservations.map((reservation) => `
            <button class="reservation-card" data-reservation-id="${escapeHtml(reservation.id)}">
              <span>${formatDateJa(reservation.reservationDate)} ${formatTime(reservation.startAt)}</span>
              <strong>${escapeHtml(reservation.customerName || reservation.title || '予約')}</strong>
              <small>${statusLabel(reservation.status)} / ${reservation.totalPeople}名</small>
            </button>
          `).join('')}
        </div>
      `}
    </section>
  `;
}

function renderReservationDetail(): string {
  const reservation = state.selectedReservation;
  if (!reservation) return renderMine();
  const tokens = tokenForReservation(reservation.id);
  return `
    <section class="booking-panel">
      <button class="text-btn" data-action="show-mine">← 一覧に戻る</button>
      <h2>予約詳細</h2>
      ${renderReservationSummary({
        menuName: reservation.title,
        date: reservation.reservationDate,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        adultCount: reservation.adultCount,
        childCount: reservation.childCount,
        name: reservation.customerName ?? '',
        phone: reservation.customerPhone ?? '',
        email: reservation.customerEmail ?? '',
        note: parseNote(reservation.formData),
      })}
      <div class="confirm-row"><span class="confirm-label">状態</span><span class="confirm-value">${statusLabel(reservation.status)}</span></div>
      <div class="confirm-row"><span class="confirm-label">予約ID</span><span class="confirm-value">${escapeHtml(reservation.id)}</span></div>
      ${reservation.status === 'pending' || reservation.status === 'confirmed' ? `
        <button class="close-btn danger" data-action="${tokens.cancelToken ? 'go-cancel' : 'issue-tokens'}">
          ${tokens.cancelToken ? 'この予約をキャンセルする' : 'キャンセル導線を復旧する'}
        </button>
        ${tokens.cancelToken ? '' : '<p class="muted">別端末や保存情報が消えた場合でも、LINE認証済みならキャンセル用tokenを再発行できます。</p>'}
      ` : '<p class="muted">この予約は現在キャンセルできない状態です。</p>'}
    </section>
  `;
}

function renderCancelConfirm(): string {
  const reservation = state.selectedReservation;
  if (!reservation) return renderMine();
  return `
    <section class="booking-panel">
      <h2>キャンセル確認</h2>
      <p class="policy-note">この予約をキャンセルします。キャンセル後、在庫は状態遷移表に従って1回だけ戻されます。</p>
      <div class="confirm-row"><span class="confirm-label">日付</span><span class="confirm-value">${formatDateJa(reservation.reservationDate)}</span></div>
      <div class="confirm-row"><span class="confirm-label">時間</span><span class="confirm-value">${formatTime(reservation.startAt)}-${formatTime(reservation.endAt)}</span></div>
      <div class="booking-actions split">
        <button class="close-btn" data-action="back-detail">戻る</button>
        <button class="book-btn danger" data-action="submit-cancel" ${state.submitting ? 'disabled' : ''}>${state.submitting ? '処理中...' : 'キャンセルする'}</button>
      </div>
    </section>
  `;
}

function renderCancelled(): string {
  return `
    <section class="success-card">
      <div class="success-icon muted-icon">✓</div>
      <h2>キャンセルしました</h2>
      <p class="success-message">予約のキャンセルを受け付けました。</p>
      <button class="book-btn" data-action="show-mine">予約一覧へ</button>
    </section>
  `;
}

function renderReservationSummary(input: {
  menuName: string;
  date?: string | null;
  startAt?: string;
  endAt?: string;
  adultCount: number;
  childCount: number;
  name: string;
  phone: string;
  email?: string | null;
  note?: string | null;
}): string {
  return `
    <div class="confirm-details">
      <div class="confirm-row"><span class="confirm-label">メニュー</span><span class="confirm-value">${escapeHtml(input.menuName)}</span></div>
      <div class="confirm-row"><span class="confirm-label">日付</span><span class="confirm-value">${input.date ? formatDateJa(input.date) : '未選択'}</span></div>
      <div class="confirm-row"><span class="confirm-label">時間</span><span class="confirm-value">${input.startAt && input.endAt ? `${formatTime(input.startAt)}-${formatTime(input.endAt)}` : '未選択'}</span></div>
      <div class="confirm-row"><span class="confirm-label">人数</span><span class="confirm-value">大人${input.adultCount}名 / 子ども${input.childCount}名</span></div>
      <div class="confirm-row"><span class="confirm-label">氏名</span><span class="confirm-value">${escapeHtml(input.name)}</span></div>
      <div class="confirm-row"><span class="confirm-label">電話</span><span class="confirm-value">${escapeHtml(input.phone)}</span></div>
      ${input.email ? `<div class="confirm-row"><span class="confirm-label">メール</span><span class="confirm-value">${escapeHtml(input.email)}</span></div>` : ''}
      ${input.note ? `<div class="confirm-row"><span class="confirm-label">備考</span><span class="confirm-value">${escapeHtml(input.note)}</span></div>` : ''}
    </div>
  `;
}

function renderError(message: string): string {
  return `
    <div class="booking-page">
      <div class="card">
        <h2 style="color:#e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
        <button class="close-btn" data-action="back-booking" style="margin-top:16px;">予約画面へ戻る</button>
      </div>
    </div>
  `;
}

function bindEvents(): void {
  const app = getApp();
  app.querySelectorAll<HTMLElement>('[data-action]').forEach((element) => {
    element.addEventListener('click', () => handleAction(element.dataset.action ?? '', element));
  });
  app.querySelectorAll<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>('[data-field]').forEach((element) => {
    element.addEventListener('input', () => handleField(element.dataset.field ?? '', element.value));
    element.addEventListener('change', () => handleField(element.dataset.field ?? '', element.value));
  });
  app.querySelectorAll<HTMLElement>('[data-date]').forEach((element) => {
    element.addEventListener('click', () => selectDate(element.dataset.date ?? ''));
  });
  app.querySelectorAll<HTMLElement>('[data-slot-id]').forEach((element) => {
    element.addEventListener('click', () => selectSlot(element.dataset.slotId ?? ''));
  });
  app.querySelectorAll<HTMLElement>('[data-reservation-id]').forEach((element) => {
    element.addEventListener('click', () => selectReservation(element.dataset.reservationId ?? ''));
  });
}

function handleField(field: string, value: string): void {
  if (field === 'menuId') {
    state.menuId = value;
    state.selectedSlot = null;
    void loadVisibleAvailability();
    render();
    return;
  }
  if (field === 'adultCount' || field === 'childCount') {
    const parsed = Math.max(0, Number.parseInt(value, 10) || 0);
    state.form[field] = parsed;
    state.selectedSlot = null;
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
    render();
    return;
  }
  if (action === 'show-mine') {
    state.screen = 'mine';
    await loadMine();
    return;
  }
  if (action === 'reload-mine') {
    await loadMine();
    return;
  }
  if (action === 'view-week') {
    state.viewMode = 'week';
    await loadVisibleAvailability();
    return;
  }
  if (action === 'view-month') {
    state.viewMode = 'month';
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
      state.error = error;
      render();
      return;
    }
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
  if (action === 'cancel-created') {
    if (state.lastReservation) {
      state.selectedReservation = state.lastReservation;
      state.screen = 'cancel-confirm';
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
  state.selectedDate = date;
  state.selectedSlot = null;
  if (!state.slotsByDate[date]) void fetchSlots(date);
  render();
}

function selectSlot(slotId: string): void {
  const slot = Object.values(state.slotsByDate).flat().find((item) => item.slotId === slotId);
  if (!slot || !slot.available) return;
  state.selectedDate = slot.date;
  state.selectedSlot = slot;
  render();
}

function selectReservation(id: string): void {
  const reservation = state.reservations.find((item) => item.id === id) ?? null;
  state.selectedReservation = reservation;
  state.screen = reservation ? 'detail' : 'mine';
  render();
}

async function fetchSlots(date: string): Promise<Slot[]> {
  if (!state.resourceId || !state.menuId) return [];
  const query = new URLSearchParams({
    date,
    menuId: state.menuId,
    people: String(Math.max(1, totalPeople())),
  });
  const slots = await apiJson<Slot[]>(`/api/public/reservation-resources/${encodeURIComponent(state.resourceId)}/slots?${query}`);
  state.slotsByDate[date] = slots;
  return slots;
}

async function loadVisibleAvailability(): Promise<void> {
  if (!state.resourceId || !state.menuId) return;
  state.loadingSlots = true;
  render();
  try {
    const dates = state.viewMode === 'week'
      ? Array.from({ length: 7 }, (_, index) => dateToString(addDays(state.weekStart, index)))
      : Array.from({ length: new Date(state.currentYear, state.currentMonth + 1, 0).getDate() }, (_, index) => dateToString(new Date(state.currentYear, state.currentMonth, index + 1)));
    await Promise.all(dates.filter((date) => !isPastDate(date)).map((date) => fetchSlots(date).catch(() => [])));
  } finally {
    state.loadingSlots = false;
    render();
  }
}

async function submitBooking(): Promise<void> {
  const error = validateBooking();
  if (error) {
    state.error = error;
    state.screen = 'booking';
    render();
    return;
  }
  if (!state.selectedSlot || !state.sessionToken || state.submitting) return;
  state.submitting = true;
  render();
  try {
    const reservation = await apiJson<Reservation>('/api/public/reservations', {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.sessionToken}` },
      body: JSON.stringify({
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
      }),
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
    state.error = err instanceof Error ? err.message : '予約に失敗しました。';
    if (state.selectedDate) {
      await fetchSlots(state.selectedDate).catch(() => []);
    }
    render();
    return;
  }
  state.submitting = false;
  render();
}

async function loadMine(): Promise<void> {
  if (!state.sessionToken) return;
  state.loading = true;
  render();
  try {
    state.reservations = await apiJson<Reservation[]>('/api/public/me/reservations?status=active', {
      headers: { Authorization: `Bearer ${state.sessionToken}` },
    });
  } catch (err) {
    state.error = err instanceof Error ? err.message : '予約一覧を取得できませんでした。';
  } finally {
    state.loading = false;
    render();
  }
}

async function submitCancel(): Promise<void> {
  const reservation = state.selectedReservation;
  if (!reservation || state.submitting) return;
  const token = tokenForReservation(reservation.id).cancelToken || reservation.cancelToken;
  if (!token) {
    state.error = 'この予約をキャンセルするためのトークンがありません。LINEから店舗へご連絡ください。';
    render();
    return;
  }
  state.submitting = true;
  render();
  try {
    const result = await apiJson<{ reservation: Reservation; changed: boolean }>(`/api/public/reservations/${encodeURIComponent(reservation.id)}/cancel`, {
      method: 'POST',
      body: JSON.stringify({ token, reason: 'customer_requested' }),
    });
    state.selectedReservation = result.reservation;
    state.lastReservation = result.reservation;
    state.reservations = state.reservations.map((item) => item.id === result.reservation.id ? result.reservation : item);
    state.screen = 'cancelled';
  } catch (err) {
    state.error = err instanceof Error ? err.message : 'キャンセルに失敗しました。';
  } finally {
    state.submitting = false;
    render();
  }
}

async function issueTokensForSelectedReservation(): Promise<void> {
  const reservation = state.selectedReservation;
  if (!reservation || !state.sessionToken || state.submitting) return;
  state.submitting = true;
  render();
  try {
    const tokens = await apiJson<ReservationAccessTokens>(`/api/public/reservations/${encodeURIComponent(reservation.id)}/tokens`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${state.sessionToken}` },
      body: JSON.stringify({}),
    });
    storeTokensForReservation(tokens.reservationId, {
      detailToken: tokens.detailToken,
      cancelToken: tokens.cancelToken,
    });
    state.screen = tokens.cancelToken ? 'cancel-confirm' : 'detail';
  } catch (err) {
    state.error = err instanceof Error ? err.message : '予約操作用tokenの再発行に失敗しました。';
  } finally {
    state.submitting = false;
    render();
  }
}

function parseNote(formData?: string | null): string {
  if (!formData) return '';
  try {
    const parsed = JSON.parse(formData) as { note?: unknown };
    return typeof parsed.note === 'string' ? parsed.note : '';
  } catch {
    return '';
  }
}

export async function initBooking(): Promise<void> {
  if (!state.resourceId) {
    state.loading = false;
    state.error = '予約対象が未設定です。URLに resourceId を指定してください。';
    render();
    return;
  }

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

    const session = await apiJson<{ token: string; friendId: string; userId: string }>('/api/public/reservation-session', {
      method: 'POST',
      body: JSON.stringify({ idToken, displayName: profile.displayName }),
    });
    state.sessionToken = session.token;
    state.friendId = session.friendId;
    state.userId = session.userId;
    try {
      localStorage.setItem(UUID_STORAGE_KEY, session.userId);
    } catch {
      // optional only
    }

    state.menus = await apiJson<Menu[]>(`/api/public/reservation-resources/${encodeURIComponent(state.resourceId)}/menus`);
    if (!state.menuId) state.menuId = state.menus[0]?.id ?? '';
    if (!state.menuId || !state.menus.some((menu) => menu.id === state.menuId)) {
      throw new Error('予約メニューが見つかりません。');
    }
    const menu = selectedMenu();
    if (menu && state.form.adultCount + state.form.childCount < menu.minPeople) {
      state.form.adultCount = menu.minPeople;
      state.form.childCount = 0;
    }

    state.loading = false;
    render();
    await loadVisibleAvailability();
  } catch (err) {
    state.loading = false;
    state.error = err instanceof Error ? err.message : '予約画面の初期化に失敗しました。';
    render();
  }
}
