import type { Message } from '@line-crm/line-sdk';
import {
  pushViaHarnessProxy,
  replyViaHarnessProxy,
  type HarnessProxyDispatch,
} from './line-proxy-send.js';
// Use the deployment's existing Harness proxy handler. Do not send credentials
// to a hard-coded third-party instance or bypass proxy delivery logging.
export async function sendGateLineMessage(
  token: string,
  to: string,
  message: unknown,
  options: {
    proxyBaseUrl: string;
    dispatch: HarnessProxyDispatch;
    replyToken?: string;
    deliveryId?: string;
  },
) {
  if (options.replyToken)
    await replyViaHarnessProxy(
      options.proxyBaseUrl,
      token,
      options.replyToken,
      [message as Message],
      options.dispatch,
    );
  else
    await pushViaHarnessProxy(
      options.proxyBaseUrl,
      token,
      to,
      [message as Message],
      options.deliveryId,
      options.dispatch,
    );
}
export interface GateClaimView {
  campaign?: {
    remaining: number | null;
    unlimited: boolean;
    participants: number | null;
    endsAt: string;
  };
  display?: { message: string; rankLabel?: string; remainingLabel?: string };
  followup?: { offer: string; label: string };
  followupAccepted?: boolean;
  followupCoupon?: { label: string; value: string; type: string } | null;
  asks?: string[];
  status: string;
  awardMode?: 'first_come' | 'lottery';
  replyCreatedAt?: number | null;
  tier?: string;
  brandUsername?: string;
  xUsername?: string;
  minAccountAgeDays?: number;
  minFollowers?: number;
  title?: string;
  displayCode?: string;
  replyText?: string;
  postUrl?: string;
  goUrl?: string;
  expiresAt?: string;
  rank?: number | null;
  remaining?: number | null;
  missing?: string[];
  retryAfterSec?: number;
  rejectReason?: string | null;
  reward?: { label: string; type: string; value: string } | null;
}
export function gateStatusText(data: GateClaimView): string {
  if (['won', 'lost', 'rewarded'].includes(data.status) && data.display?.message)
    return data.display.message;
  if (data.status === 'won' || data.status === 'rewarded')
    return `特典が確定しました${data.rank ? '（受付 #' + data.rank + '）' : ''}。${data.reward?.label ?? ''}`;
  if (data.status === 'lost')
    return `${data.rank ? '受付 #' + data.rank + '。' : ''}${data.reward ? '先着枠または抽選の対象外でした。参加賞をご用意しています。' : '今回は特典の対象外でした。'}`;
  if (data.status === 'provisional' || data.status === 'verified')
    return '投稿を確認しました。確認できた投稿を投稿時刻の順で確定しています。';
  if (data.status === 'missing_conditions')
    return data.missing?.includes('follow')
      ? '投稿を確認しました。キャンペーンのアカウントをフォローしてから、もう一度確認してください。'
      : data.missing?.includes('reply_deleted')
        ? '投稿を確認できなくなりました。削除されていないか確認してください。'
        : '参加条件を確認しています。';
  if (data.status === 'pending_verify')
    return '受付済みです。APIの上限または混雑のため、結果の確認を保留しています。';
  if (data.status === 'paused')
    return 'この企画の受付は一時停止しています。受付済みの情報は保持されています。';
  if (data.status === 'ended') return 'このキャンペーンは終了しました。';
  if (data.status === 'expired')
    return '合言葉の期限が切れました。参加ボタンから新しい合言葉を受け取ってください。';
  if (data.rejectReason === 'reply_deleted')
    return '前の投稿を確認できなくなりました。同じ合言葉で投稿し直してください。';
  if (data.rejectReason === 'protected_account')
    return '非公開の投稿は参加条件を確認できません。公開範囲をご確認ください。';
  if (data.rejectReason === 'followers_count')
    return 'フォロワー数がこの企画の参加条件に達していません。';
  if (data.rejectReason === 'account_too_new')
    return `作成から${data.minAccountAgeDays ?? '指定の'}日以上のXアカウントで参加してください。`;
  if (data.rejectReason === 'x_already_used')
    return 'このXアカウントは、このキャンペーンに参加済みです。';
  return '投稿を確認しています。合言葉を変えずに投稿してください。検索への反映に時間がかかる場合があります。';
}
export function gateFlex(gateId: string, data: GateClaimView): unknown {
  const body: any[] = [
    { type: 'text', text: data.title || 'キャンペーン', weight: 'bold', size: 'lg', wrap: true },
    { type: 'text', text: gateStatusText(data), wrap: true, size: 'sm', margin: 'md' },
  ];
  if (
    data.displayCode &&
    !data.replyCreatedAt &&
    !['won', 'lost', 'rewarded', 'ended', 'expired', 'paused'].includes(data.status)
  )
    body.push(
      {
        type: 'text',
        text: data.displayCode,
        weight: 'bold',
        size: 'xl',
        wrap: true,
        margin: 'lg',
      },
      {
        type: 'text',
        text: 'あなただけの合言葉です。他の人には渡さないでください。',
        wrap: true,
        size: 'xs',
        color: '#667085',
      },
    );
  if (data.replyCreatedAt && Number.isFinite(data.replyCreatedAt))
    body.push({
      type: 'text',
      text: `投稿 ${new Date(data.replyCreatedAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST`,
      size: 'xs',
      wrap: true,
      margin: 'md',
    });
  if (data.xUsername && /^[A-Za-z0-9_]{1,15}$/.test(data.xUsername))
    body.push({
      type: 'text',
      text: `確認したXアカウント: @${data.xUsername}`,
      size: 'sm',
      wrap: true,
      margin: 'md',
    });
  if (data.reward)
    body.push(
      { type: 'text', text: data.reward.label, weight: 'bold', wrap: true, margin: 'md' },
      { type: 'text', text: data.reward.value || '詳細をご確認ください', wrap: true },
    );
  if (data.remaining !== null && data.remaining !== undefined)
    body.push({
      type: 'text',
      text: `確定時の残り ${data.remaining} 枠`,
      size: 'xs',
      wrap: true,
      margin: 'md',
    });
  if (data.campaign)
    body.push({
      type: 'text',
      text: campaignStatusText(data.campaign),
      wrap: true,
      size: 'xs',
      margin: 'md',
    });
  if (data.asks?.length)
    body.push({ type: 'text', text: campaignAskText(data), wrap: true, size: 'sm', margin: 'md' });
  const actions: any[] = [];
  if (data.status === 'lost' && data.followup)
    body.push({
      type: 'text',
      text: followupConsentText(data.followup.offer),
      wrap: true,
      size: 'sm',
      margin: 'md',
    });
  if (data.status === 'lost' && data.followup)
    actions.push({
      type: 'button',
      action: {
        type: 'postback',
        label: data.followup.label.slice(0, 20),
        data: `action=xgate_followup&gate=${encodeURIComponent(gateId)}`,
      },
    });
  if (
    data.reward &&
    ['url', 'file'].includes(data.reward.type) &&
    /^https:\/\//.test(data.reward.value)
  )
    actions.push({
      type: 'button',
      style: 'primary',
      action: { type: 'uri', label: '特典を開く', uri: data.reward.value },
    });
  if (
    data.missing?.includes('follow') &&
    data.brandUsername &&
    /^[A-Za-z0-9_]{1,15}$/.test(data.brandUsername)
  )
    actions.push({
      type: 'button',
      style: 'primary',
      action: {
        type: 'uri',
        label: 'Xでフォローを確認する',
        uri: `https://x.com/${data.brandUsername}`,
      },
    });
  if (
    data.goUrl &&
    !data.replyCreatedAt &&
    /^https:\/\//.test(data.goUrl) &&
    !['won', 'lost', 'rewarded', 'ended', 'expired', 'paused'].includes(data.status)
  )
    actions.push({
      type: 'button',
      style: 'primary',
      action: { type: 'uri', label: 'Xで投稿して参加する', uri: data.goUrl },
    });
  actions.push({
    type: 'button',
    action: {
      type: 'postback',
      label: '結果を見る',
      data: `action=xgate_check&gate=${encodeURIComponent(gateId)}`,
    },
  });
  return {
    type: 'flex',
    altText: gateStatusText(data).slice(0, 400),
    contents: {
      type: 'bubble',
      body: { type: 'box', layout: 'vertical', contents: body },
      footer: { type: 'box', layout: 'vertical', contents: actions },
    },
  };
}

export function campaignStatusText(c: NonNullable<GateClaimView['campaign']>) {
  return `${c.unlimited ? '在庫上限なし' : `残り ${c.remaining} 名`}${c.participants === null ? '' : `・参加 ${c.participants} 人${c.participants >= 100 ? '以上' : ''}`}・〆切 ${new Date(c.endsAt).toLocaleString('ja-JP', { timeZone: 'Asia/Tokyo' })} JST`;
}
export function campaignAskText(data: GateClaimView) {
  return `よろしければ ${data.asks?.includes('follow') ? '@' + (data.brandUsername ?? '') + ' のフォロー' : ''}${data.asks?.length === 2 ? '・' : ''}${data.asks?.includes('like') ? '告知投稿へのいいね' : ''}もお願いします（応募条件ではありません）。`;
}

export function followupConsentText(offer: string) {
  return offer === 'coupon'
    ? 'ボタンを押すと参加賞クーポンを受け取れます。'
    : offer === 'both'
      ? 'ボタンを押すとクーポンを受け取り、次回のキャンペーン案内をLINEで受け取ることに同意します。'
      : 'ボタンを押すと、次回のキャンペーン案内をLINEで受け取ることに同意します。';
}
