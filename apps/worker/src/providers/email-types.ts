import type { ProviderConfig } from './types.js';

export type ReservationEmailView = {
  id: string;
  customerName: string;
  customerPhone: string;
  customerEmail: string;
  reservationDate: string;
  dateLabel: string;
  startTimeLabel: string;
  timeLabel: string;
  peopleLabel: string;
  adultCount: number;
  childCount: number;
  infantCount: number;
  underThreeCount: number;
};

export type ReservationEmailUrls = {
  detailUrl: string;
  cancelUrl: string;
  lineClaimUrl: string;
  manageUrl: string;
};

export type ReservationEmailTemplateInput = {
  provider: ProviderConfig;
  reservation: ReservationEmailView;
  urls: ReservationEmailUrls;
};

export type RenderedReservationEmail = {
  subject: string;
  html: string;
  text: string;
};

export type ReservationEmailTemplate = {
  confirmation(input: ReservationEmailTemplateInput): RenderedReservationEmail;
};

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}
