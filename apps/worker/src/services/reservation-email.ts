import type { Reservation } from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';

export interface ReservationEmailEnv {
  RESEND_API_KEY?: SecretLike;
  RESEND_FROM_EMAIL?: SecretLike;
  RESEND_FROM_NAME?: SecretLike;
  WORKER_URL?: SecretLike;
  WEB_URL?: SecretLike;
  NEXT_PUBLIC_WEB_URL?: SecretLike;
}

function formatTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function formatDate(value: string): string {
  const date = new Date(`${value}T00:00:00+09:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'short' });
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

async function managementUrl(env: ReservationEmailEnv): Promise<string> {
  return (await resolveBindingValue(env.WEB_URL))
    || (await resolveBindingValue(env.NEXT_PUBLIC_WEB_URL))
    || (await resolveBindingValue(env.WORKER_URL))
    || '';
}

export async function sendWebReservationConfirmationEmail(
  reservation: Reservation,
  env: ReservationEmailEnv,
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

  const fromEmail = await resolveBindingValue(env.RESEND_FROM_EMAIL) || 'onboarding@resend.dev';
  const fromName = await resolveBindingValue(env.RESEND_FROM_NAME) || 'アオニサイファーム予約';
  const adminUrl = await managementUrl(env);
  const people = [
    `大人 ${reservation.adult_count}名`,
    `小学生 ${reservation.child_count}名`,
    `幼児 ${reservation.infant_count}名`,
    `3歳以下 ${reservation.under_three_count ?? 0}名`,
  ].join(' / ');

  const subject = `【予約受付】${formatDate(reservation.reservation_date)} ${formatTime(reservation.start_at)}`;
  const html = `
    <div style="font-family: sans-serif; line-height: 1.7; color: #1f2937;">
      <h1 style="font-size: 20px; color: #2563eb;">ご予約を受け付けました</h1>
      <p>${escapeHtml(reservation.customer_name_snapshot ?? 'お客様')} 様</p>
      <p>アオニサイファーム ブルーベリー観光農園のご予約ありがとうございます。</p>
      <table style="border-collapse: collapse; width: 100%; max-width: 560px;">
        <tr><th align="left">予約番号</th><td>${escapeHtml(reservation.id)}</td></tr>
        <tr><th align="left">日時</th><td>${escapeHtml(formatDate(reservation.reservation_date))} ${escapeHtml(formatTime(reservation.start_at))}〜${escapeHtml(formatTime(reservation.end_at))}</td></tr>
        <tr><th align="left">人数</th><td>${escapeHtml(people)}</td></tr>
        <tr><th align="left">電話番号</th><td>${escapeHtml(reservation.customer_phone_snapshot ?? '')}</td></tr>
      </table>
      <p>変更やキャンセルが必要な場合は、この予約番号を添えてお問い合わせください。</p>
      ${adminUrl ? `<p style="font-size: 12px; color: #6b7280;">管理用URL: ${escapeHtml(adminUrl)}</p>` : ''}
    </div>
  `;

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromEmail}>`,
      to: [to],
      subject,
      html,
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error(`Resend reservation email error ${res.status}: ${text}`);
  }
}
