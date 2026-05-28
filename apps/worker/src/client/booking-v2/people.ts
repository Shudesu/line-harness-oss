import { getApp } from './html.js';
import { calculateEstimatedTotal, formatYen } from './pricing.js';
import { capacityPeople, selectedMenu, state, totalPeople } from './state.js';

export type PeopleCountField = 'adultCount' | 'childCount' | 'infantCount' | 'underThreeCount';

export function capacityCountLabels(): string {
  const menu = selectedMenu();
  const labels = [
    (menu?.capacityCountAdult ?? true) ? '大人' : null,
    (menu?.capacityCountChild ?? true) ? '小学生' : null,
    (menu?.capacityCountInfant ?? true) ? '幼児' : null,
    (menu?.capacityCountUnderThree ?? false) ? '3歳以下' : null,
  ].filter(Boolean);
  return labels.length > 0 ? labels.join('・') : 'なし';
}

export function clampPeopleToSelectedSlot(changedField: PeopleCountField): void {
  const slot = state.selectedSlot;
  if (!slot) return;
  const remaining = Math.max(0, Number(slot.lineRemainingCapacity) || 0);
  if (capacityPeople() <= remaining) return;

  const menu = selectedMenu();
  const countsForCapacity: Record<PeopleCountField, boolean> = {
    adultCount: menu?.capacityCountAdult ?? true,
    childCount: menu?.capacityCountChild ?? true,
    infantCount: menu?.capacityCountInfant ?? true,
    underThreeCount: menu?.capacityCountUnderThree ?? false,
  };

  if (countsForCapacity[changedField]) {
    state.form[changedField] = Math.max(0, state.form[changedField] - (capacityPeople() - remaining));
  }
  state.notice = '選択した時間枠の空き人数を超えないように人数を調整しました。';
}

export function updatePeopleDom(): void {
  const app = getApp();
  for (const field of ['adultCount', 'childCount', 'infantCount', 'underThreeCount'] as const) {
    const input = app.querySelector<HTMLInputElement>(`input[data-field="${field}"]`);
    if (input && input.value !== String(state.form[field])) input.value = String(state.form[field]);
  }

  const total = app.querySelector<HTMLElement>('[data-people-total]');
  if (total) total.textContent = `合計 ${totalPeople()}名 / 枠消費 ${capacityPeople()}名`;

  app.querySelectorAll('[data-validation="people"]').forEach((element) => element.remove());

  const price = app.querySelector<HTMLElement>('[data-price-total]');
  if (price) {
    const totalPrice = calculateEstimatedTotal(selectedMenu(), state.form);
    price.textContent = totalPrice === null ? '現地確認' : formatYen(totalPrice);
  }

  const menu = selectedMenu();
  const remaining = state.selectedSlot ? Math.max(0, Number(state.selectedSlot.lineRemainingCapacity) || 0) : null;
  const countsForCapacity: Record<PeopleCountField, boolean> = {
    adultCount: menu?.capacityCountAdult ?? true,
    childCount: menu?.capacityCountChild ?? true,
    infantCount: menu?.capacityCountInfant ?? true,
    underThreeCount: menu?.capacityCountUnderThree ?? false,
  };
  for (const field of ['adultCount', 'childCount', 'infantCount', 'underThreeCount'] as const) {
    const plus = app.querySelector<HTMLButtonElement>(`button[data-action="people-step"][data-field="${field}"][data-delta="1"]`);
    if (plus && remaining !== null) plus.disabled = countsForCapacity[field] && capacityPeople() >= remaining;
  }
}
