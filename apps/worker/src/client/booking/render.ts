import { addDays, dateToString, formatDateJa, formatTime, isPastDate } from './date.js';
import { escapeHtml } from './html.js';
import { selectedMenu, selectedResource, state } from './state.js';
import type { Slot } from './types.js';

function availabilityMark(slots: Slot[] | undefined): { mark: string; className: string; label: string } {
  if (!slots || slots.length === 0) return { mark: '-', className: 'none', label: '未生成' };
  const best = Math.max(...slots.map((slot) => slot.available ? slot.lineRemainingCapacity : 0));
  if (best >= 3) return { mark: '◎', className: 'many', label: `残り${best}` };
  if (best >= 1) return { mark: '△', className: 'few', label: `残り${best}` };
  return { mark: '×', className: 'full', label: '満席' };
}

export function renderHeader(): string {
  return `
    <div class="booking-header">
      <p class="eyebrow">Blueberry Farm Reservation</p>
      <h1>ブルーベリー観光農園 予約</h1>
      <p>日付と時間を選んで、内容確認後に予約できます。</p>
    </div>
  `;
}

export function renderScreen(): string {
  if (state.screen === 'confirm') return renderConfirm();
  if (state.screen === 'success') return renderSuccess();
  return renderBooking();
}

function renderBooking(): string {
  return `
    ${renderBookingControls()}
    ${state.viewMode === 'week' ? renderWeekAvailability() : renderMonthAvailability()}
    ${renderSlots()}
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
          <p>${resource ? `${escapeHtml(resource.name)} / ` : ''}${menu ? `${escapeHtml(menu.name)} / ${menu.durationMinutes}分` : 'メニューを選択してください'}</p>
        </div>
      </div>
      ${state.notice ? `<p class="error">${escapeHtml(state.notice)}</p>` : ''}
      <label class="field-label">
        予約対象
        <select data-field="resourceId">
          ${state.resources.length === 0 ? '<option value="">予約対象を読み込み中</option>' : state.resources.map((item) => `
            <option value="${escapeHtml(item.id)}" ${item.id === state.resourceId ? 'selected' : ''}>
              ${escapeHtml(item.name)}
            </option>
          `).join('')}
        </select>
      </label>
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
        <button type="button" class="${state.viewMode === 'week' ? 'active' : ''}" data-action="view-week">1週間で見る</button>
        <button type="button" class="${state.viewMode === 'month' ? 'active' : ''}" data-action="view-month">1か月で見る</button>
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
        ${days.map((day) => `<button type="button" class="week-cell week-day ${state.selectedDate === dateToString(day) ? 'selected' : ''}" data-date="${dateToString(day)}">${day.getMonth() + 1}/${day.getDate()}<small>${['日', '月', '火', '水', '木', '金', '土'][day.getDay()]}</small></button>`).join('')}
        ${timeLabels.length === 0 ? '<div class="week-empty">表示できる予約枠がありません</div>' : timeLabels.map((time) => {
          return `
            <div class="week-cell week-time">${time}</div>
            ${days.map((day) => {
              const date = dateToString(day);
              const slot = (state.slotsByDate[date] ?? []).find((item) => formatTime(item.startAt) === time);
              if (!slot) return '<div class="week-cell mark none">-</div>';
              const mark = availabilityMark([slot]);
              return `<button type="button" class="week-cell mark ${mark.className} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}><span>${mark.mark}</span><small>${escapeHtml(mark.label)}</small></button>`;
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
            <button type="button" class="month-day ${mark.className} ${state.selectedDate === date ? 'selected' : ''}" ${disabled ? 'disabled' : `data-date="${date}"`}>
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
            <button type="button" class="slot-btn ${slot.available ? 'available' : 'full'} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}>
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
        <button type="button" class="close-btn" data-action="back-booking">入力に戻る</button>
        <button type="button" class="book-btn" data-action="submit-booking" ${state.submitting ? 'disabled' : ''}>${state.submitting ? '送信中...' : '予約を確定する'}</button>
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
      <p class="policy-note">当日は予約時間に合わせてお越しください。変更やキャンセルが必要な場合は、LINEから店舗へご連絡ください。</p>
      <div class="booking-actions">
        <button type="button" class="close-btn" data-action="close">LINEに戻る</button>
      </div>
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
