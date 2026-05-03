import type {
  ExternalReservationSourceResponse,
  ReservationMenu,
  ReservationResource,
  ReservationResponse,
  ReservationSchedule,
  ReservationSlot,
  ReservationSlotWithAvailability,
} from '@line-crm/shared';

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: string; code?: string };

type StatusUpdateResponse = {
  reservation: ReservationResponse;
  changed: boolean;
};

const API_KEY_STORAGE_KEY = 'lh_reservation_admin_api_key';

type State = {
  apiKey: string;
  date: string;
  viewMode: 'week' | 'month';
  weekStart: string;
  resourceId: string;
  resources: ReservationResource[];
  menus: ReservationMenu[];
  schedules: ReservationSchedule[];
  slots: ReservationSlotWithAvailability[];
  slotsByDate: Record<string, ReservationSlotWithAvailability[]>;
  reservations: ReservationResponse[];
  externalSources: ExternalReservationSourceResponse[];
  selectedReservation: ReservationResponse | null;
  loading: boolean;
  message: string | null;
  error: string | null;
};

const state: State = {
  apiKey: readSessionApiKey(),
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
  loading: false,
  message: null,
  error: null,
};

function readSessionApiKey(): string {
  try {
    return sessionStorage.getItem(API_KEY_STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

function saveSessionApiKey(value: string): void {
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

function todayJst(): string {
  const formatter = new Intl.DateTimeFormat('sv-SE', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date());
}

function parseYmd(value: string): Date {
  const [year, month, day] = value.split('-').map((part) => Number.parseInt(part, 10));
  return new Date(year, month - 1, day);
}

function toYmd(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDaysYmd(value: string, days: number): string {
  const date = parseYmd(value);
  date.setDate(date.getDate() + days);
  return toYmd(date);
}

function startOfWeekYmd(value: string): string {
  const date = parseYmd(value);
  date.setDate(date.getDate() - date.getDay());
  return toYmd(date);
}

function monthDates(year: number, monthIndex: number): string[] {
  const total = new Date(year, monthIndex + 1, 0).getDate();
  return Array.from({ length: total }, (_, index) => toYmd(new Date(year, monthIndex, index + 1)));
}

function visibleDates(): string[] {
  if (state.viewMode === 'week') {
    return Array.from({ length: 7 }, (_, index) => addDaysYmd(state.weekStart, index));
  }
  const date = parseYmd(state.date);
  return monthDates(date.getFullYear(), date.getMonth());
}

function formatDateShort(value: string): string {
  const date = parseYmd(value);
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function dayLabel(value: string): string {
  return ['日', '月', '火', '水', '木', '金', '土'][parseYmd(value).getDay()] ?? '';
}

function escapeHtml(value: string | null | undefined): string {
  const div = document.createElement('div');
  div.textContent = value ?? '';
  return div.innerHTML;
}

function formatTime(value: string): string {
  const match = value.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : value;
}

function slotMark(slots: ReservationSlotWithAvailability[] | undefined): { mark: string; className: string; label: string } {
  if (!slots || slots.length === 0) return { mark: '-', className: 'none', label: '未生成' };
  const best = Math.max(...slots.map((slot) => {
    const lineRemaining = slot.availability.lineRemainingCapacity ?? slot.availability.remainingCapacity;
    return slot.availability.available ? lineRemaining : 0;
  }));
  if (best >= 3) return { mark: '◎', className: 'many', label: `LINE残${best}` };
  if (best >= 1) return { mark: '△', className: 'few', label: `LINE残${best}` };
  return { mark: '×', className: 'full', label: '満席' };
}

function isActiveReservation(reservation: ReservationResponse): boolean {
  return reservation.status === 'pending' || reservation.status === 'confirmed';
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  if (!state.apiKey) {
    throw new Error('APIキーを入力してください');
  }

  const response = await fetch(path, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${state.apiKey}`,
      ...init?.headers,
    },
  });
  const body = await response.json().catch(() => null) as ApiResponse<T> | null;
  if (!response.ok || !body?.success) {
    throw new Error(body && !body.success ? body.error : `API error: ${response.status}`);
  }
  return body.data;
}

async function loadInitial(): Promise<void> {
  await withLoading(async () => {
    const resources = await api<ReservationResource[]>('/api/reservation-resources');
    state.resources = resources;
    if (!state.resourceId && resources[0]) {
      state.resourceId = resources[0].id;
    }
    await loadReservationsAndSlots();
  });
}

async function loadReservationsAndSlots(): Promise<void> {
  const reservationsPath = `/api/reservations?date=${encodeURIComponent(state.date)}`;
  const reservationsPromise = api<ReservationResponse[]>(reservationsPath);
  const externalSourcesPromise = api<ExternalReservationSourceResponse[]>(
    '/api/external-reservation-sources?parseStatus=needs_review&limit=20',
  );
  const menusPromise = state.resourceId
    ? api<ReservationMenu[]>(`/api/reservation-resources/${encodeURIComponent(state.resourceId)}/menus`)
    : Promise.resolve([]);
  const schedulesPromise = state.resourceId
    ? api<ReservationSchedule[]>(`/api/reservation-resources/${encodeURIComponent(state.resourceId)}/schedules`)
    : Promise.resolve([]);
  const slotsPromise = state.resourceId
    ? listSlotsForDate(state.date)
    : Promise.resolve([]);

  const [reservations, slots, externalSources, menus, schedules] = await Promise.all([
    reservationsPromise,
    slotsPromise,
    externalSourcesPromise,
    menusPromise,
    schedulesPromise,
  ]);
  state.reservations = reservations;
  state.slots = slots;
  state.externalSources = externalSources;
  state.menus = menus;
  state.schedules = schedules;
  state.slotsByDate[state.date] = slots;
  await loadVisibleSlots();
  if (state.selectedReservation) {
    state.selectedReservation = reservations.find((item) => item.id === state.selectedReservation?.id) ?? null;
  }
}

async function listSlotsForDate(date: string): Promise<ReservationSlotWithAvailability[]> {
  if (!state.resourceId) return [];
  return api<ReservationSlotWithAvailability[]>(
    `/api/reservation-slots?resourceId=${encodeURIComponent(state.resourceId)}&date=${encodeURIComponent(date)}&people=1`,
  );
}

async function loadVisibleSlots(): Promise<void> {
  if (!state.resourceId) {
    state.slotsByDate = {};
    return;
  }
  const entries = await Promise.all(
    visibleDates().map(async (date) => {
      const slots = await listSlotsForDate(date).catch(() => [] as ReservationSlotWithAvailability[]);
      return [date, slots] as const;
    }),
  );
  state.slotsByDate = Object.fromEntries(entries);
  state.slots = state.slotsByDate[state.date] ?? state.slots;
}

async function generateSlots(): Promise<void> {
  const dateFromInput = document.getElementById('slotGenerateDateFrom');
  const dateToInput = document.getElementById('slotGenerateDateTo');
  const dateFrom = dateFromInput instanceof HTMLInputElement ? dateFromInput.value : state.date;
  const dateTo = dateToInput instanceof HTMLInputElement ? dateToInput.value : state.date;
  if (!state.resourceId) {
    state.error = 'resourceを選択してください';
    render();
    return;
  }
  if (!dateFrom || !dateTo) {
    state.error = '生成する日付範囲を入力してください';
    render();
    return;
  }
  if (!window.confirm(`${dateFrom} から ${dateTo} までのslotを生成します。既存slotは重複作成されません。`)) {
    return;
  }

  await withLoading(async () => {
    const slots = await api<ReservationSlot[]>('/api/reservation-slots/generate', {
      method: 'POST',
      body: JSON.stringify({
        resourceId: state.resourceId,
        dateFrom,
        dateTo,
      }),
    });
    await loadReservationsAndSlots();
    state.message = `${slots.length}件のslotを生成しました`;
  });
}

async function updateSlotFromCard(slotId: string): Promise<void> {
  await withLoading(async () => {
    const payload = {
      status: inputValue(`slotStatus-${slotId}`),
      totalCapacity: numberValue(`slotTotal-${slotId}`),
      lineCapacity: nullableNumberValue(`slotLine-${slotId}`),
      externalCapacity: nullableNumberValue(`slotExternal-${slotId}`),
      bufferCapacity: numberValue(`slotBuffer-${slotId}`),
      note: inputValue(`slotNote-${slotId}`) || null,
    };
    await api<ReservationSlot>(`/api/reservation-slots/${encodeURIComponent(slotId)}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    await loadReservationsAndSlots();
    state.message = 'slotを更新しました';
  });
}

async function markExternalSourceIgnored(id: string): Promise<void> {
  if (!window.confirm('この外部取り込みを確認済みとして閉じます。予約本体は自動変更しません。')) {
    return;
  }

  await withLoading(async () => {
    await api<ExternalReservationSourceResponse>(`/api/external-reservation-sources/${encodeURIComponent(id)}/parse-status`, {
      method: 'PUT',
      body: JSON.stringify({
        parseStatus: 'ignored',
        lastError: null,
      }),
    });
    await loadReservationsAndSlots();
    state.message = '外部取り込みを確認済みにしました';
  });
}

async function createResourceFromForm(): Promise<void> {
  const name = inputValue('resourceName');
  if (!name) {
    state.error = 'resource名を入力してください';
    render();
    return;
  }
  await withLoading(async () => {
    const resource = await api<ReservationResource>('/api/reservation-resources', {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: inputValue('resourceDescription') || null,
        defaultDurationMinutes: numberValue('resourceDuration') ?? 60,
        defaultCapacity: numberValue('resourceCapacity') ?? 20,
        defaultLineCapacity: nullableNumberValue('resourceLineCapacity'),
        defaultExternalCapacity: nullableNumberValue('resourceExternalCapacity'),
        slotIntervalMinutes: numberValue('resourceSlotInterval') ?? 60,
        googleCalendarConnectionId: inputValue('resourceGoogleConnectionId') || null,
      }),
    });
    state.resources = await api<ReservationResource[]>('/api/reservation-resources');
    state.resourceId = resource.id;
    await loadReservationsAndSlots();
    state.message = 'resourceを作成しました';
  });
}

async function updateResourceFromCard(resourceId: string): Promise<void> {
  await withLoading(async () => {
    await api<ReservationResource>(`/api/reservation-resources/${encodeURIComponent(resourceId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: inputValue(`resourceName-${resourceId}`),
        description: inputValue(`resourceDescription-${resourceId}`) || null,
        defaultDurationMinutes: numberValue(`resourceDuration-${resourceId}`),
        defaultCapacity: numberValue(`resourceCapacity-${resourceId}`),
        defaultLineCapacity: nullableNumberValue(`resourceLineCapacity-${resourceId}`),
        defaultExternalCapacity: nullableNumberValue(`resourceExternalCapacity-${resourceId}`),
        defaultBufferCapacity: numberValue(`resourceBufferCapacity-${resourceId}`),
        slotIntervalMinutes: numberValue(`resourceSlotInterval-${resourceId}`),
        googleCalendarConnectionId: inputValue(`resourceGoogleConnectionId-${resourceId}`) || null,
        isActive: checkedValue(`resourceActive-${resourceId}`),
      }),
    });
    state.resources = await api<ReservationResource[]>('/api/reservation-resources');
    await loadReservationsAndSlots();
    state.message = 'resourceを更新しました';
  });
}

async function createMenuFromForm(): Promise<void> {
  if (!state.resourceId) {
    state.error = 'resourceを選択してください';
    render();
    return;
  }
  const name = inputValue('menuName');
  if (!name) {
    state.error = 'menu名を入力してください';
    render();
    return;
  }
  await withLoading(async () => {
    await api<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(state.resourceId)}/menus`, {
      method: 'POST',
      body: JSON.stringify({
        name,
        description: inputValue('menuDescription') || null,
        durationMinutes: numberValue('menuDuration') ?? 60,
        unitType: 'person',
        minPeople: numberValue('menuMinPeople') ?? 1,
        maxPeople: nullableNumberValue('menuMaxPeople'),
        priceAdult: nullableNumberValue('menuPriceAdult'),
        priceChild: nullableNumberValue('menuPriceChild'),
      }),
    });
    await loadReservationsAndSlots();
    state.message = 'menuを作成しました';
  });
}

async function updateMenuFromCard(menuId: string): Promise<void> {
  if (!state.resourceId) return;
  await withLoading(async () => {
    await api<ReservationMenu>(`/api/reservation-resources/${encodeURIComponent(state.resourceId)}/menus/${encodeURIComponent(menuId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        name: inputValue(`menuName-${menuId}`),
        description: inputValue(`menuDescription-${menuId}`) || null,
        durationMinutes: numberValue(`menuDuration-${menuId}`),
        minPeople: numberValue(`menuMinPeople-${menuId}`),
        maxPeople: nullableNumberValue(`menuMaxPeople-${menuId}`),
        priceAdult: nullableNumberValue(`menuPriceAdult-${menuId}`),
        priceChild: nullableNumberValue(`menuPriceChild-${menuId}`),
        isActive: checkedValue(`menuActive-${menuId}`),
      }),
    });
    await loadReservationsAndSlots();
    state.message = 'menuを更新しました';
  });
}

async function createScheduleFromForm(): Promise<void> {
  if (!state.resourceId) {
    state.error = 'resourceを選択してください';
    render();
    return;
  }
  await withLoading(async () => {
    await api<ReservationSchedule>(`/api/reservation-resources/${encodeURIComponent(state.resourceId)}/schedules`, {
      method: 'POST',
      body: JSON.stringify({
        dayOfWeek: numberValue('scheduleDayOfWeek') ?? 0,
        startTime: inputValue('scheduleStartTime') || '09:00',
        endTime: inputValue('scheduleEndTime') || '15:00',
        slotIntervalMinutes: numberValue('scheduleSlotInterval') ?? 60,
        defaultCapacity: numberValue('scheduleCapacity') ?? 20,
        defaultLineCapacity: nullableNumberValue('scheduleLineCapacity'),
        defaultExternalCapacity: nullableNumberValue('scheduleExternalCapacity'),
        defaultBufferCapacity: numberValue('scheduleBufferCapacity') ?? 0,
      }),
    });
    await loadReservationsAndSlots();
    state.message = 'scheduleを作成しました';
  });
}

async function updateScheduleFromCard(scheduleId: string): Promise<void> {
  if (!state.resourceId) return;
  await withLoading(async () => {
    await api<ReservationSchedule>(`/api/reservation-resources/${encodeURIComponent(state.resourceId)}/schedules/${encodeURIComponent(scheduleId)}`, {
      method: 'PUT',
      body: JSON.stringify({
        dayOfWeek: numberValue(`scheduleDayOfWeek-${scheduleId}`),
        startTime: inputValue(`scheduleStartTime-${scheduleId}`),
        endTime: inputValue(`scheduleEndTime-${scheduleId}`),
        slotIntervalMinutes: numberValue(`scheduleSlotInterval-${scheduleId}`),
        defaultCapacity: numberValue(`scheduleCapacity-${scheduleId}`),
        defaultLineCapacity: nullableNumberValue(`scheduleLineCapacity-${scheduleId}`),
        defaultExternalCapacity: nullableNumberValue(`scheduleExternalCapacity-${scheduleId}`),
        defaultBufferCapacity: numberValue(`scheduleBufferCapacity-${scheduleId}`),
        isActive: checkedValue(`scheduleActive-${scheduleId}`),
      }),
    });
    await loadReservationsAndSlots();
    state.message = 'scheduleを更新しました';
  });
}

async function startGoogleCalendarOAuth(): Promise<void> {
  const calendarId = inputValue('googleCalendarId') || 'primary';
  const returnTo = window.location.href;
  await withLoading(async () => {
    const result = await api<{ url: string }>(
      `/api/reservations/google-calendar/oauth-url?${new URLSearchParams({ calendarId, returnTo })}`,
    );
    window.open(result.url, '_blank', 'noopener,noreferrer');
    state.message = 'Google OAuth開始URLを開きました。接続後に表示されるconnection IDをresourceへ設定してください。';
  });
}

function inputValue(id: string): string {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement
    ? element.value.trim()
    : '';
}

function numberValue(id: string): number | undefined {
  const value = inputValue(id);
  if (!value) return undefined;
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

function nullableNumberValue(id: string): number | null {
  const value = inputValue(id);
  return value ? numberValue(id) ?? null : null;
}

function checkedValue(id: string): boolean | undefined {
  const element = document.getElementById(id);
  return element instanceof HTMLInputElement ? element.checked : undefined;
}

async function refresh(): Promise<void> {
  await withLoading(async () => {
    await loadReservationsAndSlots();
    state.message = '更新しました';
  });
}

async function selectReservation(id: string): Promise<void> {
  await withLoading(async () => {
    state.selectedReservation = await api<ReservationResponse>(`/api/reservations/${encodeURIComponent(id)}`);
  });
}

async function cancelReservation(id: string): Promise<void> {
  const target = state.reservations.find((item) => item.id === id) ?? state.selectedReservation;
  const label = target?.customerName || target?.title || id;
  if (!window.confirm(`${label} の予約をキャンセルします。よろしいですか？`)) {
    return;
  }

  await withLoading(async () => {
    const result = await api<StatusUpdateResponse>(`/api/reservations/${encodeURIComponent(id)}/status`, {
      method: 'PUT',
      body: JSON.stringify({
        status: 'cancelled',
        reason: 'admin_cancelled_from_web',
      }),
    });
    state.selectedReservation = result.reservation;
    await loadReservationsAndSlots();
    state.message = result.changed ? 'キャンセルしました。在庫戻しは状態遷移ルールに従って1回だけ実行されます。' : 'すでにキャンセル済みです。';
  });
}

async function withLoading(fn: () => Promise<void>): Promise<void> {
  state.loading = true;
  state.error = null;
  state.message = null;
  render();
  try {
    await fn();
  } catch (err) {
    state.error = err instanceof Error ? err.message : '処理に失敗しました';
  } finally {
    state.loading = false;
    render();
  }
}

function render(): void {
  const app = document.getElementById('app');
  if (!app) return;
  app.innerHTML = `
    <style>
      body{background:#f4f1e8;color:#1f2a21}
      #app{max-width:1180px}
      .reservation-admin{font-family:'Hiragino Mincho ProN','Yu Mincho','Noto Serif JP',serif;padding:18px}
      .admin-hero{background:linear-gradient(135deg,#1e3b2f,#66804e);color:#fff;border-radius:28px;padding:28px;box-shadow:0 20px 60px rgba(31,42,33,.18);margin-bottom:18px}
      .admin-hero h1{font-size:30px;margin:0 0 8px;letter-spacing:.04em}
      .admin-hero p{margin:0;color:rgba(255,255,255,.82);line-height:1.7}
      .admin-panel{background:rgba(255,255,255,.86);border:1px solid rgba(31,42,33,.1);border-radius:22px;padding:18px;box-shadow:0 12px 32px rgba(31,42,33,.08);margin-bottom:16px}
      .admin-grid{display:grid;grid-template-columns:1.1fr .9fr;gap:16px}
      .admin-controls{display:grid;grid-template-columns:1.3fr 1fr 1fr auto;gap:10px;align-items:end}
      .settings-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}
      .settings-card{background:#fff;border:1px solid rgba(31,42,33,.1);border-radius:18px;padding:14px}
      .settings-form{display:grid;gap:10px}
      .settings-list{margin-top:12px;display:grid;gap:8px}
      .settings-item{border-radius:12px;background:#f8f4ea;padding:10px;font-size:13px;color:#3f493d;line-height:1.5}
      .settings-editor{display:grid;gap:8px;border-radius:14px;background:#f8f4ea;padding:10px}
      .settings-editor-row{display:grid;grid-template-columns:1fr 1fr;gap:8px}
      .check-row{display:flex;align-items:center;gap:8px;font-size:13px;font-weight:700;color:#52624d}
      .check-row input{width:auto}
      .ai-roadmap{background:linear-gradient(135deg,#f8f4ea,#e8efe1);border:1px solid rgba(31,42,33,.1);border-radius:22px;padding:18px;margin-bottom:16px}
      .admin-field label{display:block;font-size:12px;font-weight:700;color:#52624d;margin-bottom:6px}
      .admin-field input,.admin-field select{width:100%;border:1px solid rgba(31,42,33,.18);border-radius:12px;padding:11px 12px;background:#fff;color:#1f2a21;font-size:14px}
      .admin-button{border:0;border-radius:12px;background:#1e3b2f;color:#fff;padding:12px 16px;font-weight:700;cursor:pointer;white-space:nowrap}
      .admin-button.secondary{background:#ede7d8;color:#1f2a21}
      .admin-button.danger{background:#a33a2b}
      .admin-button:disabled{opacity:.45;cursor:not-allowed}
      .admin-message{border-radius:14px;padding:12px 14px;margin-bottom:14px;font-size:14px}
      .admin-message.ok{background:#e8f3df;color:#2f5b2d}
      .admin-message.error{background:#fae4df;color:#8f2d20}
      .admin-section-title{font-size:18px;margin:0 0 12px;color:#1f2a21}
      .slot-list,.reservation-list{display:grid;gap:10px}
      .availability-toolbar{display:flex;justify-content:space-between;gap:12px;align-items:center;margin-bottom:12px;flex-wrap:wrap}
      .availability-toggle{display:flex;gap:8px;flex-wrap:wrap}
      .availability-toggle button,.calendar-nav{border:1px solid rgba(31,42,33,.14);border-radius:999px;background:#fff;color:#1f2a21;padding:9px 12px;font-weight:800;cursor:pointer}
      .availability-toggle button.active{background:#1e3b2f;color:#fff;border-color:#1e3b2f}
      .calendar-navs{display:flex;gap:8px;align-items:center}
      .availability-grid{overflow-x:auto;padding-bottom:2px}
      .week-matrix{display:grid;grid-template-columns:64px repeat(7,86px);gap:5px}
      .week-cell,.month-day{border:1px solid rgba(31,42,33,.12);border-radius:12px;background:#fff;min-height:56px;padding:7px 5px;text-align:center;color:#1f2a21}
      .week-head,.week-time{background:#f8f4ea;font-size:12px;font-weight:900;position:sticky;left:0;z-index:1}
      .week-day,.availability-mark,.month-day{cursor:pointer;font-family:inherit}
      .week-day.selected,.availability-mark.selected,.month-day.selected{outline:2px solid #66804e;background:#edf2e7}
      .week-day small,.availability-mark small,.month-day small{display:block;color:#697568;font-size:10px;line-height:1.4}
      .availability-mark span,.month-day span{display:block;font-size:20px;font-weight:900;line-height:1.1}
      .availability-mark.many span,.availability-mark.few span,.month-day.many span,.month-day.few span{color:#2f7a35}
      .availability-mark.full span,.availability-mark.none span,.month-day.full span,.month-day.none span{color:#aaa}
      .availability-mark:disabled,.month-day:disabled{cursor:not-allowed;opacity:.65}
      .month-calendar{display:grid;grid-template-columns:repeat(7,minmax(58px,1fr));gap:6px}
      .month-head{font-size:12px;font-weight:900;text-align:center;color:#697568;padding:4px}
      .month-day.empty{visibility:hidden}
      .safe-note{background:#f8f4ea;border:1px solid rgba(31,42,33,.08);border-radius:14px;padding:10px 12px;color:#52624d;font-size:12px;line-height:1.6;margin:12px 0}
      .slot-generator{display:grid;grid-template-columns:1fr 1fr auto;gap:10px;align-items:end;background:#f8f4ea;border:1px solid rgba(31,42,33,.08);border-radius:16px;padding:12px;margin-bottom:12px}
      .slot-card,.reservation-card{border:1px solid rgba(31,42,33,.1);border-radius:16px;background:#fff;padding:14px;text-align:left}
      .slot-card.soldout{background:#f8eee9}
      .slot-editor{display:grid;grid-template-columns:1fr 1fr 1fr 1fr;gap:8px;margin-top:12px}
      .slot-editor .admin-field input,.slot-editor .admin-field select{padding:8px 9px;font-size:13px}
      .slot-editor-actions{display:flex;gap:8px;align-items:end}
      .reservation-card{cursor:pointer}
      .reservation-card.active{outline:2px solid #66804e}
      .card-row{display:flex;justify-content:space-between;gap:12px;align-items:center}
      .card-title{font-weight:800;color:#1f2a21}
      .card-sub{font-size:12px;color:#697568;margin-top:4px;line-height:1.6}
      .badge{display:inline-flex;border-radius:999px;padding:5px 9px;font-size:12px;font-weight:800;background:#edf2e7;color:#3d5e37}
      .badge.warn{background:#fae4df;color:#8f2d20}
      .detail-lines{display:grid;gap:9px;font-size:14px}
      .detail-lines div{display:flex;justify-content:space-between;gap:14px;border-bottom:1px solid rgba(31,42,33,.08);padding-bottom:8px}
      .detail-lines span:first-child{color:#697568}
      .external-raw{white-space:pre-wrap;max-height:180px;overflow:auto;background:#f8f4ea;border-radius:12px;padding:10px;font-size:12px;color:#3f493d;line-height:1.5;margin:12px 0}
      .empty{color:#74806d;font-size:14px;line-height:1.7}
      @media (max-width:860px){.admin-grid,.admin-controls,.slot-generator,.settings-grid,.slot-editor{grid-template-columns:1fr}.admin-hero h1{font-size:24px}.week-matrix{grid-template-columns:56px repeat(7,74px)}}
    </style>
    <main class="reservation-admin">
      <section class="admin-hero">
        <h1>予約管理</h1>
        <p>予約一覧、予約枠の残数、予約詳細、キャンセルを同じ画面で確認します。APIキーはこのブラウザのセッション中だけ保存します。</p>
      </section>
      ${renderMessage()}
      ${renderControls()}
      ${renderAvailabilityCalendar()}
      <section class="admin-grid">
        <div>
          ${renderSlots()}
          ${renderReservations()}
        </div>
        <aside>
          ${renderDetail()}
          ${renderExternalSources()}
        </aside>
      </section>
      ${renderSettings()}
      ${renderAiMcpRoadmap()}
    </main>
  `;
  bindEvents();
}

function renderMessage(): string {
  if (state.error) return `<div class="admin-message error">${escapeHtml(state.error)}</div>`;
  if (state.message) return `<div class="admin-message ok">${escapeHtml(state.message)}</div>`;
  return '';
}

function renderControls(): string {
  return `
    <section class="admin-panel">
      <div class="admin-controls">
        <div class="admin-field">
          <label for="adminApiKey">管理APIキー</label>
          <input id="adminApiKey" type="password" value="${escapeHtml(state.apiKey)}" placeholder="Bearer token に使うAPIキー" autocomplete="off">
        </div>
        <div class="admin-field">
          <label for="adminDate">日付</label>
          <input id="adminDate" type="date" value="${escapeHtml(state.date)}">
        </div>
        <div class="admin-field">
          <label for="adminResource">リソース</label>
          <select id="adminResource" ${state.resources.length === 0 ? 'disabled' : ''}>
            ${state.resources.length === 0
              ? '<option value="">未取得</option>'
              : state.resources.map((resource) => `<option value="${escapeHtml(resource.id)}" ${resource.id === state.resourceId ? 'selected' : ''}>${escapeHtml(resource.name)}</option>`).join('')}
          </select>
        </div>
        <button class="admin-button" id="reloadReservations" ${state.loading ? 'disabled' : ''}>${state.resources.length ? '更新' : '読込'}</button>
      </div>
    </section>
  `;
}

function renderAvailabilityCalendar(): string {
  return `
    <section class="admin-panel">
      <div class="availability-toolbar">
        <div>
          <h2 class="admin-section-title" style="margin-bottom:4px">枠カレンダー</h2>
          <p class="empty">LIFFと同じ見方でLINE枠の残数を確認します。◎=3枠以上、△=1〜2枠、×=満席、-=未生成/受付不可。</p>
        </div>
        <div class="availability-toggle">
          <button class="${state.viewMode === 'week' ? 'active' : ''}" id="viewWeek">1週間</button>
          <button class="${state.viewMode === 'month' ? 'active' : ''}" id="viewMonth">1か月</button>
        </div>
      </div>
      <div class="calendar-navs" style="margin-bottom:12px">
        <button class="calendar-nav" id="prevCalendar">&lt;</button>
        <strong>${state.viewMode === 'week' ? `${formatDateShort(state.weekStart)}週` : `${parseYmd(state.date).getFullYear()}年${parseYmd(state.date).getMonth() + 1}月`}</strong>
        <button class="calendar-nav" id="nextCalendar">&gt;</button>
      </div>
      ${state.viewMode === 'week' ? renderWeekAvailability() : renderMonthAvailability()}
    </section>
  `;
}

function renderWeekAvailability(): string {
  const dates = Array.from({ length: 7 }, (_, index) => addDaysYmd(state.weekStart, index));
  const times = Array.from(new Set(
    dates.flatMap((date) => (state.slotsByDate[date] ?? []).map((slot) => formatTime(slot.startAt))),
  )).sort();
  return `
    <div class="availability-grid">
      <div class="week-matrix">
        <div class="week-cell week-head">時間</div>
        ${dates.map((date) => `
          <button class="week-cell week-day ${state.date === date ? 'selected' : ''}" data-calendar-date="${escapeHtml(date)}">
            ${formatDateShort(date)}<small>${dayLabel(date)}</small>
          </button>
        `).join('')}
        ${times.length === 0 ? '<div class="empty" style="grid-column:1/-1;padding:14px">表示できるslotがありません。先にslot生成を実行してください。</div>' : times.map((time) => `
          <div class="week-cell week-time">${time}</div>
          ${dates.map((date) => {
            const slot = (state.slotsByDate[date] ?? []).find((item) => formatTime(item.startAt) === time);
            if (!slot) return '<div class="week-cell availability-mark none"><span>-</span><small>未生成</small></div>';
            const mark = slotMark([slot]);
            return `
              <button class="week-cell availability-mark ${mark.className} ${state.slots.some((item) => item.id === slot.id) ? 'selected' : ''}" data-calendar-date="${escapeHtml(date)}">
                <span>${mark.mark}</span><small>${escapeHtml(mark.label)}</small>
              </button>
            `;
          }).join('')}
        `).join('')}
      </div>
    </div>
  `;
}

function renderMonthAvailability(): string {
  const date = parseYmd(state.date);
  const first = new Date(date.getFullYear(), date.getMonth(), 1);
  const blanks = first.getDay();
  const dates = monthDates(date.getFullYear(), date.getMonth());
  return `
    <div class="month-calendar">
      ${['日', '月', '火', '水', '木', '金', '土'].map((label) => `<div class="month-head">${label}</div>`).join('')}
      ${Array.from({ length: blanks }, () => '<span class="month-day empty"></span>').join('')}
      ${dates.map((item) => {
        const mark = slotMark(state.slotsByDate[item]);
        return `
          <button class="month-day ${mark.className} ${state.date === item ? 'selected' : ''}" data-calendar-date="${escapeHtml(item)}">
            <strong>${parseYmd(item).getDate()}</strong>
            <span>${mark.mark}</span>
            <small>${escapeHtml(mark.label)}</small>
          </button>
        `;
      }).join('')}
    </div>
  `;
}

function renderSlots(): string {
  const body = state.slots.length
    ? `<div class="slot-list">${state.slots.map(renderSlotCard).join('')}</div>`
    : '<p class="empty">この日付・リソースの予約枠はまだありません。</p>';
  return `
    <section class="admin-panel">
      <h2 class="admin-section-title">予約枠の残数</h2>
      ${renderSlotGenerator()}
      <div class="safe-note">安全制約: 予約が存在するslotは削除しません。総枠は予約済み数+バッファ未満にできず、LINE枠/外部枠も各予約済み数未満にできません。満席は手動sold_outではなく残数0で判定します。</div>
      ${body}
    </section>
  `;
}

function renderSlotGenerator(): string {
  return `
    <div class="slot-generator">
      <div class="admin-field">
        <label for="slotGenerateDateFrom">slot生成開始日</label>
        <input id="slotGenerateDateFrom" type="date" value="${escapeHtml(state.date)}">
      </div>
      <div class="admin-field">
        <label for="slotGenerateDateTo">slot生成終了日</label>
        <input id="slotGenerateDateTo" type="date" value="${escapeHtml(state.date)}">
      </div>
      <button class="admin-button secondary" id="generateSlots" ${state.loading || !state.resourceId ? 'disabled' : ''}>slot生成</button>
    </div>
  `;
}

function renderSlotCard(slot: ReservationSlotWithAvailability): string {
  const availability = slot.availability;
  const soldOut = !availability.available || availability.remainingCapacity <= 0;
  const statusOptions = ['open', 'closed', 'sold_out', 'hidden']
    .map((status) => `<option value="${status}" ${slot.status === status ? 'selected' : ''}>${status}</option>`)
    .join('');
  return `
    <article class="slot-card ${soldOut ? 'soldout' : ''}">
      <div class="card-row">
        <div>
          <div class="card-title">${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</div>
          <div class="card-sub">総予約 ${slot.reservedCount}/${slot.totalCapacity}・LINE ${slot.lineReservedCount}/${slot.lineCapacity ?? '-'}・外部 ${slot.externalReservedCount}/${slot.externalCapacity ?? '-'}</div>
        </div>
        <span class="badge ${soldOut ? 'warn' : ''}">${soldOut ? '満席' : `残 ${availability.remainingCapacity}`}</span>
      </div>
      <div class="slot-editor">
        <div class="admin-field"><label for="slotStatus-${escapeHtml(slot.id)}">状態</label><select id="slotStatus-${escapeHtml(slot.id)}">${statusOptions}</select></div>
        <div class="admin-field"><label for="slotTotal-${escapeHtml(slot.id)}">総枠</label><input id="slotTotal-${escapeHtml(slot.id)}" type="number" value="${slot.totalCapacity}"></div>
        <div class="admin-field"><label for="slotLine-${escapeHtml(slot.id)}">LINE枠</label><input id="slotLine-${escapeHtml(slot.id)}" type="number" value="${slot.lineCapacity ?? ''}" placeholder="空なら総枠"></div>
        <div class="admin-field"><label for="slotExternal-${escapeHtml(slot.id)}">外部枠</label><input id="slotExternal-${escapeHtml(slot.id)}" type="number" value="${slot.externalCapacity ?? ''}" placeholder="空なら総枠"></div>
        <div class="admin-field"><label for="slotBuffer-${escapeHtml(slot.id)}">バッファ</label><input id="slotBuffer-${escapeHtml(slot.id)}" type="number" value="${slot.bufferCapacity}"></div>
        <div class="admin-field" style="grid-column:span 2"><label for="slotNote-${escapeHtml(slot.id)}">メモ</label><input id="slotNote-${escapeHtml(slot.id)}" value="${escapeHtml(slot.note || '')}" placeholder="雨天、貸切など"></div>
        <div class="slot-editor-actions">
          <button class="admin-button secondary update-slot" data-slot-id="${escapeHtml(slot.id)}" ${state.loading ? 'disabled' : ''}>slot保存</button>
        </div>
      </div>
    </article>
  `;
}

function renderReservations(): string {
  const body = state.reservations.length
    ? `<div class="reservation-list">${state.reservations.map(renderReservationCard).join('')}</div>`
    : '<p class="empty">この日の予約はありません。</p>';
  return `
    <section class="admin-panel">
      <h2 class="admin-section-title">予約一覧</h2>
      ${body}
    </section>
  `;
}

function renderReservationCard(reservation: ReservationResponse): string {
  const selected = state.selectedReservation?.id === reservation.id;
  return `
    <article class="reservation-card ${selected ? 'active' : ''}" data-reservation-id="${escapeHtml(reservation.id)}">
      <div class="card-row">
        <div>
          <div class="card-title">${formatTime(reservation.startAt)} ${escapeHtml(reservation.customerName || reservation.title)}</div>
          <div class="card-sub">${escapeHtml(reservation.source)} / ${escapeHtml(reservation.capacityChannel)} / ${reservation.totalPeople}名</div>
        </div>
        <span class="badge ${isActiveReservation(reservation) ? '' : 'warn'}">${escapeHtml(reservation.status)}</span>
      </div>
    </article>
  `;
}

function renderDetail(): string {
  const reservation = state.selectedReservation;
  if (!reservation) {
    return `
      <section class="admin-panel">
        <h2 class="admin-section-title">予約詳細</h2>
        <p class="empty">予約一覧から1件選ぶと詳細が表示されます。</p>
      </section>
    `;
  }

  return `
    <section class="admin-panel">
      <h2 class="admin-section-title">予約詳細</h2>
      <div class="detail-lines">
        <div><span>ID</span><strong>${escapeHtml(reservation.id)}</strong></div>
        <div><span>日時</span><strong>${escapeHtml(reservation.reservationDate)} ${formatTime(reservation.startAt)}-${formatTime(reservation.endAt)}</strong></div>
        <div><span>顧客</span><strong>${escapeHtml(reservation.customerName || '-')}</strong></div>
        <div><span>電話</span><strong>${escapeHtml(reservation.customerPhone || '-')}</strong></div>
        <div><span>人数</span><strong>${reservation.totalPeople}名 大人${reservation.adultCount} / 子ども${reservation.childCount}</strong></div>
        <div><span>状態</span><strong>${escapeHtml(reservation.status)}</strong></div>
        <div><span>在庫チャネル</span><strong>${escapeHtml(reservation.capacityChannel)}</strong></div>
        <div><span>作成元</span><strong>${escapeHtml(reservation.source)}</strong></div>
      </div>
      <div style="margin-top:16px;display:flex;gap:10px;flex-wrap:wrap">
        <button class="admin-button secondary" id="reloadDetail" ${state.loading ? 'disabled' : ''}>詳細を再取得</button>
        <button class="admin-button danger" id="cancelReservation" data-reservation-id="${escapeHtml(reservation.id)}" ${state.loading || !isActiveReservation(reservation) ? 'disabled' : ''}>キャンセル</button>
      </div>
    </section>
  `;
}

function renderExternalSources(): string {
  const body = state.externalSources.length
    ? `<div class="reservation-list">${state.externalSources.map(renderExternalSourceCard).join('')}</div>`
    : '<p class="empty">要確認の外部取り込みはありません。</p>';
  return `
    <section class="admin-panel">
      <h2 class="admin-section-title">外部取り込み 要確認</h2>
      ${body}
    </section>
  `;
}

function renderExternalSourceCard(source: ExternalReservationSourceResponse): string {
  const raw = source.rawText || source.lastError || source.parsedPayload || '';
  return `
    <article class="slot-card">
      <div class="card-row">
        <div>
          <div class="card-title">${escapeHtml(source.source)} / ${escapeHtml(source.eventType)}</div>
          <div class="card-sub">externalId: ${escapeHtml(source.externalId || '-')} / reservationId: ${escapeHtml(source.reservationId || '-')}</div>
        </div>
        <span class="badge warn">${escapeHtml(source.parseStatus)}</span>
      </div>
      ${raw ? `<pre class="external-raw">${escapeHtml(raw).slice(0, 800)}</pre>` : ''}
      <button class="admin-button secondary external-ignore" data-external-source-id="${escapeHtml(source.id)}" ${state.loading ? 'disabled' : ''}>確認済みにする</button>
    </article>
  `;
}

function renderSettings(): string {
  return `
    <section class="admin-panel">
      <h2 class="admin-section-title">マスタ設定・外部連携</h2>
      <div class="settings-grid">
        ${renderResourceSettings()}
        ${renderMenuSettings()}
        ${renderScheduleSettings()}
      </div>
    </section>
  `;
}

function renderResourceSettings(): string {
  const resources = state.resources.length
    ? state.resources.map(renderResourceEditor).join('')
    : '<p class="empty">resource未登録です。</p>';
  return `
    <article class="settings-card">
      <h3 class="admin-section-title">Resource</h3>
      <div class="settings-form">
        <div class="admin-field"><label for="resourceName">名前</label><input id="resourceName" placeholder="ブルーベリー摘み取り"></div>
        <div class="admin-field"><label for="resourceDescription">説明</label><input id="resourceDescription" placeholder="管理用メモ"></div>
        <div class="admin-field"><label for="resourceDuration">標準時間 分</label><input id="resourceDuration" type="number" value="60"></div>
        <div class="admin-field"><label for="resourceCapacity">総枠</label><input id="resourceCapacity" type="number" value="20"></div>
        <div class="admin-field"><label for="resourceLineCapacity">LINE枠</label><input id="resourceLineCapacity" type="number" placeholder="空なら総枠"></div>
        <div class="admin-field"><label for="resourceExternalCapacity">外部枠</label><input id="resourceExternalCapacity" type="number" placeholder="空なら総枠"></div>
        <div class="admin-field"><label for="resourceSlotInterval">slot間隔 分</label><input id="resourceSlotInterval" type="number" value="60"></div>
        <div class="admin-field"><label for="resourceGoogleConnectionId">Google connection ID</label><input id="resourceGoogleConnectionId" placeholder="OAuth後に表示されるID"></div>
        <button class="admin-button" id="createResource" ${state.loading ? 'disabled' : ''}>resource作成</button>
      </div>
      <div class="settings-list">${resources}</div>
      <div class="settings-form" style="margin-top:14px">
        <div class="admin-field"><label for="googleCalendarId">Google Calendar ID</label><input id="googleCalendarId" value="primary"></div>
        <button class="admin-button secondary" id="startGoogleOAuth" ${state.loading ? 'disabled' : ''}>Google Calendar接続開始</button>
      </div>
    </article>
  `;
}

function renderResourceEditor(item: ReservationResource): string {
  return `
    <div class="settings-editor">
      <label class="check-row"><input id="resourceActive-${escapeHtml(item.id)}" type="checkbox" ${item.isActive ? 'checked' : ''}>有効</label>
      <div class="admin-field"><label for="resourceName-${escapeHtml(item.id)}">名前</label><input id="resourceName-${escapeHtml(item.id)}" value="${escapeHtml(item.name)}"></div>
      <div class="admin-field"><label for="resourceDescription-${escapeHtml(item.id)}">説明</label><input id="resourceDescription-${escapeHtml(item.id)}" value="${escapeHtml(item.description || '')}"></div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="resourceDuration-${escapeHtml(item.id)}">標準時間</label><input id="resourceDuration-${escapeHtml(item.id)}" type="number" value="${item.defaultDurationMinutes}"></div>
        <div class="admin-field"><label for="resourceCapacity-${escapeHtml(item.id)}">総枠</label><input id="resourceCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultCapacity}"></div>
      </div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="resourceLineCapacity-${escapeHtml(item.id)}">LINE枠</label><input id="resourceLineCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultLineCapacity ?? ''}"></div>
        <div class="admin-field"><label for="resourceExternalCapacity-${escapeHtml(item.id)}">外部枠</label><input id="resourceExternalCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultExternalCapacity ?? ''}"></div>
      </div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="resourceBufferCapacity-${escapeHtml(item.id)}">バッファ</label><input id="resourceBufferCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultBufferCapacity}"></div>
        <div class="admin-field"><label for="resourceSlotInterval-${escapeHtml(item.id)}">slot間隔</label><input id="resourceSlotInterval-${escapeHtml(item.id)}" type="number" value="${item.slotIntervalMinutes}"></div>
      </div>
      <div class="admin-field"><label for="resourceGoogleConnectionId-${escapeHtml(item.id)}">Google connection ID</label><input id="resourceGoogleConnectionId-${escapeHtml(item.id)}" value="${escapeHtml(item.googleCalendarConnectionId || '')}"></div>
      <button class="admin-button secondary update-resource" data-resource-id="${escapeHtml(item.id)}" ${state.loading ? 'disabled' : ''}>resource保存</button>
    </div>
  `;
}

function renderMenuSettings(): string {
  const menus = state.menus.length
    ? state.menus.map(renderMenuEditor).join('')
    : '<p class="empty">選択中resourceのmenuはありません。</p>';
  return `
    <article class="settings-card">
      <h3 class="admin-section-title">Menu</h3>
      <div class="settings-form">
        <div class="admin-field"><label for="menuName">名前</label><input id="menuName" placeholder="食べ放題60分"></div>
        <div class="admin-field"><label for="menuDescription">説明</label><input id="menuDescription" placeholder="LIFF表示用説明"></div>
        <div class="admin-field"><label for="menuDuration">所要時間 分</label><input id="menuDuration" type="number" value="60"></div>
        <div class="admin-field"><label for="menuMinPeople">最小人数</label><input id="menuMinPeople" type="number" value="1"></div>
        <div class="admin-field"><label for="menuMaxPeople">最大人数</label><input id="menuMaxPeople" type="number" placeholder="空なら制限なし"></div>
        <div class="admin-field"><label for="menuPriceAdult">大人料金</label><input id="menuPriceAdult" type="number" placeholder="例 2000"></div>
        <div class="admin-field"><label for="menuPriceChild">子ども料金</label><input id="menuPriceChild" type="number" placeholder="例 1000"></div>
        <button class="admin-button" id="createMenu" ${state.loading || !state.resourceId ? 'disabled' : ''}>menu作成</button>
      </div>
      <div class="settings-list">${menus}</div>
    </article>
  `;
}

function renderMenuEditor(item: ReservationMenu): string {
  return `
    <div class="settings-editor">
      <label class="check-row"><input id="menuActive-${escapeHtml(item.id)}" type="checkbox" ${item.isActive ? 'checked' : ''}>有効</label>
      <div class="admin-field"><label for="menuName-${escapeHtml(item.id)}">名前</label><input id="menuName-${escapeHtml(item.id)}" value="${escapeHtml(item.name)}"></div>
      <div class="admin-field"><label for="menuDescription-${escapeHtml(item.id)}">説明</label><input id="menuDescription-${escapeHtml(item.id)}" value="${escapeHtml(item.description || '')}"></div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="menuDuration-${escapeHtml(item.id)}">所要時間</label><input id="menuDuration-${escapeHtml(item.id)}" type="number" value="${item.durationMinutes}"></div>
        <div class="admin-field"><label for="menuMinPeople-${escapeHtml(item.id)}">最小人数</label><input id="menuMinPeople-${escapeHtml(item.id)}" type="number" value="${item.minPeople}"></div>
      </div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="menuMaxPeople-${escapeHtml(item.id)}">最大人数</label><input id="menuMaxPeople-${escapeHtml(item.id)}" type="number" value="${item.maxPeople ?? ''}"></div>
        <div class="admin-field"><label for="menuPriceAdult-${escapeHtml(item.id)}">大人料金</label><input id="menuPriceAdult-${escapeHtml(item.id)}" type="number" value="${item.priceAdult ?? ''}"></div>
      </div>
      <div class="admin-field"><label for="menuPriceChild-${escapeHtml(item.id)}">子ども料金</label><input id="menuPriceChild-${escapeHtml(item.id)}" type="number" value="${item.priceChild ?? ''}"></div>
      <button class="admin-button secondary update-menu" data-menu-id="${escapeHtml(item.id)}" ${state.loading ? 'disabled' : ''}>menu保存</button>
    </div>
  `;
}

function renderScheduleSettings(): string {
  const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
  const schedules = state.schedules.length
    ? state.schedules.map((item) => renderScheduleEditor(item, dayLabels)).join('')
    : '<p class="empty">選択中resourceのscheduleはありません。</p>';
  return `
    <article class="settings-card">
      <h3 class="admin-section-title">Schedule</h3>
      <div class="settings-form">
        <div class="admin-field">
          <label for="scheduleDayOfWeek">曜日</label>
          <select id="scheduleDayOfWeek">
            ${dayLabels.map((label, index) => `<option value="${index}">${label}</option>`).join('')}
          </select>
        </div>
        <div class="admin-field"><label for="scheduleStartTime">開始</label><input id="scheduleStartTime" type="time" value="09:00"></div>
        <div class="admin-field"><label for="scheduleEndTime">終了</label><input id="scheduleEndTime" type="time" value="15:00"></div>
        <div class="admin-field"><label for="scheduleSlotInterval">slot間隔 分</label><input id="scheduleSlotInterval" type="number" value="60"></div>
        <div class="admin-field"><label for="scheduleCapacity">総枠</label><input id="scheduleCapacity" type="number" value="20"></div>
        <div class="admin-field"><label for="scheduleLineCapacity">LINE枠</label><input id="scheduleLineCapacity" type="number" placeholder="空なら総枠"></div>
        <div class="admin-field"><label for="scheduleExternalCapacity">外部枠</label><input id="scheduleExternalCapacity" type="number" placeholder="空なら総枠"></div>
        <div class="admin-field"><label for="scheduleBufferCapacity">バッファ</label><input id="scheduleBufferCapacity" type="number" value="0"></div>
        <button class="admin-button" id="createSchedule" ${state.loading || !state.resourceId ? 'disabled' : ''}>schedule作成</button>
      </div>
      <div class="settings-list">${schedules}</div>
    </article>
  `;
}

function renderScheduleEditor(item: ReservationSchedule, dayLabels: string[]): string {
  return `
    <div class="settings-editor">
      <label class="check-row"><input id="scheduleActive-${escapeHtml(item.id)}" type="checkbox" ${item.isActive ? 'checked' : ''}>有効</label>
      <div class="admin-field">
        <label for="scheduleDayOfWeek-${escapeHtml(item.id)}">曜日</label>
        <select id="scheduleDayOfWeek-${escapeHtml(item.id)}">
          ${dayLabels.map((label, index) => `<option value="${index}" ${item.dayOfWeek === index ? 'selected' : ''}>${label}</option>`).join('')}
        </select>
      </div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="scheduleStartTime-${escapeHtml(item.id)}">開始</label><input id="scheduleStartTime-${escapeHtml(item.id)}" type="time" value="${escapeHtml(item.startTime)}"></div>
        <div class="admin-field"><label for="scheduleEndTime-${escapeHtml(item.id)}">終了</label><input id="scheduleEndTime-${escapeHtml(item.id)}" type="time" value="${escapeHtml(item.endTime)}"></div>
      </div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="scheduleSlotInterval-${escapeHtml(item.id)}">slot間隔</label><input id="scheduleSlotInterval-${escapeHtml(item.id)}" type="number" value="${item.slotIntervalMinutes}"></div>
        <div class="admin-field"><label for="scheduleCapacity-${escapeHtml(item.id)}">総枠</label><input id="scheduleCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultCapacity}"></div>
      </div>
      <div class="settings-editor-row">
        <div class="admin-field"><label for="scheduleLineCapacity-${escapeHtml(item.id)}">LINE枠</label><input id="scheduleLineCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultLineCapacity ?? ''}"></div>
        <div class="admin-field"><label for="scheduleExternalCapacity-${escapeHtml(item.id)}">外部枠</label><input id="scheduleExternalCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultExternalCapacity ?? ''}"></div>
      </div>
      <div class="admin-field"><label for="scheduleBufferCapacity-${escapeHtml(item.id)}">バッファ</label><input id="scheduleBufferCapacity-${escapeHtml(item.id)}" type="number" value="${item.defaultBufferCapacity}"></div>
      <button class="admin-button secondary update-schedule" data-schedule-id="${escapeHtml(item.id)}" ${state.loading ? 'disabled' : ''}>schedule保存</button>
    </div>
  `;
}

function renderAiMcpRoadmap(): string {
  return `
    <section class="ai-roadmap">
      <h2 class="admin-section-title">AI / MCPチャット操作の拡張予定</h2>
      <p class="empty">ClaudeまたはGPT APIからMCP toolを叩くチャットUIは、次段階で追加する。画面は「自然文入力 → MCP dry-run → 差分確認 → execute=trueで実行」の順にし、予約作成・キャンセル・slot生成は必ず既存Worker APIの不変条件を通す。</p>
    </section>
  `;
}

function bindEvents(): void {
  document.getElementById('adminApiKey')?.addEventListener('change', (event) => {
    const value = event.target instanceof HTMLInputElement ? event.target.value.trim() : '';
    state.apiKey = value;
    saveSessionApiKey(value);
  });
  document.getElementById('adminDate')?.addEventListener('change', (event) => {
    state.date = event.target instanceof HTMLInputElement ? event.target.value : state.date;
    state.weekStart = startOfWeekYmd(state.date);
  });
  document.getElementById('adminResource')?.addEventListener('change', (event) => {
    state.resourceId = event.target instanceof HTMLSelectElement ? event.target.value : state.resourceId;
    state.slotsByDate = {};
    state.slots = [];
  });
  document.getElementById('viewWeek')?.addEventListener('click', () => {
    state.viewMode = 'week';
    state.weekStart = startOfWeekYmd(state.date);
    void refresh();
  });
  document.getElementById('viewMonth')?.addEventListener('click', () => {
    state.viewMode = 'month';
    void refresh();
  });
  document.getElementById('prevCalendar')?.addEventListener('click', () => {
    if (state.viewMode === 'week') {
      state.weekStart = addDaysYmd(state.weekStart, -7);
      state.date = state.weekStart;
    } else {
      const date = parseYmd(state.date);
      date.setMonth(date.getMonth() - 1, 1);
      state.date = toYmd(date);
      state.weekStart = startOfWeekYmd(state.date);
    }
    void refresh();
  });
  document.getElementById('nextCalendar')?.addEventListener('click', () => {
    if (state.viewMode === 'week') {
      state.weekStart = addDaysYmd(state.weekStart, 7);
      state.date = state.weekStart;
    } else {
      const date = parseYmd(state.date);
      date.setMonth(date.getMonth() + 1, 1);
      state.date = toYmd(date);
      state.weekStart = startOfWeekYmd(state.date);
    }
    void refresh();
  });
  document.querySelectorAll<HTMLElement>('[data-calendar-date]').forEach((element) => {
    element.addEventListener('click', () => {
      const date = element.dataset.calendarDate;
      if (!date) return;
      state.date = date;
      state.weekStart = startOfWeekYmd(date);
      void refresh();
    });
  });
  document.getElementById('reloadReservations')?.addEventListener('click', () => {
    const apiKey = document.getElementById('adminApiKey');
    if (apiKey instanceof HTMLInputElement) {
      state.apiKey = apiKey.value.trim();
      saveSessionApiKey(state.apiKey);
    }
    void (state.resources.length ? refresh() : loadInitial());
  });
  document.getElementById('generateSlots')?.addEventListener('click', () => {
    void generateSlots();
  });
  document.querySelectorAll<HTMLElement>('.update-slot[data-slot-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = element.dataset.slotId;
      if (id) void updateSlotFromCard(id);
    });
  });
  document.getElementById('createResource')?.addEventListener('click', () => {
    void createResourceFromForm();
  });
  document.querySelectorAll<HTMLElement>('.update-resource[data-resource-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = element.dataset.resourceId;
      if (id) void updateResourceFromCard(id);
    });
  });
  document.getElementById('createMenu')?.addEventListener('click', () => {
    void createMenuFromForm();
  });
  document.querySelectorAll<HTMLElement>('.update-menu[data-menu-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = element.dataset.menuId;
      if (id) void updateMenuFromCard(id);
    });
  });
  document.getElementById('createSchedule')?.addEventListener('click', () => {
    void createScheduleFromForm();
  });
  document.querySelectorAll<HTMLElement>('.update-schedule[data-schedule-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = element.dataset.scheduleId;
      if (id) void updateScheduleFromCard(id);
    });
  });
  document.getElementById('startGoogleOAuth')?.addEventListener('click', () => {
    void startGoogleCalendarOAuth();
  });
  document.querySelectorAll<HTMLElement>('[data-reservation-id]').forEach((element) => {
    if (element.id === 'cancelReservation') return;
    element.addEventListener('click', () => {
      const id = element.dataset.reservationId;
      if (id) void selectReservation(id);
    });
  });
  document.getElementById('reloadDetail')?.addEventListener('click', () => {
    if (state.selectedReservation) void selectReservation(state.selectedReservation.id);
  });
  document.getElementById('cancelReservation')?.addEventListener('click', (event) => {
    const target = event.currentTarget;
    const id = target instanceof HTMLElement ? target.dataset.reservationId : '';
    if (id) void cancelReservation(id);
  });
  document.querySelectorAll<HTMLElement>('[data-external-source-id]').forEach((element) => {
    element.addEventListener('click', () => {
      const id = element.dataset.externalSourceId;
      if (id) void markExternalSourceIgnored(id);
    });
  });
}

export function initReservationsAdmin(): void {
  document.title = '予約管理 | LINE Harness';
  render();
  if (state.apiKey) {
    void loadInitial();
  }
}
