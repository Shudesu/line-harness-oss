import type { BookingForm, Menu } from './types.js';

export function formatYen(value: number): string {
  return `${Math.max(0, value).toLocaleString('ja-JP')}円`;
}

export function hasPrice(value: number | null | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

export function hasAnyMenuPrice(menu: Menu | null | undefined): boolean {
  return Boolean(menu && (hasPrice(menu.priceAdult) || hasPrice(menu.priceChild) || hasPrice(menu.priceInfant) || hasPrice(menu.priceUnderThree)));
}

export function calculateEstimatedTotal(menu: Menu | null | undefined, counts: Pick<BookingForm, 'adultCount' | 'childCount' | 'infantCount' | 'underThreeCount'>): number | null {
  if (!hasAnyMenuPrice(menu) || !menu) return null;
  if (counts.adultCount > 0 && !hasPrice(menu.priceAdult)) return null;
  if (counts.childCount > 0 && !hasPrice(menu.priceChild)) return null;
  if (counts.infantCount > 0 && !hasPrice(menu.priceInfant)) return null;
  if (counts.underThreeCount > 0 && !hasPrice(menu.priceUnderThree)) return null;
  return (
    counts.adultCount * (menu.priceAdult ?? 0) +
    counts.childCount * (menu.priceChild ?? 0) +
    counts.infantCount * (menu.priceInfant ?? 0) +
    counts.underThreeCount * (menu.priceUnderThree ?? 0)
  );
}
