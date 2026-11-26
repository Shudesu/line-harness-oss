import {
  gateStatusText,
  campaignStatusText,
  campaignAskText,
  followupConsentText,
  type GateClaimView,
} from '../services/x-gate-line-message.js';
declare const liff: {
  getIDToken(): string | null;
  getAccessToken(): string | null;
  openWindow(options: { url: string; external: boolean }): void;
};
export async function initXGate(gateId: string | null): Promise<void> {
  const app = document.getElementById('app');
  if (!app) return;
  app.replaceChildren();
  const style = document.createElement('style');
  style.textContent =
    '.xgate{max-width:460px;box-sizing:border-box;overflow-wrap:anywhere;margin:24px auto;padding:28px;background:#fff;border:1px solid #dbe5df;border-radius:24px;color:#183529;font-family:system-ui,sans-serif}.xgate h1{font-size:24px;line-height:1.5}.xgate p{line-height:1.8;overflow-wrap:anywhere}.xgate button,.xgate a{display:block;width:100%;box-sizing:border-box;border:0;border-radius:12px;padding:16px;margin:12px 0;text-align:center;font:inherit;font-weight:600;text-decoration:none;background:#eaf4ee;color:#164c31}.xgate .primary{background:#087c42;color:white}.xgate .code{font-size:27px;font-weight:800;letter-spacing:1px;padding:22px 12px;background:#f3f8f5;border-radius:16px;text-align:center;overflow-wrap:anywhere}.xgate button:disabled{opacity:.5}.xgate .muted{font-size:13px;color:#607768}.xgate [role=alert]{color:#a62f2f}';
  app.append(style);
  const card = document.createElement('section');
  card.className = 'xgate';
  app.append(card);
  const text = (tag: string, value: string, className?: string) => {
    const el = document.createElement(tag);
    el.textContent = value;
    if (className) el.className = className;
    card.append(el);
    return el;
  };
  let busy = false,
    challengeToken = '';
  async function load(action: 'join' | 'check' | 'followup') {
    if (busy || !gateId) return;
    busy = true;
    card.replaceChildren();
    text('p', '参加状況を確認しています…');
    try {
      const response = await fetch(`/api/liff/x-gates/${encodeURIComponent(gateId)}/${action}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          idToken: liff.getIDToken(),
          accessToken: liff.getAccessToken(),
          turnstileToken: challengeToken || undefined,
        }),
      });
      const result = (await response.json()) as {
        success: boolean;
        error?: string;
        data: GateClaimView & {
          addFriendUrl?: string | null;
          siteKey?: string;
          message?: string;
          coupon?: { label: string; value: string };
        };
      };
      if (!response.ok || !result.success)
        throw new Error(result.error || '現在確認できません。時間をおいてお試しください。');
      const data = result.data;
      card.replaceChildren();
      text('p', 'LINEから参加', 'muted');
      text('h1', data.title || 'キャンペーン');
      if (data.status === 'friend_required') {
        text('p', '友だち追加すると、あなた専用の合言葉を受け取れます。');
        if (data.addFriendUrl) {
          const link = text('a', 'LINEで友だち追加', 'primary') as HTMLAnchorElement;
          link.href = data.addFriendUrl;
        }
        const added = text('button', '追加したので続ける') as HTMLButtonElement;
        added.onclick = () => void load('join');
        return;
      }
      if (data.status === 'challenge_required') {
        text('p', '不正防止のため確認にご協力ください。');
        if (!data.siteKey) throw new Error('確認機能の準備中です。作成者へお問い合わせください。');
        const area = document.createElement('div');
        card.append(area);
        const win = window as unknown as {
          turnstile?: { render: (el: HTMLElement, options: Record<string, unknown>) => string };
        };
        if (!win.turnstile)
          await new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => reject(new Error('確認機能を読み込めませんでした。'));
            document.head.append(script);
          });
        busy = false;
        win.turnstile!.render(area, {
          sitekey: data.siteKey,
          action: 'x_gate_join',
          cData: gateId,
          callback: (token: string) => {
            challengeToken = token;
            void load('join');
          },
        });
        return;
      }
      challengeToken = '';
      if (action === 'followup') text('p', data.message ?? '受け付けました。');
      else text('p', gateStatusText(data));
      if (data.campaign) text('p', campaignStatusText(data.campaign), 'muted');
      if (data.asks?.length) text('p', campaignAskText(data), 'muted');
      if (data.followupCoupon) {
        text('h2', data.followupCoupon.label);
        text('p', data.followupCoupon.value);
      }
      if (data.status === 'lost' && data.followup && !data.followupAccepted) {
        text('p', followupConsentText(data.followup.offer), 'muted');
        const opt = text('button', data.followup.label, 'primary') as HTMLButtonElement;
        opt.onclick = () => void load('followup');
      }
      if (data.xUsername) text('p', `確認したXアカウント: @${data.xUsername}`, 'muted');
      if (
        data.displayCode &&
        !data.replyCreatedAt &&
        !['won', 'lost', 'rewarded', 'ended', 'expired', 'paused'].includes(data.status)
      ) {
        text('div', data.displayCode, 'code');
        text(
          'p',
          'この企画では、合言葉を投稿したXアカウントとあなたのLINEを紐づけます。文面は入力済みでXが開きます。そのまま投稿してください。合言葉は他の人に渡さないでください。',
          'muted',
        );
        if (data.goUrl) {
          const go = text('button', 'Xで投稿して参加する', 'primary') as HTMLButtonElement;
          go.onclick = () => {
            if (data.goUrl) liff.openWindow({ url: data.goUrl, external: true });
          };
        }
        if (data.replyText) {
          const copy = text('button', '開けない場合：投稿文をコピー') as HTMLButtonElement;
          copy.onclick = async () => {
            try {
              await navigator.clipboard.writeText(data.replyText!);
              copy.textContent = 'コピーしました。Xの告知投稿へ返信してください。';
            } catch {
              copy.textContent = '合言葉を長押ししてコピーしてください。';
            }
          };
        }
        if (data.postUrl && /^https:\/\/x\.com\/[A-Za-z0-9_]+\/status\/\d+$/.test(data.postUrl)) {
          const link = text('a', '告知投稿を開く') as HTMLAnchorElement;
          link.href = data.postUrl;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
        }
      }
      if (
        data.missing?.includes('follow') &&
        data.brandUsername &&
        /^[A-Za-z0-9_]{1,15}$/.test(data.brandUsername)
      ) {
        const follow = text('button', 'Xでフォローを確認する', 'primary') as HTMLButtonElement;
        follow.onclick = () =>
          liff.openWindow({ url: `https://x.com/${data.brandUsername}`, external: true });
      }
      if (data.reward) {
        text('h2', data.reward.label);
        text('p', data.reward.value);
        if (['url', 'file'].includes(data.reward.type) && /^https:\/\//.test(data.reward.value)) {
          const link = text('a', '特典を開く', 'primary') as HTMLAnchorElement;
          link.href = data.reward.value;
          link.rel = 'noopener noreferrer';
          link.target = '_blank';
        }
      }
      if (data.status !== 'ended') {
        const check = text(
          'button',
          data.status === 'expired' ? '新しい合言葉を受け取る' : '結果を見る',
        ) as HTMLButtonElement;
        const remaining = Math.max(0, data.retryAfterSec ?? 0);
        if (remaining) {
          check.disabled = true;
          setTimeout(() => {
            check.disabled = false;
            check.textContent = '結果を見る';
          }, remaining * 1000);
          check.textContent = `${remaining}秒ほど待って確認できます`;
        }
        check.onclick = () => void load(data.status === 'expired' ? 'join' : 'check');
      }
      text(
        'p',
        '結果が確定したらLINEでもお知らせします。検索への反映や混雑により時間がかかる場合があります。見つからないときは、合言葉・公開設定・投稿の削除有無をご確認ください。',
        'muted',
      );
    } catch (error) {
      card.replaceChildren();
      const el = text('p', error instanceof Error ? error.message : '確認に失敗しました');
      el.setAttribute('role', 'alert');
      const retry = text('button', 'もう一度確認') as HTMLButtonElement;
      retry.onclick = () => void load('join');
    } finally {
      busy = false;
    }
  }
  if (!gateId) {
    text('p', 'キャンペーンの参加リンクから開いてください。');
    return;
  }
  await load('join');
}
