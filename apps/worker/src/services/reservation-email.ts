import type { Reservation } from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';
import { resolveProviderConfig } from '../config/provider.js';
import { getReservationEmailTemplate } from '../providers/email-templates.js';
import type { ReservationEmailView } from '../providers/email-types.js';

export interface ReservationEmailEnv {
  RESEND_API_KEY?: SecretLike;
  RESEND_FROM_EMAIL?: SecretLike;
  RESEND_FROM_NAME?: SecretLike;
  WORKER_URL?: SecretLike;
  LIFF_URL?: SecretLike;
  WEB_URL?: SecretLike;
  NEXT_PUBLIC_WEB_URL?: SecretLike;
}

export interface WebReservationEmailLinks {
  detailToken?: string;
  cancelToken?: string;
  claimToken?: string;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Tokyo' });
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short', timeZone: 'Asia/Tokyo' });
}

async function managementUrl(env: ReservationEmailEnv): Promise<string> {
  return (await resolveBindingValue(env.WEB_URL))
    || (await resolveBindingValue(env.NEXT_PUBLIC_WEB_URL))
    || (await resolveBindingValue(env.WORKER_URL))
    || '';
}

async function bookingBaseUrl(env: ReservationEmailEnv): Promise<string> {
  return (await resolveBindingValue(env.WORKER_URL))
    || (await resolveBindingValue(env.LIFF_URL))
    || '';
}

async function liffBaseUrl(env: ReservationEmailEnv): Promise<string> {
  return (await resolveBindingValue(env.LIFF_URL))
    || (await resolveBindingValue(env.WORKER_URL))
    || '';
}

function appendParams(base: string, params: Record<string, string | undefined>): string {
  if (!base) return '';
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value) url.searchParams.set(key, value);
  }
  return url.toString();
}

export async function sendWebReservationConfirmationEmail(
  reservation: Reservation,
  env: ReservationEmailEnv,
  links: WebReservationEmailLinks = {},
): Promise<void> {
  const apiKey = await resolveBindingValue(env.RESEND_API_KEY);
  const to = reservation.customer_email_snapshot?.trim();
  if (!apiKey) {
    console.warn('Web reservation email skipped: RESEND_API_KEY is not configured');
    return;
  }
  if (!to) {
    console.warn(`Web reservation email skipped: reservation ${reservation.id} has no customer_email_snapshot`);
    return;
  }

  const provider = await resolveProviderConfig(env as Parameters<typeof resolveProviderConfig>[0]);
  const fromEmail = await resolveBindingValue(env.RESEND_FROM_EMAIL) || 'onboarding@resend.dev';
  const fromName = await resolveBindingValue(env.RESEND_FROM_NAME) || provider.email.fromName;
  const adminUrl = await managementUrl(env);
  const bookingUrl = await bookingBaseUrl(env);
  const liffUrl = await liffBaseUrl(env);
  const detailUrl = appendParams(bookingUrl, {
    page: 'book',
    mode: 'web',
    screen: 'detail',
    reservationId: reservation.id,
    token: links.detailToken,
  });
  const cancelUrl = links.cancelToken ? appendParams(bookingUrl, {
    page: 'book',
    mode: 'web',
    screen: 'cancel',
    reservationId: reservation.id,
    token: links.cancelToken,
  }) : '';
  const lineClaimUrl = links.claimToken ? appendParams(liffUrl, {
    page: 'book',
    screen: 'claim',
    reservationId: reservation.id,
    claimToken: links.claimToken,
  }) : '';
  const people = [
    `大人 ${reservation.adult_count}名`,
    `小学生 ${reservation.child_count}名`,
    `幼児 ${reservation.infant_count}名`,
    `3歳以下 ${reservation.under_three_count ?? 0}名`,
  ].join(' / ');
  const dateLabel = formatDate(reservation.reservation_date);
  const timeLabel = `${formatTime(reservation.start_at)}〜${formatTime(reservation.end_at)}`;

  const emailView: ReservationEmailView = {
    id: reservation.id,
    customerName: reservation.customer_name_snapshot ?? '',
    customerPhone: reservation.customer_phone_snapshot ?? '',
    customerEmail: to,
    reservationDate: reservation.reservation_date,
    dateLabel,
    startTimeLabel: formatTime(reservation.start_at),
    timeLabel,
    peopleLabel: people,
    adultCount: reservation.adult_count,
    childCount: reservation.child_count,
    infantCount: reservation.infant_count,
    underThreeCount: reservation.under_three_count ?? 0,
  };
  const rendered = getReservationEmailTemplate(provider.id).confirmation({
    provider,
    reservation: emailView,
    urls: {
      detailUrl,
      cancelUrl,
      lineClaimUrl,
      manageUrl: adminUrl,
    },
  });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject: rendered.subject,
      html: rendered.html,
      text: rendered.text,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Resend reservation email error ${res.status}: ${text}`);
  }
}
