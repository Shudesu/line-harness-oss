import type { ReservationEmailTemplate } from '../email-types.js';
import { escapeHtml } from '../email-types.js';

export const genericReservationEmailTemplate: ReservationEmailTemplate = {
  confirmation({ provider, reservation, urls }) {
    const subject = `【予約受付】${reservation.dateLabel} ${reservation.startTimeLabel}`;
    const html = `
      <div style="margin:0; padding:0; background:${escapeHtml(provider.colors.background)}; font-family:'Hiragino Sans','Yu Gothic',Arial,sans-serif; color:${escapeHtml(provider.colors.text)};">
        <div style="max-width:640px; margin:0 auto; background:#ffffff;">
          ${provider.assets.heroImageUrl ? `<img src="${escapeHtml(provider.assets.heroImageUrl)}" alt="${escapeHtml(provider.shortName)}" style="display:block; width:100%; max-width:640px; height:auto; border:0;">` : ''}
          <div style="padding:28px 22px 12px; background:${escapeHtml(provider.colors.primary)}; color:#ffffff;">
            <p style="margin:0 0 8px; font-size:11px; letter-spacing:0.18em; font-weight:700;">${escapeHtml(provider.name)}</p>
            <h1 style="margin:0; font-size:24px; line-height:1.35; font-weight:800;">ご予約を受け付けました</h1>
            <p style="margin:12px 0 0; font-size:14px; line-height:1.8; color:#f3f6ff;">
              ${escapeHtml(reservation.customerName || 'お客様')} 様、ご予約ありがとうございます。
            </p>
          </div>
          <div style="padding:22px;">
            <div style="border:1px solid #e5e7eb; background:#ffffff; padding:18px; margin-bottom:18px;">
              <p style="margin:0 0 12px; color:${escapeHtml(provider.colors.primary)}; font-size:13px; font-weight:800; letter-spacing:0.08em;">RESERVATION DETAIL</p>
              <table style="border-collapse:collapse; width:100%; font-size:14px; line-height:1.7;">
                <tr><th align="left" style="width:92px; padding:10px 0; color:#6b7280; border-bottom:1px solid #eee; font-weight:700;">予約番号</th><td style="padding:10px 0; border-bottom:1px solid #eee; font-weight:700;">${escapeHtml(reservation.id)}</td></tr>
                <tr><th align="left" style="padding:10px 0; color:#6b7280; border-bottom:1px solid #eee; font-weight:700;">日時</th><td style="padding:10px 0; border-bottom:1px solid #eee; font-weight:700;">${escapeHtml(reservation.dateLabel)} ${escapeHtml(reservation.timeLabel)}</td></tr>
                <tr><th align="left" style="padding:10px 0; color:#6b7280; border-bottom:1px solid #eee; font-weight:700;">人数</th><td style="padding:10px 0; border-bottom:1px solid #eee;">${escapeHtml(reservation.peopleLabel)}</td></tr>
                <tr><th align="left" style="padding:10px 0; color:#6b7280; font-weight:700;">電話番号</th><td style="padding:10px 0;">${escapeHtml(reservation.customerPhone)}</td></tr>
              </table>
            </div>
            <div style="margin:20px 0;">
              ${urls.detailUrl ? `<a href="${escapeHtml(urls.detailUrl)}" style="display:block; margin:0 0 10px; padding:14px 16px; background:${escapeHtml(provider.colors.primary)}; color:#ffffff; text-align:center; text-decoration:none; font-size:15px; font-weight:800;">予約内容を確認する</a>` : ''}
              ${urls.cancelUrl ? `<a href="${escapeHtml(urls.cancelUrl)}" style="display:block; margin:0 0 10px; padding:13px 16px; background:#ffffff; color:#9f2d20; border:1px solid #d9b2a7; text-align:center; text-decoration:none; font-size:14px; font-weight:800;">予約をキャンセルする</a>` : ''}
              ${urls.lineClaimUrl ? `<a href="${escapeHtml(urls.lineClaimUrl)}" style="display:block; margin:0 0 10px; padding:13px 16px; background:#06C755; color:#ffffff; text-align:center; text-decoration:none; font-size:14px; font-weight:800;">LINEで予約を確認できるようにする</a>` : ''}
            </div>
            <div style="background:#f9fafb; border-left:4px solid ${escapeHtml(provider.colors.primary)}; padding:14px; margin-top:18px;">
              <p style="margin:0; color:#4b5563; font-size:13px; line-height:1.8;">変更やキャンセルが必要な場合は、上記リンクをご利用ください。</p>
            </div>
            ${urls.manageUrl ? `<p style="margin:18px 0 0; font-size:11px; color:#8a8f9d;">管理用URL: ${escapeHtml(urls.manageUrl)}</p>` : ''}
          </div>
          <div style="padding:18px 22px; background:${escapeHtml(provider.colors.primary)}; color:#f3f6ff; font-size:12px; line-height:1.7;">
            ${escapeHtml(provider.email.footerText)}
            ${provider.address ? `<br>${escapeHtml(provider.address)}` : ''}
            ${provider.phone ? `<br>${escapeHtml(provider.phone)}` : ''}
          </div>
        </div>
      </div>
    `;
    const text = [
      `${reservation.customerName || 'お客様'} 様`,
      'ご予約を受け付けました。',
      `予約番号: ${reservation.id}`,
      `日時: ${reservation.dateLabel} ${reservation.timeLabel}`,
      `人数: ${reservation.peopleLabel}`,
      urls.detailUrl ? `予約確認: ${urls.detailUrl}` : '',
      urls.cancelUrl ? `キャンセル: ${urls.cancelUrl}` : '',
      urls.lineClaimUrl ? `LINE連携: ${urls.lineClaimUrl}` : '',
      provider.email.footerText,
    ].filter(Boolean).join('\n');
    return { subject, html, text };
  },
};
