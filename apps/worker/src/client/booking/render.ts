import { addDays, dateToString, formatDateJa, formatTime, isPastDate } from './date.js';
import { escapeHtml } from './html.js';
import { selectedMenu, selectedResource, state } from './state.js';
import { tokenForReservation } from './tokens.js';
import type { Menu, Slot } from './types.js';

function lineRemaining(slot: Slot): number {
  const value = Number(slot.lineRemainingCapacity);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function availabilityMark(slots: Slot[] | undefined): { mark: string; className: string; label: string } {
  if (!slots || slots.length === 0) return { mark: '-', className: 'none', label: '未生成' };
  const best = Math.max(...slots.map((slot) => slot.available ? lineRemaining(slot) : 0));
  if (best >= 3) return { mark: '◎', className: 'many', label: `残り${best}名` };
  if (best >= 1) return { mark: '△', className: 'few', label: `残り${best}名` };
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

function parseNote(formData?: string | null): string {
  if (!formData) return '';
  try {
    const parsed = JSON.parse(formData) as { note?: unknown };
    return typeof parsed.note === 'string' ? parsed.note : '';
  } catch {
    return '';
  }
}

function formatYen(value: number): string {
  return `${Math.max(0, value).toLocaleString('ja-JP')}円`;
}

function hasPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function hasAnyMenuPrice(menu: Menu | null | undefined): boolean {
  return Boolean(menu && (hasPrice(menu.priceAdult) || hasPrice(menu.priceChild) || hasPrice(menu.priceInfant)));
}

function calculateEstimatedTotal(menu: Menu | null | undefined, counts: { adultCount: number; childCount: number; infantCount: number }): number | null {
  if (!hasAnyMenuPrice(menu)) return null;
  if (!menu) return null;
  if (counts.adultCount > 0 && !hasPrice(menu.priceAdult)) return null;
  if (counts.childCount > 0 && !hasPrice(menu.priceChild)) return null;
  if (counts.infantCount > 0 && !hasPrice(menu.priceInfant)) return null;
  return (
    counts.adultCount * (menu.priceAdult ?? 0) +
    counts.childCount * (menu.priceChild ?? 0) +
    counts.infantCount * (menu.priceInfant ?? 0)
  );
}

function renderMenuPriceSummary(menu: Menu | null | undefined): string {
  if (!hasAnyMenuPrice(menu) || !menu) {
    return '<p class="price-note">料金は当日・現地でご確認ください。</p>';
  }
  const rows = [
    hasPrice(menu.priceAdult) ? `大人 ${formatYen(menu.priceAdult)}` : null,
    hasPrice(menu.priceChild) ? `子ども ${formatYen(menu.priceChild)}` : null,
    hasPrice(menu.priceInfant) ? `幼児 ${formatYen(menu.priceInfant)}` : null,
  ].filter(Boolean);
  return `<div class="price-chips" aria-label="料金単価">${rows.map((row) => `<span>${escapeHtml(row ?? '')}</span>`).join('')}</div>`;
}

function renderPriceEstimate(menu: Menu | null | undefined, counts: { adultCount: number; childCount: number; infantCount: number }, compact = false): string {
  if (!hasAnyMenuPrice(menu)) return '';
  const total = calculateEstimatedTotal(menu, counts);
  if (total === null) {
    return `
      <div class="price-estimate ${compact ? 'compact' : ''}">
        <span>料金目安</span>
        <strong>現地確認</strong>
        <small>未設定の料金区分があるため、合計は表示していません。</small>
      </div>
    `;
  }
  return `
    <div class="price-estimate ${compact ? 'compact' : ''}">
      <span>料金目安</span>
      <strong>${formatYen(total)}</strong>
      <small>実際の請求額はクーポン・現地精算で変わる場合があります。</small>
    </div>
  `;
}

function menuForReservationTitle(title?: string | null): Menu | null {
  if (!title) return null;
  return state.menus.find((menu) => menu.name === title) ?? null;
}

export function renderHeader(): string {
  return `
    <div class="booking-header">
      <img class="booking-header-logo" src="/aonisai/aonisai_blue.jpg" alt="アオニサイファーム ブルーベリー">
      <div class="booking-header-copy">
        <p class="eyebrow">AONISAI FARM</p>
        <h1>ブルーベリー予約</h1>
        <p>日付と時間をえらんで、農園へあそびに行こう。</p>
      </div>
    </div>
    <div class="booking-tabs">
      <button type="button" class="${state.screen === 'booking' || state.screen === 'confirm' || state.screen === 'success' ? 'active' : ''}" data-action="show-booking">予約する</button>
      <button type="button" class="${state.screen === 'mine' || state.screen === 'detail' || state.screen === 'cancel-confirm' || state.screen === 'cancelled' ? 'active' : ''}" data-action="show-mine">予約確認</button>
    </div>
  `;
}

export function renderScreen(): string {
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
    ${state.viewMode === 'month' ? renderSlots() : ''}
    ${renderSelectedSlotSummary()}
    ${renderInputForm()}
    <div class="booking-actions">
      <button type="button" class="book-btn" data-action="go-confirm">予約内容を確認する</button>
    </div>
  `;
}

function renderBookingControls(): string {
  const menu = selectedMenu();
  const resource = selectedResource();
  return `
    <section class="booking-panel">
      <div class="section-title-row">
        <div>
          <h2>予約内容</h2>
          <p>${resource ? `${escapeHtml(resource.name)} / ` : ''}${menu ? escapeHtml(menu.name) : 'メニューを選択してください'}</p>
        </div>
      </div>
      ${state.notice ? `<p class="error">${escapeHtml(state.notice)}</p>` : ''}
      <label class="field-label">
        予約対象
        <select data-field="resourceId">
          ${state.resources.length === 0 ? '<option value="">予約対象がありません</option>' : state.resources.map((item) => `
            <option value="${escapeHtml(item.id)}" ${item.id === state.resourceId ? 'selected' : ''}>
              ${escapeHtml(item.name)}
            </option>
          `).join('')}
        </select>
      </label>
      <label class="field-label">
        メニュー
        <select data-field="menuId">
          ${state.menus.length === 0 ? '<option value="">メニューがありません</option>' : state.menus.map((item) => `
            <option value="${escapeHtml(item.id)}" ${item.id === state.menuId ? 'selected' : ''}>
              ${escapeHtml(item.name)}
            </option>
          `).join('')}
        </select>
      </label>
      ${renderMenuPriceSummary(menu)}
      <div class="people-stepper-grid">
        ${renderPeopleStepper('adultCount', '大人', state.form.adultCount)}
        ${renderPeopleStepper('childCount', '子ども', state.form.childCount)}
        ${renderPeopleStepper('infantCount', '幼児', state.form.infantCount)}
      </div>
      <p class="people-total">合計 ${state.form.adultCount + state.form.childCount + state.form.infantCount}名</p>
      ${renderPriceEstimate(menu, state.form, true)}
      <div class="view-toggle">
        <button type="button" class="${state.viewMode === 'week' ? 'active' : ''}" data-action="view-week">1週間で見る</button>
        <button type="button" class="${state.viewMode === 'month' ? 'active' : ''}" data-action="view-month">1か月で見る</button>
      </div>
    </section>
  `;
}

function renderPeopleStepper(field: 'adultCount' | 'childCount' | 'infantCount', label: string, value: number): string {
  return `
    <div class="people-stepper">
      <span>${label}</span>
      <div class="stepper-control">
        <button type="button" data-action="people-step" data-field="${field}" data-delta="-1" aria-label="${label}を減らす">−</button>
        <input type="number" min="0" inputmode="numeric" data-field="${field}" value="${value}" aria-label="${label}の人数">
        <button type="button" data-action="people-step" data-field="${field}" data-delta="1" aria-label="${label}を増やす">＋</button>
      </div>
    </div>
  `;
}

function renderWeekAvailability(): string {
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));
  const timeLabels = Array.from(new Set(days.flatMap((day) => (state.slotsByDate[dateToString(day)] ?? []).map((slot) => formatTime(slot.startAt))))).sort();

  return `
    <section class="booking-panel availability-panel">
      <div class="calendar-header">
        <button type="button" class="cal-nav" data-action="prev-week">&lt;</button>
        <div>
          <h2>空き状況</h2>
          <p>${formatDateJa(dateToString(days[0]))} から1週間</p>
        </div>
        <button type="button" class="cal-nav" data-action="next-week">&gt;</button>
      </div>
      ${state.loadingSlots ? '<div class="slots-loading"><div class="loading-spinner"></div><p>空き枠を確認中...</p></div>' : ''}
      <div class="week-matrix">
        <div class="week-cell week-head">時間</div>
        ${days.map((day) => `<div class="week-cell week-day">${day.getMonth() + 1}/${day.getDate()}<small>${['日', '月', '火', '水', '木', '金', '土'][day.getDay()]}</small></div>`).join('')}
        ${timeLabels.length === 0 ? '<div class="week-empty">表示できる予約枠がありません</div>' : timeLabels.map((time) => {
          return `
            <div class="week-cell week-time">${time}</div>
            ${days.map((day) => {
              const date = dateToString(day);
              const slot = (state.slotsByDate[date] ?? []).find((item) => formatTime(item.startAt) === time);
              if (!slot) return '<div class="week-cell mark none">-</div>';
              const mark = availabilityMark([slot]);
              return `<button type="button" class="week-cell mark ${mark.className} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-action="select-slot" data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}><span>${mark.mark}</span><small>${escapeHtml(mark.label)}</small></button>`;
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
        <button type="button" class="cal-nav" data-action="prev-month">&lt;</button>
        <div>
          <h2>${state.currentYear}年${state.currentMonth + 1}月</h2>
          <p>日付を押すと時間別の枠を表示します</p>
        </div>
        <button type="button" class="cal-nav" data-action="next-month">&gt;</button>
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
            <button type="button" class="month-day ${mark.className} ${state.selectedDate === date ? 'selected' : ''}" ${disabled ? 'disabled' : `data-action="select-date" data-date="${date}"`}>
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
            <button type="button" class="slot-btn ${slot.available ? 'available' : 'full'} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-action="select-slot" data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}>
              <strong>${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</strong>
              <span>${mark.mark} ${escapeHtml(mark.label)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
  `;
}

function renderSelectedSlotSummary(): string {
  const slot = state.selectedSlot;
  if (!slot) return '';
  return `
    <section class="booking-panel">
      <div class="confirm-row">
        <span class="confirm-label">選択中</span>
        <span class="confirm-value">${formatDateJa(slot.date)} ${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</span>
      </div>
      <div class="confirm-row">
        <span class="confirm-label">予約枠</span>
        <span class="confirm-value">残り${lineRemaining(slot)}名</span>
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
        infantCount: state.form.infantCount,
        name: state.form.customerName,
        phone: state.form.customerPhone,
        email: state.form.customerEmail,
        note: state.form.note,
      })}
      ${renderPriceEstimate(menu, state.form)}
      <p class="policy-note">内容に間違いがなければ予約を確定してください。満席になった場合は確定時にエラーになります。</p>
      <div class="booking-actions split">
        <button type="button" class="close-btn" data-action="back-booking">入力に戻る</button>
        <button type="button" class="book-btn" data-action="submit-booking" ${state.submitting ? 'disabled' : ''}>${state.submitting ? '送信中...' : '予約を確定する'}</button>
      </div>
    </section>
  `;
}

function renderSuccess(): string {
  const reservation = state.lastReservation;
  if (!reservation) return renderError('予約情報を表示できません');
  const menu = selectedMenu();
  return `
    <section class="success-card">
      <div class="success-icon">✓</div>
      <h2>予約を受け付けました</h2>
      <p class="success-message">予約ID: ${escapeHtml(reservation.id)}</p>
      ${renderReservationSummary({
        menuName: menu?.name ?? reservation.title,
        date: reservation.reservationDate,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        adultCount: reservation.adultCount,
        childCount: reservation.childCount,
        infantCount: reservation.infantCount,
        name: reservation.customerName ?? state.form.customerName,
        phone: reservation.customerPhone ?? state.form.customerPhone,
        email: reservation.customerEmail ?? state.form.customerEmail,
        note: state.form.note,
      })}
      ${renderPriceEstimate(menu, reservation, true)}
      <p class="policy-note">当日は予約時間に合わせてお越しください。予約確認画面から詳細確認とキャンセルができます。</p>
      <div class="booking-actions">
        <button type="button" class="book-btn" data-action="show-created-detail">予約詳細を見る</button>
        <button type="button" class="close-btn" data-action="close">LINEに戻る</button>
      </div>
    </section>
  `;
}

function renderMine(): string {
  return `
    <section class="booking-panel">
      <div class="section-title-row">
        <div>
          <h2>予約確認</h2>
          <p>このLINEアカウントで受付中の予約を表示します。</p>
        </div>
        <button type="button" class="mini-btn" data-action="reload-mine">更新</button>
      </div>
      ${state.notice ? `<p class="error">${escapeHtml(state.notice)}</p>` : ''}
      ${state.loadingSlots ? '<div class="slots-loading"><div class="loading-spinner"></div><p>予約を確認中...</p></div>' : ''}
      ${state.reservations.length === 0 ? '<p class="muted">受付中の予約はありません。</p>' : `
        <div class="reservation-list">
          ${state.reservations.map((reservation) => `
            <button type="button" class="reservation-card" data-action="select-reservation" data-reservation-id="${escapeHtml(reservation.id)}">
              <span>${formatDateJa(reservation.reservationDate)} ${formatTime(reservation.startAt)}-${formatTime(reservation.endAt)}</span>
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
  const menu = menuForReservationTitle(reservation.title);
  const tokens = tokenForReservation(reservation.id);
  const canCancel = reservation.status === 'pending' || reservation.status === 'confirmed';
  return `
    <section class="booking-panel">
      <button type="button" class="text-btn" data-action="show-mine">← 予約一覧へ</button>
      <h2>予約詳細</h2>
      ${state.notice ? `<p class="error">${escapeHtml(state.notice)}</p>` : ''}
      ${renderReservationSummary({
        menuName: reservation.title,
        date: reservation.reservationDate,
        startAt: reservation.startAt,
        endAt: reservation.endAt,
        adultCount: reservation.adultCount,
        childCount: reservation.childCount,
        infantCount: reservation.infantCount,
        name: reservation.customerName ?? '',
        phone: reservation.customerPhone ?? '',
        email: reservation.customerEmail ?? '',
        note: parseNote(reservation.formData),
      })}
      ${menu ? renderPriceEstimate(menu, reservation, true) : ''}
      <div class="confirm-row"><span class="confirm-label">状態</span><span class="confirm-value">${statusLabel(reservation.status)}</span></div>
      <div class="confirm-row"><span class="confirm-label">予約ID</span><span class="confirm-value">${escapeHtml(reservation.id)}</span></div>
      ${canCancel ? `
        <button type="button" class="close-btn danger" data-action="${tokens.cancelToken || reservation.cancelToken ? 'go-cancel' : 'issue-tokens'}" ${state.submitting ? 'disabled' : ''}>
          ${tokens.cancelToken || reservation.cancelToken ? 'この予約をキャンセルする' : 'キャンセル用の確認情報を取得する'}
        </button>
      ` : '<p class="muted">この予約はキャンセルできない状態です。</p>'}
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
        <button type="button" class="close-btn" data-action="back-detail">戻る</button>
        <button type="button" class="book-btn danger" data-action="submit-cancel" ${state.submitting ? 'disabled' : ''}>${state.submitting ? '処理中...' : 'キャンセルする'}</button>
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
      <button type="button" class="book-btn" data-action="show-mine">予約確認へ</button>
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
  infantCount: number;
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
      <div class="confirm-row"><span class="confirm-label">人数</span><span class="confirm-value">大人${input.adultCount}名 / 子ども${input.childCount}名 / 幼児${input.infantCount}名</span></div>
      <div class="confirm-row"><span class="confirm-label">氏名</span><span class="confirm-value">${escapeHtml(input.name)}</span></div>
      <div class="confirm-row"><span class="confirm-label">電話</span><span class="confirm-value">${escapeHtml(input.phone)}</span></div>
      ${input.email ? `<div class="confirm-row"><span class="confirm-label">メール</span><span class="confirm-value">${escapeHtml(input.email)}</span></div>` : ''}
      ${input.note ? `<div class="confirm-row"><span class="confirm-label">備考</span><span class="confirm-value">${escapeHtml(input.note)}</span></div>` : ''}
    </div>
  `;
}

export function renderError(message: string): string {
  return `
    <div class="booking-page">
      <div class="card">
        <h2 style="color:#e53e3e;">エラー</h2>
        <p class="error">${escapeHtml(message)}</p>
        <button type="button" class="close-btn" data-action="back-booking" style="margin-top:16px;">予約画面へ戻る</button>
      </div>
    </div>
  `;
}
