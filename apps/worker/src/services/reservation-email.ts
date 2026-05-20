import type { Reservation } from '@line-crm/db';
import { resolveBindingValue, type SecretLike } from './bindings.js';

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

const AONISAI_CAFE_HERO_IMAGE =
  'https://aonisai-blueberry.com/wp-content/themes/aonisai-blueberry/asset/img/features/features_01.jpg';

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

  const fromEmail = await resolveBindingValue(env.RESEND_FROM_EMAIL) || 'onboarding@resend.dev';
  const fromName = await resolveBindingValue(env.RESEND_FROM_NAME) || 'アオニサイファーム予約';
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

  const subject = `【予約受付】${dateLabel} ${formatTime(reservation.start_at)}`;
  const html = `
    <div style="margin:0; padding:0; background:#f4f1ea; font-family:'Hiragino Sans','Yu Gothic',Arial,sans-serif; color:#1f2340;">
      <div style="max-width:640px; margin:0 auto; background:#fbfaf6;">
        <img src="${escapeHtml(AONISAI_CAFE_HERO_IMAGE)}" alt="アオニサイカフェ" style="display:block; width:100%; max-width:640px; height:auto; border:0;">
        <div style="padding:28px 22px 12px; background:#272f72; color:#ffffff;">
          <p style="margin:0 0 8px; font-size:11px; letter-spacing:0.18em; font-weight:700;">AONISAI FARM BLUEBERRY</p>
          <h1 style="margin:0; font-size:24px; line-height:1.35; font-weight:800;">ご予約を受け付けました</h1>
          <p style="margin:12px 0 0; font-size:14px; line-height:1.8; color:#eef1ff;">
            ${escapeHtml(reservation.customer_name_snapshot ?? 'お客様')} 様、アオニサイファーム ブルーベリー観光農園のご予約ありがとうございます。
          </p>
        </div>
        <div style="padding:22px;">
          <div style="border:1px solid #ded8c9; background:#ffffff; padding:18px; margin-bottom:18px;">
            <p style="margin:0 0 12px; color:#272f72; font-size:13px; font-weight:800; letter-spacing:0.08em;">RESERVATION DETAIL</p>
            <table style="border-collapse:collapse; width:100%; font-size:14px; line-height:1.7;">
              <tr>
                <th align="left" style="width:92px; padding:10px 0; color:#6a6f86; border-bottom:1px solid #eee9dd; font-weight:700;">予約番号</th>
                <td style="padding:10px 0; border-bottom:1px solid #eee9dd; color:#1f2340; font-weight:700;">${escapeHtml(reservation.id)}</td>
              </tr>
              <tr>
                <th align="left" style="padding:10px 0; color:#6a6f86; border-bottom:1px solid #eee9dd; font-weight:700;">日時</th>
                <td style="padding:10px 0; border-bottom:1px solid #eee9dd; color:#1f2340; font-weight:700;">${escapeHtml(dateLabel)} ${escapeHtml(timeLabel)}</td>
              </tr>
              <tr>
                <th align="left" style="padding:10px 0; color:#6a6f86; border-bottom:1px solid #eee9dd; font-weight:700;">人数</th>
                <td style="padding:10px 0; border-bottom:1px solid #eee9dd; color:#1f2340;">${escapeHtml(people)}</td>
              </tr>
              <tr>
                <th align="left" style="padding:10px 0; color:#6a6f86; font-weight:700;">電話番号</th>
                <td style="padding:10px 0; color:#1f2340;">${escapeHtml(reservation.customer_phone_snapshot ?? '')}</td>
              </tr>
            </table>
          </div>
          <div style="margin:20px 0;">
            ${detailUrl ? `<a href="${escapeHtml(detailUrl)}" style="display:block; margin:0 0 10px; padding:14px 16px; background:#272f72; color:#ffffff; text-align:center; text-decoration:none; font-size:15px; font-weight:800;">予約内容を確認する</a>` : ''}
            ${cancelUrl ? `<a href="${escapeHtml(cancelUrl)}" style="display:block; margin:0 0 10px; padding:13px 16px; background:#ffffff; color:#9f2d20; border:1px solid #d9b2a7; text-align:center; text-decoration:none; font-size:14px; font-weight:800;">予約をキャンセルする</a>` : ''}
            ${lineClaimUrl ? `<a href="${escapeHtml(lineClaimUrl)}" style="display:block; margin:0 0 10px; padding:13px 16px; background:#06C755; color:#ffffff; text-align:center; text-decoration:none; font-size:14px; font-weight:800;">LINEで予約を確認できるようにする</a>` : ''}
          </div>
          <div style="background:#f2efe7; border-left:4px solid #272f72; padding:14px; margin-top:18px;">
            <p style="margin:0; color:#555b72; font-size:13px; line-height:1.8;">
              変更やキャンセルが必要な場合は、上記リンクをご利用ください。すでにキャンセル済みの場合、リンク先で「キャンセルされています」と表示されます。
            </p>
          </div>
          ${adminUrl ? `<p style="margin:18px 0 0; font-size:11px; color:#8a8f9d;">管理用URL: ${escapeHtml(adminUrl)}</p>` : ''}
        </div>
        <div style="padding:18px 22px; background:#272f72; color:#eef1ff; font-size:12px; line-height:1.7;">
          アオニサイファーム ブルーベリー観光農園<br>
          〒300-2645 茨城県つくば市上郷 2223-1
        </div>
      </div>
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
