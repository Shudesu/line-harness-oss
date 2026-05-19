import { addDays, dateToString, formatDateJa, formatTime, isPastDate } from './date.js';
import { escapeHtml } from './html.js';
import { capacityCountLabels } from './people.js';
import { calculateEstimatedTotal, formatYen, hasAnyMenuPrice, hasPrice } from './pricing.js';
import { capacityPeople, selectedMenu, selectedResource, state, totalPeople } from './state.js';
import { tokenForReservation } from './tokens.js';
import type { AvailabilitySummary, Menu, Slot } from './types.js';

function lineRemaining(slot: Slot): number {
  const value = Number(slot.lineRemainingCapacity);
  return Number.isFinite(value) ? Math.max(0, value) : 0;
}

function selectedSlotRemaining(): number | null {
  return state.selectedSlot ? lineRemaining(state.selectedSlot) : null;
}

function requiredBadge(): string {
  return '<span class="required-badge">必須</span>';
}

function validationError(field: string): string {
  const message = state.validationErrors[field];
  return message ? `<p class="field-error" data-validation="${escapeHtml(field)}">${escapeHtml(message)}</p>` : '';
}

function summaryMark(summary: AvailabilitySummary | undefined): { mark: string; className: string; label: string } {
  if (!summary || summary.slotCount === 0) return { mark: '-', className: 'none', label: '営業外' };
  if (summary.available) return { mark: '◎', className: 'many', label: '予約可' };
  return { mark: '×', className: 'full', label: '満席' };
}

function slotMark(slot: Slot): { mark: string; className: string; label: string } {
  const remaining = lineRemaining(slot);
  if (slot.available && remaining >= 3) return { mark: '◎', className: 'many', label: `残り${remaining}名` };
  if (slot.available && remaining >= 1) return { mark: '△', className: 'few', label: `残り${remaining}名` };
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

function renderMenuPriceSummary(menu: Menu | null | undefined): string {
  if (!hasAnyMenuPrice(menu) || !menu) {
    return '<p class="price-note">料金は当日・現地でご確認ください。</p>';
  }
  const rows = [
    hasPrice(menu.priceAdult) ? `大人 ${formatYen(menu.priceAdult)}` : null,
    hasPrice(menu.priceChild) ? `小学生 ${formatYen(menu.priceChild)}` : null,
    hasPrice(menu.priceInfant) ? `幼児 ${formatYen(menu.priceInfant)}` : null,
    hasPrice(menu.priceUnderThree) ? `3歳以下 ${formatYen(menu.priceUnderThree)}` : null,
  ].filter(Boolean);
  return `<div class="price-chips" aria-label="料金単価">${rows.map((row) => `<span>${escapeHtml(row ?? '')}</span>`).join('')}</div>`;
}

function renderPriceEstimate(menu: Menu | null | undefined, counts: { adultCount: number; childCount: number; infantCount: number; underThreeCount: number }, compact = false): string {
  if (!hasAnyMenuPrice(menu)) return '';
  const total = calculateEstimatedTotal(menu, counts);
  if (total === null) {
    return `
      <div class="price-estimate ${compact ? 'compact' : ''}" data-price-estimate>
        <span>合計金額</span>
        <strong data-price-total>現地確認</strong>
        <small>未設定の料金区分があるため、合計は表示していません。</small>
      </div>
    `;
  }
  return `
    <div class="price-estimate ${compact ? 'compact' : ''}" data-price-estimate>
      <span>合計金額</span>
      <strong data-price-total>${formatYen(total)}</strong>
    </div>
  `;
}

function menuForReservationTitle(title?: string | null): Menu | null {
  if (!title) return null;
  return state.menus.find((menu) => menu.name === title) ?? null;
}

export function renderHeader(): string {
  const tabs = state.entryMode === 'web'
    ? `
    <div class="booking-tabs two-tabs">
      <button type="button" class="${state.screen === 'booking' || state.screen === 'confirm' || state.screen === 'success' ? 'active' : ''}" data-action="show-booking">予約</button>
      <button type="button" class="${state.screen === 'cafe' ? 'active' : ''}" data-action="show-cafe">カフェ</button>
    </div>
  `
    : `
    <div class="booking-tabs three-tabs">
      <button type="button" class="${state.screen === 'booking' || state.screen === 'confirm' || state.screen === 'success' ? 'active' : ''}" data-action="show-booking">予約する</button>
      <button type="button" class="${state.screen === 'mine' || state.screen === 'detail' || state.screen === 'cancel-confirm' || state.screen === 'cancelled' ? 'active' : ''}" data-action="show-mine">予約確認</button>
      <button type="button" class="${state.screen === 'cafe' ? 'active' : ''}" data-action="show-cafe">カフェ</button>
    </div>
  `;
  return `
    <div class="booking-header">
      <img class="booking-header-logo" src="/aonisai/aonisai1.jpg" alt="アオニサイファーム ブルーベリー">
      <div class="booking-header-copy">
        <p class="eyebrow">AONISAI FARM</p>
        <h1>体験予約</h1>
      </div>
    </div>
    ${tabs}
  `;
}

export function renderScreen(): string {
  if (state.screen === 'cafe') return renderCafe();
  if (state.screen === 'confirm') return renderConfirm();
  if (state.screen === 'success') return renderSuccess();
  if (state.screen === 'mine') return renderMine();
  if (state.screen === 'detail') return renderReservationDetail();
  if (state.screen === 'cancel-confirm') return renderCancelConfirm();
  if (state.screen === 'cancelled') return renderCancelled();
  return renderBooking();
}

function renderCafe(): string {
  const menuItems = [
    { name: 'ブルーベリーピザ', price: '1,500円', image: '/aonisai/cafe/ブルーベリーピザ.jpg', text: '水牛モッツァレラチーズと無糖ブルーベリーソースの組み合わせ。はちみつをかけて楽しむ、アオニサイカフェらしいデザートピザです。' },
    { name: 'マルゲリータ', price: '1,400円', image: '/aonisai/cafe/マルゲリータ.jpg', text: '水牛モッツァレラチーズとトマトの味を活かした、石窯焼きの定番ピザです。' },
    { name: '近郊農家さんのサラダピザ', price: '1,600円', image: '/aonisai/cafe/サラダピザ.jpg', text: '近郊農家さんの野菜を使った、さっぱり食べられるこだわりピザです。' },
    { name: 'ブルーベリーアイス', price: '700円', image: '/aonisai/cafe/アイス_72.jpg', text: 'オリジナル無糖ブルーベリーソースとバニラアイスを合わせた、摘み取り後にも食べやすいスイーツです。' },
    { name: 'ブルーベリーフィズ', price: '750円', image: '/aonisai/cafe/フィズ_72.jpg', text: 'ブルーベリーづくしの炭酸ドリンク。アルコールは入っていません。' },
    { name: 'ブルーベリースムージー', price: '800円', image: '/aonisai/cafe/ブルーベリースムージー.jpg', text: 'ブルーベリーとヨーグルトを使った、ひんやり濃厚なスムージーです。' },
  ];
  const seats = [
    { name: '店内席', image: '/aonisai/cafe/カフェ内部.jpg' },
    { name: 'テラス席', image: '/aonisai/cafe/カフェ外.jpg' },
    { name: '屋外ソファー席', image: '/aonisai/cafe/ソファー席.jpg' },
  ];
  return `
    <section class="cafe-hero">
      <img src="/aonisai/cafe/カフェ外.jpg" alt="アオニサイカフェ外観">
      <div class="cafe-hero-copy">
        <p class="eyebrow">AONISAI CAFE</p>
        <h2>ブルーベリーと石窯ピザのお店</h2>
        <p>ブルーベリー狩りと一緒に、石窯ピザやブルーベリースイーツを楽しめる併設カフェです。</p>
      </div>
    </section>
    <section class="booking-panel cafe-intro">
      <h2>アオニサイカフェ</h2>
      <p>石窯で焼いたブルーベリーピザや、ブルーベリーを使ったスイーツをご用意しています。隠れ家的な場所で、ゆったりした時間をお過ごしください。</p>
      <p class="policy-note">※カフェはブルーベリーシーズンの6月より営業再開予定です。お越しの際はGoogle Mapで「アオニサイファーム」と検索してください。</p>
    </section>
    <section class="booking-panel">
      <div class="section-title-row">
        <div>
          <h2>おすすめメニュー</h2>
          <p>価格は税込です。内容は変更になる場合があります。</p>
        </div>
      </div>
      <div class="cafe-menu-grid">
        ${menuItems.map((item) => `
          <article class="cafe-menu-card">
            <img src="${escapeHtml(item.image)}" alt="${escapeHtml(item.name)}">
            <div>
              <div class="cafe-menu-title">
                <strong>${escapeHtml(item.name)}</strong>
                <span>${escapeHtml(item.price)}</span>
              </div>
              <p>${escapeHtml(item.text)}</p>
            </div>
          </article>
        `).join('')}
      </div>
    </section>
    <section class="booking-panel">
      <h2>席のご案内</h2>
      <p>店内席・テラス席・屋外ソファー席をご用意しています。ブルーベリー狩りの前後に、家族や友人とゆっくり過ごせます。</p>
      <div class="cafe-seat-grid">
        ${seats.map((seat) => `
          <article class="cafe-seat-card">
            <img src="${escapeHtml(seat.image)}" alt="${escapeHtml(seat.name)}">
            <strong>${escapeHtml(seat.name)}</strong>
          </article>
        `).join('')}
      </div>
    </section>
    <section class="booking-panel cafe-cta">
      <h2>ブルーベリー体験と一緒に</h2>
      <p>体験予約を先に済ませておくと、当日の予定が立てやすくなります。</p>
      <button type="button" class="book-btn" data-action="show-booking">予約画面へ戻る</button>
    </section>
  `;
}

function renderBooking(): string {
  return `
    ${renderBookingControls()}
    ${state.viewMode === 'week' ? renderWeekAvailability() : renderMonthAvailability()}
    ${renderSlotModal()}
    ${state.selectedSlot && !state.slotModalOpen ? renderReopenSelectedSlot() : ''}
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
        メニュー ${requiredBadge()}
        <select data-field="menuId">
          ${state.menus.length === 0 ? '<option value="">メニューがありません</option>' : state.menus.map((item) => `
            <option value="${escapeHtml(item.id)}" ${item.id === state.menuId ? 'selected' : ''}>
              ${escapeHtml(item.name)}
            </option>
          `).join('')}
        </select>
        ${validationError('menuId')}
      </label>
      ${renderMenuPriceSummary(menu)}
      <div class="view-toggle">
        <button type="button" class="${state.viewMode === 'week' ? 'active' : ''}" data-action="view-week">1週間で見る</button>
        <button type="button" class="${state.viewMode === 'month' ? 'active' : ''}" data-action="view-month">1か月で見る</button>
      </div>
    </section>
  `;
}

function renderPeopleStepper(field: 'adultCount' | 'childCount' | 'infantCount' | 'underThreeCount', label: string, value: number): string {
  const menu = selectedMenu();
  const remaining = selectedSlotRemaining();
  const countsForCapacity: Record<typeof field, boolean> = {
    adultCount: menu?.capacityCountAdult ?? true,
    childCount: menu?.capacityCountChild ?? true,
    infantCount: menu?.capacityCountInfant ?? true,
    underThreeCount: menu?.capacityCountUnderThree ?? false,
  };
  const plusDisabled = remaining !== null && countsForCapacity[field] && capacityPeople() >= remaining;
  return `
    <div class="people-stepper">
      <span>${label}</span>
      <div class="stepper-control">
        <button type="button" data-action="people-step" data-field="${field}" data-delta="-1" aria-label="${label}を減らす">−</button>
        <input type="number" min="0" inputmode="numeric" data-field="${field}" value="${value}" aria-label="${label}の人数">
        <button type="button" data-action="people-step" data-field="${field}" data-delta="1" aria-label="${label}を増やす" ${plusDisabled ? 'disabled' : ''}>＋</button>
      </div>
    </div>
  `;
}

function renderPeopleSection(): string {
  const menu = selectedMenu();
  const remaining = selectedSlotRemaining();
  return `
    <section class="booking-panel">
      <h2>人数を入力 ${requiredBadge()}</h2>
      <p class="muted">予約枠を消費する人数: ${escapeHtml(capacityCountLabels())}${remaining !== null ? ` / この時間の空き枠 ${remaining}名` : ''}</p>
      <div class="people-stepper-grid">
        ${renderPeopleStepper('adultCount', '大人', state.form.adultCount)}
        ${renderPeopleStepper('childCount', '小学生', state.form.childCount)}
        ${renderPeopleStepper('infantCount', '幼児', state.form.infantCount)}
        ${renderPeopleStepper('underThreeCount', '3歳以下', state.form.underThreeCount)}
      </div>
      <p class="people-total" data-people-total>合計 ${totalPeople()}名 / 枠消費 ${capacityPeople()}名</p>
      ${validationError('people')}
      ${renderPriceEstimate(menu, state.form, true)}
    </section>
  `;
}

function renderWeekAvailability(): string {
  const days = Array.from({ length: 7 }, (_, index) => addDays(state.weekStart, index));

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
      <div class="month-grid week-date-grid">
        ${days.map((day) => {
          const date = dateToString(day);
          const mark = summaryMark(state.availabilityByDate[date]);
          const disabled = isPastDate(date);
          return `
            <button type="button" class="month-day ${mark.className} ${state.selectedDate === date ? 'selected' : ''}" ${disabled ? 'disabled' : `data-action="select-date" data-date="${date}"`}>
              <strong>${day.getMonth() + 1}/${day.getDate()}</strong>
              <span>${disabled ? '-' : mark.mark}</span>
              <small>${disabled ? '終了' : escapeHtml(mark.label)}</small>
            </button>
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
          const mark = summaryMark(state.availabilityByDate[date]);
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

function renderSlotModal(): string {
  if (!state.slotModalOpen || !state.selectedDate) {
    return validationError('slot') ? `
      <section class="booking-panel compact-alert">
        ${validationError('slot')}
      </section>
    ` : '';
  }

  if (state.selectedSlot) {
    return renderReservationInputModal(state.selectedSlot);
  }

  const slots = state.slotsByDate[state.selectedDate] ?? [];
  if (state.loadingSlots && slots.length === 0) {
    return `
      <div class="booking-modal-backdrop" data-action="close-slot-modal">
        <section class="booking-modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div>
              <h2>${formatDateJa(state.selectedDate)}</h2>
              <p>時間枠を確認中...</p>
            </div>
            <button type="button" class="modal-close" data-action="close-slot-modal">×</button>
          </div>
          <div class="slots-loading"><div class="loading-spinner"></div><p>時間枠を確認中...</p></div>
        </section>
      </div>
    `;
  }
  if (slots.length === 0) {
    return `
      <div class="booking-modal-backdrop" data-action="close-slot-modal">
        <section class="booking-modal" role="dialog" aria-modal="true">
          <div class="modal-header">
            <div>
              <h2>${formatDateJa(state.selectedDate)}</h2>
              <p>この日は予約枠がありません。</p>
            </div>
            <button type="button" class="modal-close" data-action="close-slot-modal">×</button>
          </div>
          <button type="button" class="close-btn" data-action="close-slot-modal">日付を選び直す</button>
        </section>
      </div>
    `;
  }

  return `
    <div class="booking-modal-backdrop" data-action="close-slot-modal">
    <section class="booking-modal" role="dialog" aria-modal="true">
      <div class="modal-header">
        <div>
          <h2>${formatDateJa(state.selectedDate)}の時間</h2>
          <p>時間枠を選ぶと、人数と受付情報の入力に進みます。</p>
        </div>
        <button type="button" class="modal-close" data-action="close-slot-modal">×</button>
      </div>
      <p class="capacity-note">空き枠は「${escapeHtml(capacityCountLabels())}」をもとに計算します。3歳以下など枠を消費しない人数区分は、管理設定に従って予約枠から除外されます。</p>
      ${validationError('slot')}
      <div class="slots-grid">
        ${slots.map((slot) => {
          const mark = slotMark(slot);
          return `
            <button type="button" class="slot-btn ${slot.available ? 'available' : 'full'} ${state.selectedSlot?.slotId === slot.slotId ? 'selected' : ''}" ${slot.available ? `data-action="select-slot" data-slot-id="${escapeHtml(slot.slotId)}"` : 'disabled'}>
              <strong>${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</strong>
              <span>${mark.mark} ${escapeHtml(mark.label)}</span>
            </button>
          `;
        }).join('')}
      </div>
    </section>
    </div>
  `;
}

function renderReservationInputModal(slot: Slot): string {
  return `
    <div class="booking-modal-backdrop" data-action="close-slot-modal">
      <section class="booking-modal" role="dialog" aria-modal="true">
        <div class="modal-header">
          <div>
            <h2>予約内容を入力</h2>
            <p>${formatDateJa(slot.date)} ${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</p>
          </div>
          <button type="button" class="modal-close" data-action="close-slot-modal">×</button>
        </div>
        <div class="modal-selected-slot">
          <span>選択中の時間枠</span>
          <strong>${formatDateJa(slot.date)} ${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</strong>
          <small>空き枠 ${lineRemaining(slot)}名 / 枠消費対象: ${escapeHtml(capacityCountLabels())}</small>
        </div>
        ${renderPeopleSection()}
        ${renderInputForm()}
        <div class="booking-actions">
          <button type="button" class="book-btn" data-action="go-confirm">予約内容を確認する</button>
        </div>
      </section>
    </div>
  `;
}

function renderReopenSelectedSlot(): string {
  const slot = state.selectedSlot;
  if (!slot) return '';
  return `
    <section class="booking-panel">
      <h2>選択中の予約枠</h2>
      <div class="confirm-row">
        <span class="confirm-label">日時</span>
        <span class="confirm-value">${formatDateJa(slot.date)} ${formatTime(slot.startAt)}-${formatTime(slot.endAt)}</span>
      </div>
      <button type="button" class="book-btn" data-action="select-slot" data-slot-id="${escapeHtml(slot.slotId)}">人数・受付情報を入力する</button>
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
        氏名 ${requiredBadge()}
        <input type="text" data-field="customerName" value="${escapeHtml(state.form.customerName)}">
        ${validationError('customerName')}
      </label>
      <label class="field-label">
        電話番号 ${requiredBadge()}
        <input type="tel" inputmode="tel" data-field="customerPhone" value="${escapeHtml(state.form.customerPhone)}">
        ${validationError('customerPhone')}
      </label>
      <label class="field-label">
        メールアドレス${state.entryMode === 'web' ? ` ${requiredBadge()}` : '（任意）'}
        <input type="email" data-field="customerEmail" value="${escapeHtml(state.form.customerEmail)}">
        ${validationError('customerEmail')}
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
        underThreeCount: state.form.underThreeCount,
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
        underThreeCount: reservation.underThreeCount,
        name: reservation.customerName ?? state.form.customerName,
        phone: reservation.customerPhone ?? state.form.customerPhone,
        email: reservation.customerEmail ?? state.form.customerEmail,
        note: state.form.note,
      })}
      ${renderPriceEstimate(menu, reservation, true)}
      <p class="policy-note">当日は予約時間に合わせてお越しください。予約確認画面から詳細確認とキャンセルができます。</p>
      <div class="booking-actions">
        <button type="button" class="book-btn" data-action="show-created-detail">予約詳細を見る</button>
        <button type="button" class="close-btn" data-action="close">${state.entryMode === 'web' ? '閉じる' : 'LINEに戻る'}</button>
      </div>
    </section>
  `;
}

function renderMine(): string {
  if (state.entryMode === 'web') {
    return `
      <section class="booking-panel">
        <div class="section-title-row">
          <div>
            <h2>予約確認</h2>
            <p>Web予約は、予約IDとメールアドレスで確認できます。</p>
          </div>
        </div>
        ${state.notice ? `<p class="error">${escapeHtml(state.notice)}</p>` : ''}
        <label class="field-label">
          予約ID ${requiredBadge()}
          <input type="text" data-field="lookupReservationId" value="${escapeHtml(state.lookupReservationId)}">
        </label>
        <label class="field-label">
          メールアドレス ${requiredBadge()}
          <input type="email" data-field="lookupEmail" value="${escapeHtml(state.lookupEmail)}">
        </label>
        <button type="button" class="book-btn" data-action="lookup-web-reservation" ${state.loadingSlots ? 'disabled' : ''}>
          ${state.loadingSlots ? '確認中...' : '予約を確認する'}
        </button>
        <button type="button" class="text-btn" data-action="show-booking">新しく予約する</button>
      </section>
    `;
  }
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
      ${state.loadingSlots ? '<div class="slots-loading"><div class="loading-spinner"></div><p>予約を確認中...</p></div>' : state.reservations.length === 0 ? `
        <div class="empty-state">
          <p class="muted">予約はありません。</p>
          <button type="button" class="book-btn" data-action="show-booking">予約する</button>
        </div>
      ` : `
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
        underThreeCount: reservation.underThreeCount,
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
      <p class="policy-note">この予約をキャンセルします。</p>
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
  underThreeCount: number;
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
      <div class="confirm-row"><span class="confirm-label">人数</span><span class="confirm-value">大人${input.adultCount}名 / 小学生${input.childCount}名 / 幼児${input.infantCount}名 / 3歳以下${input.underThreeCount}名</span></div>
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
