/**
 * L Harness LIFF — The single entry point
 *
 * This URL IS the friend-add URL. Every user enters through here.
 *
 * Flow:
 *   LIFF URL → LINE Login (auto in LINE app) → UUID issued
 *   → friendship check → not friend? show add button → friend added → Webhook → scenario enroll
 *   → already friend? → show completion
 *
 * Query params:
 *   ?ref=xxx          — attribution tracking (which LP/campaign)
 *   ?redirect=x       — redirect after linking (for wrapped URLs)
 *   ?page=book        — booking page (calendar slot picker, Google Calendar)
 *   ?page=salon-book  — salon booking flow (React, dynamic-imported)
 *   ?page=affiliate   — affiliate self-serve page (React, dynamic-imported)
 *   ?page=webinar     — auto-webinar pseudo-live viewer (React, dynamic-imported; &slug=)
 */

import { initBooking } from './booking.js';
import { initForm } from './form.js';
import { safeRedirectTarget } from '../lib/safe-redirect.js';
import { buildLiffLaunchUrls } from './liff-launch.js';

declare const liff: {
  init(config: { liffId: string }): Promise<void>;
  isLoggedIn(): boolean;
  login(opts?: { redirectUri?: string }): void;
  getProfile(): Promise<{ userId: string; displayName: string; pictureUrl?: string; statusMessage?: string }>;
  getIDToken(): string | null;
  getAccessToken(): string | null;
  getDecodedIDToken(): { sub: string; name?: string; email?: string; picture?: string } | null;
  getOS(): 'ios' | 'android' | 'web' | undefined;
  isInClient(): boolean;
  closeWindow(): void;
  logout(): void;
};

// Resolve LIFF ID: ?liffId= param (from endpoint URL) > env var (fallback to ①)
function detectLiffId(): string {
  const fromParam = new URLSearchParams(window.location.search).get('liffId');
  if (fromParam) return fromParam;
  return import.meta.env?.VITE_LIFF_ID || '';
}
const LIFF_ID = detectLiffId();
if (!LIFF_ID) {
  throw new Error('LIFF ID not found. Set ?liffId= in LIFF endpoint URL or VITE_LIFF_ID env.');
}
const UUID_STORAGE_KEY = 'lh_uuid';
// Bot basic ID — resolved dynamically from API after liff.init()
let BOT_BASIC_ID = '';

function apiCall(path: string, options?: RequestInit): Promise<Response> {
  return fetch(path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });
}

function getPage(): string | null {
  const path = window.location.pathname.replace(/^\/+/, '');
  if (path === 'book') return 'book';
  const params = new URLSearchParams(window.location.search);
  return params.get('page');
}

function getRedirectUrl(): string | null {
  const params = new URLSearchParams(window.location.search);
  // Guard the client-side navigation sink (window.location.href below) against
  // open-redirect / javascript: abuse, mirroring the server-side /auth/callback
  // guard. A directly-crafted LIFF URL never reaches the server route, so the
  // client must validate too.
  return safeRedirectTarget(params.get('redirect'));
}

function getRef(): string | null {
  const params = new URLSearchParams(window.location.search);
  return params.get('ref');
}

function getSavedUuid(): string | null {
  try {
    return localStorage.getItem(UUID_STORAGE_KEY);
  } catch {
    return null;
  }
}

interface ServerFriendship {
  friendFlag: boolean;
  userId?: string;
}

function liffLinkBody(profile: { displayName: string }): Record<string, string | undefined | null> {
  const params = new URLSearchParams(window.location.search);
  return {
    idToken: liff.getIDToken(),
    displayName: profile.displayName,
    existingUuid: getSavedUuid() || undefined,
    ref: getRef() || undefined,
    ig: params.get('ig') || undefined,
    iga: params.get('iga') || undefined,
    igan: params.get('igan') || undefined,
    crossAccountToken: params.get('crossAccountToken') || undefined,
  };
}

/**
 * Friendship is intentionally resolved from L Harness, not liff.getFriendship().
 * That keeps the LIFF app independent from LINE Login's channel-level linked-bot
 * setting while the follow/unfollow webhook remains the source of truth.
 */
async function linkAndReadServerFriendship(
  profile: { displayName: string },
): Promise<ServerFriendship> {
  if (!liff.getIDToken()) {
    throw new Error('LINE 認証情報の取得に失敗しました。LINEアプリ内で再度開いてください。');
  }

  const res = await apiCall('/api/liff/link', {
    method: 'POST',
    body: JSON.stringify(liffLinkBody(profile)),
  });
  if (res.status === 404) return { friendFlag: false };
  if (!res.ok) {
    throw new Error('LINEアカウント情報を確認できませんでした。もう一度お試しください。');
  }

  const payload = await res.json() as {
    success: boolean;
    data?: { userId?: string; isFollowing?: boolean };
  };
  if (payload.data?.userId) saveUuid(payload.data.userId);
  return {
    friendFlag: Boolean(payload.data?.isFollowing),
    userId: payload.data?.userId,
  };
}

function showExternalAppGate(): void {
  const container = document.getElementById('app')!;
  const urls = buildLiffLaunchUrls(window.location.href, LIFF_ID);
  const os = liff.getOS();
  const appUrl = os === 'ios' ? urls.ios : os === 'android' ? urls.android : urls.canonical;

  container.innerHTML = `
    <div class="card">
      ${os === 'ios' ? `
        <div class="external-gate-alert">
          ボタンを押してもLINEアプリに移動しない場合は、ボタンを長押しして
          「LINEで開く」を選択してください。
        </div>
      ` : ''}
      <div class="external-gate-icon">LINE</div>
      <h2>LINEアプリを開いて<br>続行してください</h2>
      <a id="openLineAppBtn" class="add-friend-btn">アプリで開く</a>
      <button id="browserLoginBtn" type="button" class="secondary-action-btn">
        ブラウザでログインする
      </button>
      <a class="secondary-action-btn" href="https://line.me/ja/">LINEアプリをダウンロード</a>
    </div>
  `;

  document.getElementById('openLineAppBtn')!.setAttribute('href', appUrl);
  document.getElementById('browserLoginBtn')!.addEventListener('click', () => {
    liff.login({ redirectUri: window.location.href });
  });
}

function saveUuid(uuid: string): void {
  try {
    localStorage.setItem(UUID_STORAGE_KEY, uuid);
  } catch {
    // silent fail
  }
}

function escapeHtml(str: string): string {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ─── UI States ──────────────────────────────────────────

function showFriendAdd(profile: { displayName: string; pictureUrl?: string }) {
  const container = document.getElementById('app')!;
  const friendAddUrl = BOT_BASIC_ID
    ? `https://line.me/R/ti/p/${BOT_BASIC_ID}`
    : '#';

  container.innerHTML = `
    <div class="card">
      <div class="profile">
        ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" />` : ''}
        <p class="name">${escapeHtml(profile.displayName)} さん</p>
      </div>
      <p class="message">まずは友だち追加をお願いします</p>
      <a href="${friendAddUrl}" class="add-friend-btn" id="addFriendBtn">
        友だち追加して始める
      </a>
      <p class="sub-message">追加後、この画面に戻ってきてください</p>
    </div>
  `;

  // 友だち追加後に戻ってきたら自動で再チェック
  // 一度発火したら listener を外して、ユーザーが LIFF をフォアグラウンド復帰するたびに
  // 重複 push が走らないようにする（送信後にアプリ切り替えで再発火する事故を防ぐ）
  let formLinkSent = false;
  let polling = false;
  const onVisibilityChange = async () => {
    if (document.visibilityState !== 'visible' || polling) return;
    polling = true;
    try {
      // The follow webhook can arrive a few seconds after returning from the
      // Official Account screen. Poll L Harness briefly instead of depending
      // on the LINE Login channel's linked-bot setting.
      let friendFlag = false;
      for (let attempt = 0; attempt < 12; attempt += 1) {
        const friendship = await linkAndReadServerFriendship(profile);
        if (friendship.friendFlag) {
          friendFlag = true;
          break;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!friendFlag) return;

      // Send form link if form param exists (was lost during friend-add flow)
      const formParam = new URLSearchParams(window.location.search).get('form');
      if (formParam && !formLinkSent) {
        formLinkSent = true;
        try {
          const fp = await liff.getProfile();
          const idToken = liff.getIDToken();
          const params = new URLSearchParams(window.location.search);
          await apiCall('/api/liff/send-form-link', {
            method: 'POST',
            body: JSON.stringify({
              lineUserId: fp.userId,
              formId: formParam,
              idToken: idToken || '',
              ref: params.get('ref') || '',
              gate: params.get('gate') || '',
              xh: params.get('xh') || '',
              ig: params.get('ig') || '',
              iga: params.get('iga') || '',
              igan: params.get('igan') || '',
            }),
          });
        } catch { /* best-effort */ }
      }
      document.removeEventListener('visibilitychange', onVisibilityChange);
      showCompletion(profile, false);
    } catch {
      // ignore
    } finally {
      polling = false;
    }
  };
  document.addEventListener('visibilitychange', onVisibilityChange);
}

function showCompletion(profile: { displayName: string; pictureUrl?: string }, isRecovery: boolean) {
  const container = document.getElementById('app')!;
  const ref = getRef();
  container.innerHTML = `
    <div class="card">
      <div class="check-icon">${isRecovery ? '🔄' : '✓'}</div>
      <h2>${isRecovery ? 'おかえりなさい！' : '登録完了！'}</h2>
      <div class="profile">
        ${profile.pictureUrl ? `<img src="${profile.pictureUrl}" alt="" />` : ''}
        <p class="name">${escapeHtml(profile.displayName)} さん</p>
      </div>
      <p class="message">
        ${isRecovery
          ? '以前のアカウント情報を引き継ぎました。'
          : 'ありがとうございます！これからお役立ち情報をお届けします。'
        }
        <br>このページは閉じて大丈夫です。
      </p>
      ${ref ? `<p class="ref-badge">${escapeHtml(ref)}</p>` : ''}
    </div>
  `;

  // 2秒後にトーク画面に遷移（BOT_BASIC_ID が設定されている場合のみ）
  if (BOT_BASIC_ID) {
    setTimeout(() => {
      window.location.href = `https://line.me/R/oaMessage/${BOT_BASIC_ID}/`;
    }, 2000);
  }
}

function showError(message: string) {
  const container = document.getElementById('app')!;
  container.innerHTML = `
    <div class="card">
      <h2>エラー</h2>
      <p class="error">${escapeHtml(message)}</p>
    </div>
  `;
}

// ─── Core Flow ──────────────────────────────────────────

async function linkAndAddFlow() {
  const redirectUrl = getRedirectUrl();
  const ref = getRef();

  try {
    const existingUuid = getSavedUuid();

    const profile = await liff.getProfile();
    if (!liff.getIDToken()) {
      throw new Error('LINE 認証情報の取得に失敗しました。LINEアプリ内で再度開いてください。');
    }

    // 1. UUID linking + server-side friendship resolution. A 404 is a valid
    // "not followed yet" state and is converted to friendFlag=false.
    const linkPromise = linkAndReadServerFriendship(profile);

    // 2. Attribution tracking
    if (ref) {
      apiCall('/api/affiliates/click', {
        method: 'POST',
        body: JSON.stringify({ code: ref, url: window.location.href }),
      }).catch(() => {});
    }

    // 3. Redirect flow (for wrapped URLs)
    if (redirectUrl) {
      await Promise.race([
        linkPromise,
        new Promise((r) => setTimeout(r, 500)),
      ]);
      // Append LINE userId to tracking links so clicks are attributed
      if (redirectUrl.includes('/t/')) {
        const sep = redirectUrl.includes('?') ? '&' : '?';
        window.location.href = `${redirectUrl}${sep}lu=${encodeURIComponent(profile.userId)}`;
      } else {
        window.location.href = redirectUrl;
      }
      return;
    }

    // 4. Wait for UUID linking to complete
    const friendship = await linkPromise;

    // 5. Friendship check — the key decision point
    if (!friendship.friendFlag) {
      // Not a friend yet → show friend-add button
      showFriendAdd(profile);
    } else {
      // Already a friend — check for form param
      const formParam = new URLSearchParams(window.location.search).get('form');
      if (formParam) {
        // Send form link via push message, then show completion
        try {
          const idToken = liff.getIDToken();
          const params = new URLSearchParams(window.location.search);
          await apiCall('/api/liff/send-form-link', {
            method: 'POST',
            body: JSON.stringify({
              lineUserId: profile.userId,
              formId: formParam,
              idToken: idToken || '',
              ref: ref || '',
              gate: params.get('gate') || '',
              xh: params.get('xh') || '',
              ig: params.get('ig') || '',
              iga: params.get('iga') || '',
              igan: params.get('igan') || '',
            }),
          });
        } catch { /* best-effort */ }
        showCompletion(profile, !!existingUuid);
      } else {
        showCompletion(profile, !!existingUuid);
      }
    }

  } catch (err) {
    if (redirectUrl) {
      window.location.href = redirectUrl;
    } else {
      showError(err instanceof Error ? err.message : 'エラーが発生しました');
    }
  }
}

// ─── Salon Booking (React, dynamic-imported) ─────────────

async function initSalonBooking(): Promise<void> {
  // 既存 linkAndAddFlow と同じ初期化シーケンスを踏む:
  //   ① profile + idToken を取得
  //   ② /api/liff/link で UUID と友だち状態を確定 (ref/ig 含む)
  //      — booking エンドポイントが
  //      id_token verify で friend を引くために friends 行が必要
  //   ③ ref があれば /api/affiliates/click で流入計測
  //   ④ 未友達なら showFriendAdd (friend-add gate)。友達追加後に同じ URL に
  //      戻ってくれば再度ここを通って React mount に進む
  //   ⑤ 友達なら React チャンクを動的 import して mount
  const profile = await liff.getProfile();
  const idToken = liff.getIDToken();
  if (!idToken) {
    showError('LINE 認証情報の取得に失敗しました。LINE アプリ内で再度開いてください。');
    return;
  }

  const ref = getRef();
  const friendship = await linkAndReadServerFriendship(profile);

  // ③ Affiliate click 計測 (linkAndAddFlow と同等)。
  if (ref) {
    apiCall('/api/affiliates/click', {
      method: 'POST',
      body: JSON.stringify({ code: ref, url: window.location.href }),
    }).catch(() => {
      /* silent */
    });
  }

  // ④ 未友達なら friend-add UI に流す。booking API は friends.is_following = 1
  //    を要求するので、ここを skip すると最終的に cannot_book / friend_not_found
  //    で詰む。
  if (!friendship.friendFlag) {
    showFriendAdd(profile);
    return;
  }

  // ⑤ React + Tailwind チャンクを動的 import → 既存 LIFF 利用者には load されない。
  const container = document.getElementById('app');
  if (!container) {
    showError('mount target #app が見つかりません');
    return;
  }
  const { mountSalonBooking } = await import('./salon-booking/main.js');
  mountSalonBooking(container, {
    liffId: LIFF_ID,
    lineUserId: profile.userId,
    idToken,
  });
}

// ─── Event Booking (React, dynamic-imported) ─────────────

async function initEventBooking(initialKind: 'detail' | 'history'): Promise<void> {
  // salon-booking と同じ初期化シーケンス: profile/idToken/サーバー側friendship取得、
  // 未友達なら friend-add gate、友達なら React mount。
  const profile = await liff.getProfile();
  const idToken = liff.getIDToken();
  if (!idToken) {
    showError('LINE 認証情報の取得に失敗しました。LINE アプリ内で再度開いてください。');
    return;
  }

  const friendship = await linkAndReadServerFriendship(profile);

  if (!friendship.friendFlag) {
    showFriendAdd(profile);
    return;
  }

  const container = document.getElementById('app');
  if (!container) {
    showError('mount target #app が見つかりません');
    return;
  }
  const params = new URLSearchParams(window.location.search);
  const eventId = params.get('id') ?? '';
  if (initialKind === 'detail' && !eventId) {
    showError('id クエリパラメータが必要です（?page=event&id=<eventId>）');
    return;
  }
  const { mountEventBooking } = await import('./event-booking/main.js');
  const ctx = { liffId: LIFF_ID, lineUserId: profile.userId, idToken };
  const initial = initialKind === 'detail'
    ? { kind: 'detail' as const, eventId }
    : { kind: 'history' as const };
  mountEventBooking(container, ctx, initial);
}

// ─── Auto-webinar (React, dynamic-imported) ──────────────

async function initWebinar(): Promise<void> {
  // event-booking と同じ初期化シーケンス: profile/idToken/サーバー側friendship取得、
  // 未友達なら friend-add gate、友達なら React mount。
  const profile = await liff.getProfile();
  const idToken = liff.getIDToken();
  if (!idToken) {
    showError('LINE 認証情報の取得に失敗しました。LINE アプリ内で再度開いてください。');
    return;
  }

  const wbParams = new URLSearchParams(window.location.search);
  const friendship = await linkAndReadServerFriendship(profile);

  if (!friendship.friendFlag) {
    showFriendAdd(profile);
    return;
  }

  const container = document.getElementById('app');
  if (!container) {
    showError('mount target #app が見つかりません');
    return;
  }
  const slug = wbParams.get('slug') ?? '';
  if (!slug) {
    showError('slug クエリパラメータが必要です（?page=webinar&slug=<slug>）');
    return;
  }
  const { mountWebinar } = await import('./webinar/main.js');
  mountWebinar(container, { liffId: LIFF_ID, lineUserId: profile.userId, idToken }, slug);
}

// ─── Affiliate self-serve (React, dynamic-imported) ──────

async function initAffiliate(): Promise<void> {
  // salon-booking と同じ初期化シーケンス: profile/accessToken/サーバー側friendship を
  // 取得し、未友達なら friend-add gate、友達なら React mount。
  //
  // booking 系は id_token で verify するが、affiliate API は LINE access token
  // (liff.getAccessToken()) を /oauth2/v2.1/verify + /v2/profile で検証するため
  // ここでは accessToken を取り出して mount context に渡す。
  const [profile, accessToken] = await Promise.all([
    liff.getProfile(),
    Promise.resolve(liff.getAccessToken()),
  ]);
  if (!accessToken) {
    showError('LINE 認証情報の取得に失敗しました。LINE アプリ内で再度開いてください。');
    return;
  }

  // Wallet取得より先にUUID連携を確定する。友だち追加前の404は
  // friendFlag=falseとして扱い、追加後の復帰処理で再試行する。
  const friendship = await linkAndReadServerFriendship(profile);

  // 未友達なら friend-add UI に流す。affiliate API は friends 行 (=友だち) を
  // 要求するので、ここを skip すると /affiliate/me が friend_not_found で詰む。
  if (!friendship.friendFlag) {
    showFriendAdd(profile);
    return;
  }

  const container = document.getElementById('app');
  if (!container) {
    showError('mount target #app が見つかりません');
    return;
  }
  const { mountAffiliate } = await import('./affiliate/main.js');
  mountAffiliate(container, {
    liffId: LIFF_ID,
    lineUserId: profile.userId,
    lineAccessToken: accessToken,
  });
}

// ─── Entry Point ────────────────────────────────────────

// External-browser LIFF sessions persist in localStorage, and the SDK keeps
// returning the cached id_token without refreshing it. LINE id_tokens expire
// after 1h, so a returning PC visitor gets 401 from every verify-backed API
// (/api/liff/link, webinar load, forms). In-client (LINE app) sessions get a
// fresh token on every launch and never hit this.
function isIdTokenStale(idToken: string | null): boolean {
  if (!idToken) return true;
  try {
    const payloadB64 = idToken.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    const payload = JSON.parse(atob(payloadB64)) as { exp?: number };
    // 60s margin so a token about to expire mid-flow also counts as stale
    return typeof payload.exp !== 'number' || payload.exp * 1000 < Date.now() + 60_000;
  } catch {
    return true;
  }
}

const RELOGIN_GUARD_KEY = 'lh_relogin_at';

function forceReloginForStaleToken(): boolean {
  if (liff.isInClient()) return false;
  if (!isIdTokenStale(liff.getIDToken())) return false;
  // Loop guard: if we already round-tripped through LINE Login within the
  // last minute and the token is still stale (clock skew, login cancelled),
  // fall through instead of redirecting forever.
  let lastAttempt = 0;
  try {
    lastAttempt = Number(sessionStorage.getItem(RELOGIN_GUARD_KEY) || 0);
  } catch { /* sessionStorage unavailable — still attempt a single redirect */ }
  if (Date.now() - lastAttempt < 60_000) return false;
  try {
    sessionStorage.setItem(RELOGIN_GUARD_KEY, String(Date.now()));
  } catch { /* ignore */ }
  try {
    liff.logout();
  } catch { /* ignore — login below still re-issues tokens */ }
  liff.login({ redirectUri: window.location.href });
  return true;
}

async function main() {
  try {
    await liff.init({ liffId: LIFF_ID });

    if (!liff.isLoggedIn()) {
      // Match the L-Step experience: Safari/Chrome users choose to open the
      // LINE app first. Browser login remains an explicit fallback instead of
      // being forced immediately.
      showExternalAppGate();
      return;
    }

    if (forceReloginForStaleToken()) return;

    // Resolve bot basic ID from API (multi-account support)
    try {
      const configRes = await fetch(`/api/liff/config?liffId=${encodeURIComponent(LIFF_ID)}`);
      const configJson = await configRes.json() as { success: boolean; data?: { botBasicId?: string } };
      if (configJson.success && configJson.data?.botBasicId) {
        BOT_BASIC_ID = configJson.data.botBasicId;
      }
    } catch {
      // fallback: BOT_BASIC_ID remains empty, friend-add URL won't auto-redirect
    }

    const page = getPage();
    if (page === 'book') {
      await initBooking();
    } else if (page === 'salon-book') {
      await initSalonBooking();
    } else if (page === 'event') {
      await initEventBooking('detail');
    } else if (page === 'event-me') {
      await initEventBooking('history');
    } else if (page === 'webinar') {
      await initWebinar();
    } else if (page === 'affiliate') {
      await initAffiliate();
    } else if (page === 'form') {
      const params = new URLSearchParams(window.location.search);
      const formId = params.get('id');
      await initForm(formId);
    } else if (!page) {
      await linkAndAddFlow();
    } else {
      await linkAndAddFlow();
    }
  } catch (err) {
    showError(err instanceof Error ? err.message : 'LIFF初期化エラー');
  }
}

main();
