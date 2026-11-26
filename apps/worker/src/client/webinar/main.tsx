// main.tsx — Auto-webinar (疑似ライブ) LIFF entry. Loaded via dynamic import
// from apps/worker/src/client/main.ts (?page=webinar&slug=<slug>).
// apps/liff/src/pages/Webinar.tsx と同一ロジックの legacy-client 移植版
// (本番 LIFF は worker 内蔵クライアントのため。apps/liff は未デプロイ)。
//
// 時刻の権威はサーバー:
//   期待位置 = offsetSeconds + (performance.now() - t0) / 1000
// 動画側がバッファ等で 5 秒以上ズレたら期待位置へ強制シーク。
// シークバー・一時停止 UI は出さない (controls なし)。

import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { buildMeetingDateOptions } from './date-options.js';
import './styles.css';

// LIFF SDK は index.html の script タグでグローバル注入される
declare const liff: {
  isInClient(): boolean;
  openWindow(params: { url: string; external: boolean }): void;
};

let _root: Root | null = null;

export interface WebinarContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
}

const DRIFT_TOLERANCE = 5;
const HEARTBEAT_MS = 30_000;

// プレビューモード (?preview=1): 運営が内容確認するための隠しモード。
// ライブ位置に縛られず 0 秒から再生し、シークバー + 速度切替を出す。
// サクラコメントは video.currentTime 同期なので倍速でも正しく流れる。
// ハートビートは送らない (分析を汚さない)。通常視聴者の挙動は不変。
const IS_PREVIEW = new URLSearchParams(window.location.search).get('preview') === '1';
const PREVIEW_RATES = [1, 1.25, 1.5, 2] as const;

interface WebinarCta {
  label: string;
  url: string;
  showAtSeconds: number;
}

// チャット欄に流れる CTA カード (webinar_ctas)。kind='form' は既存フォームを
// ボトムシートで開いて離脱なしで回答させる。kind='url' は外部 URL。
interface WebinarCtaCard {
  id: string;
  atSeconds: number;
  kind: 'form' | 'url';
  title: string;
  body: string | null;
  buttonLabel: string;
  autoOpen: boolean;
  formId: string | null;
  url: string | null;
}

interface FormField {
  name: string;
  label: string;
  type: 'text' | 'email' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'date';
  required?: boolean;
  options?: string[];
  placeholder?: string;
}

interface FormDef {
  id: string;
  name: string;
  description: string | null;
  fields: FormField[];
  isActive: boolean;
  onSubmitMessageContent?: string | null;
}

interface ConsultationSlot {
  date: string;
  start: string;
  end: string;
  startsAt: string;
}

interface ConsultationAvailability {
  calendarReady: boolean;
  fallbackUrl: string | null;
  menu: { id: string; name: string; durationMinutes: number };
  staff: { id: string; name: string };
  slots: ConsultationSlot[];
  existingBooking: {
    bookingId: string;
    status: string;
    startsAt: string;
    meetUrl: string | null;
  } | null;
}

interface BookedConsultation {
  bookingId: string;
  status: 'confirmed';
  startsAt: string;
  endsAt: string;
  meetUrl: string;
  externalEventId: string;
  created: boolean;
}

interface WebinarSakuraComment {
  atSeconds: number;
  authorName: string;
  body: string;
}

type WebinarState =
  | {
      live: true;
      replay?: boolean;
      title: string;
      durationSeconds: number;
      sessionStartAt: number;
      offsetSeconds: number;
      playlistUrl: string;
      cta: WebinarCta | null;
      comments: WebinarSakuraComment[];
      ctas: WebinarCtaCard[];
      // 参加ゲート用: 今後の回と自分の予約
      upcoming?: number[];
      registeredSessionAt?: number | null;
      registeredForThisSession?: boolean;
    }
  // 待機ルーム (開始10分前〜): 開始前サクラコメント (負の atSeconds) が流れる
  | {
      live: false;
      waiting: true;
      title: string;
      nextSessionAt: number;
      offsetSeconds: number;
      comments: WebinarSakuraComment[];
    }
  | {
      live: false;
      waiting?: undefined;
      title: string;
      nextSessionAt: number | null;
      // セッション選択メニュー: 今後の開催回 (epoch 秒) と自分の予約
      upcoming?: number[];
      registeredSessionAt?: number | null;
    };

interface ChatItem {
  key: string;
  authorName: string;
  body: string;
  mine?: boolean;
  ctaCard?: WebinarCtaCard;
}

function buildAuthHeaders(ctx: WebinarContext, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ctx.idToken}`, ...extra };
}

async function apiGet<T>(path: string, ctx: WebinarContext): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const r = await fetch(url.toString(), { headers: buildAuthHeaders(ctx) });
  if (!r.ok) {
    const err = new Error(`API ${r.status}`) as Error & { status: number };
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

async function apiPost<T>(path: string, body: unknown, ctx: WebinarContext): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const r = await fetch(url.toString(), {
    method: 'POST',
    headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const err = new Error(`API ${r.status}`) as Error & { status: number };
    err.status = r.status;
    throw err;
  }
  return r.json() as Promise<T>;
}

function formatJp(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

function WebinarApp({ ctx, slug }: { ctx: WebinarContext; slug: string }) {
  const [state, setState] = useState<WebinarState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [countdown, setCountdown] = useState('');
  // ライブ参加ゲート: 予約した回だけ再生する。未予約なら開始直後でも予約画面。
  const [joined, setJoined] = useState(false);
  const joinedRef = useRef(false);
  joinedRef.current = joined;
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [ctaVisible, setCtaVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const [rate, setRate] = useState(1);
  const [activeCta, setActiveCta] = useState<WebinarCtaCard | null>(null);
  const [formSheet, setFormSheet] = useState<
    | null
    | { cta: WebinarCtaCard; phase: 'loading' }
    | { cta: WebinarCtaCard; phase: 'form'; def: FormDef }
    | { cta: WebinarCtaCard; phase: 'done'; def: FormDef }
    | { cta: WebinarCtaCard; phase: 'error'; message: string }
  >(null);
  const rateRef = useRef(1);
  rateRef.current = rate;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const t0Ref = useRef(0);            // state 受信時の performance.now()
  const waitT0Ref = useRef(0);        // 待機ルーム受信時の Date.now()
  const baseOffsetRef = useRef(0);    // state.offsetSeconds
  const commentIdxRef = useRef(0);    // 次に表示するサクラコメント index
  const ctaIdxRef = useRef(0);        // 次に表示する CTA カード index
  const openCtaRef = useRef<(card: WebinarCtaCard) => void>(() => undefined);
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<WebinarState | null>(null);
  stateRef.current = state;

  const trackFunnelEvent = useCallback((
    eventType: 'cta_impression' | 'form_open' | 'form_start' | 'field_complete' |
      'submit_attempt' | 'submit_success' | 'submit_error',
    card: WebinarCtaCard,
    fieldName = '',
  ) => {
    const current = stateRef.current;
    if (IS_PREVIEW || !current?.live || current.sessionStartAt === null) return;
    void apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/funnel-event`, {
      sessionStartAt: current.sessionStartAt,
      eventType,
      ctaId: card.id,
      formId: card.formId,
      fieldName,
    }, ctx).catch(() => undefined);
  }, [slug, ctx]);

  const expectedPosition = useCallback(
    () => baseOffsetRef.current + (performance.now() - t0Ref.current) / 1000,
    [],
  );

  const load = useCallback(async () => {
    try {
      const admissionSession = new URLSearchParams(window.location.search).get('sessionStartAt');
      const path = `/api/liff/webinars/${encodeURIComponent(slug)}` +
        (admissionSession ? `?sessionStartAt=${encodeURIComponent(admissionSession)}` : '');
      const s = await apiGet<WebinarState>(path, ctx);
      if (s.live) {
        t0Ref.current = performance.now();
        baseOffsetRef.current = s.offsetSeconds;
        commentIdxRef.current = 0;
        ctaIdxRef.current = 0;
        setChat([]);
        setCtaVisible(false);
        setActiveCta(null);
        // 入場できるのはプレビューか、この回を予約していた本人のみ。
        // 「開始直後なら未予約でも自動再生」の例外は、予約画面を飛ばすため禁止。
        setJoined(IS_PREVIEW || s.registeredForThisSession === true);
      } else if (s.waiting) {
        // 待機ルーム: 位置は壁時計基準 (バックグラウンドで performance.now が
        // 止まる端末でもカウントダウンとズレない)
        waitT0Ref.current = Date.now();
        baseOffsetRef.current = s.offsetSeconds;
        commentIdxRef.current = 0;
        setChat([]);
      }
      setState(s);
    } catch (err) {
      const status = (err as { status?: number }).status;
      if (status === 403) setError('この配信は友だち追加後にご覧いただけます。');
      else if (status === 404) setError('この配信は見つかりませんでした。');
      else setError('読み込みに失敗しました。開き直してください。');
      console.error(err);
    }
  }, [slug, ctx]);

  useEffect(() => {
    void load();
  }, [load]);

  // ライブ/待機ルームだけページスクロールをロックする。セッション選択
  // メニューはボタンが縦に並ぶためスクロール可能なままにする。
  useEffect(() => {
    const lock = state ? (state.live ? joined : state.waiting === true) : false;
    document.body.classList.toggle('wb-lock', lock);
    return () => document.body.classList.remove('wb-lock');
  }, [state, joined]);

  // 待機画面: カウントダウン + 開始時刻到達で自動リロード
  useEffect(() => {
    if (!state || state.live) return;
    if (state.nextSessionAt === null) return;
    const timer = setInterval(() => {
      const remain = state.nextSessionAt! - Math.floor(Date.now() / 1000);
      if (remain <= 0) {
        clearInterval(timer);
        void load();
        return;
      }
      const h = Math.floor(remain / 3600);
      const m = Math.floor((remain % 3600) / 60);
      const s = remain % 60;
      setCountdown(
        h > 0 ? `${h}時間${String(m).padStart(2, '0')}分` : `${m}分${String(s).padStart(2, '0')}秒`,
      );
    }, 1000);
    return () => clearInterval(timer);
  }, [state, load]);

  // ライブ画面: プレーヤー初期化
  useEffect(() => {
    if (!state?.live || !joined) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;
    let cleanupVerify: (() => void) | null = null;

    async function setup() {
      const v = video!;
      const src = state as Extract<WebinarState, { live: true }>;
      // 途中参加位置はプレイリスト側の #EXT-X-START で宣言する (?at=)。
      // iOS native HLS はクライアント側シークが 0 に巻き戻ることがあるため、
      // currentTime のシークはあくまでフォールバック。プレビューは常に頭から。
      const liveAt = src.replay ? 0 : Math.max(0, Math.floor(expectedPosition()));
      const playlistUrl = IS_PREVIEW ? src.playlistUrl : `${src.playlistUrl}?at=${liveAt}`;
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = playlistUrl;
      } else {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError('この端末では再生できません。');
          return;
        }
        const instance = new Hls();
        instance.loadSource(playlistUrl);
        instance.attachMedia(v);
        hls = instance;
      }
      v.muted = true;
      setMuted(true);
      if (IS_PREVIEW) v.controls = true;
      const seekAndPlay = () => {
        v.currentTime = IS_PREVIEW || src.replay ? 0 : expectedPosition();
        v.play().then(() => setNeedsTap(true)).catch(() => setNeedsTap(true));
      };
      if (v.readyState >= 1) seekAndPlay();
      else v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
      // iOS Safari (LINE in-app) の native HLS は loadedmetadata 直後の
      // currentTime 代入が 0 に巻き戻ることがある。実際に再生が立ち上がる
      // イベントで位置を検証し、ズレていたら再シークして途中参加を保証する。
      const verifyLivePosition = () => {
        if (IS_PREVIEW || src.replay) return;
        const pos = expectedPosition();
        if (pos > DRIFT_TOLERANCE && Math.abs(v.currentTime - pos) >= DRIFT_TOLERANCE) {
          v.currentTime = pos;
        }
      };
      v.addEventListener('canplay', verifyLivePosition);
      v.addEventListener('playing', verifyLivePosition);
      // ライブに一時停止は存在しない: AirPods の耳外し・ルート変更などシステム
      // 起因の pause は自動で再生復帰させる (復帰後はドリフト補正がライブ位置へ
      // 追いつかせる)。配信終了後・バックグラウンド・プレビュー (controls あり)
      // は対象外。
      const onPause = () => {
        if (IS_PREVIEW || src.replay) return;
        if (document.visibilityState !== 'visible') return;
        if (expectedPosition() >= src.durationSeconds) return;
        setTimeout(() => {
          if (!v.paused || document.visibilityState !== 'visible') return;
          if (expectedPosition() >= src.durationSeconds) return;
          void v.play().catch(() => undefined);
        }, 300);
      };
      v.addEventListener('pause', onPause);
      cleanupVerify = () => {
        v.removeEventListener('canplay', verifyLivePosition);
        v.removeEventListener('playing', verifyLivePosition);
        v.removeEventListener('pause', onPause);
      };
    }
    void setup();
    return () => {
      cancelled = true;
      cleanupVerify?.();
      hls?.destroy();
    };
  }, [state, joined, expectedPosition]);

  // ライブ進行: ドリフト補正・サクラコメント・CTA・終了判定 (1秒 tick)
  // プレビューは video.currentTime を位置の真とし、巻き戻しシークにも追従する
  const lastTickPosRef = useRef(0);
  useEffect(() => {
    if (!state?.live || !joined) return;
    const src = state;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const pos = IS_PREVIEW ? (video?.currentTime ?? 0) : expectedPosition();
      if (IS_PREVIEW && pos < lastTickPosRef.current - 1) {
        // 巻き戻された: コメントを頭から再構築
        commentIdxRef.current = 0;
        ctaIdxRef.current = 0;
        setChat([]);
        setCtaVisible(false);
        setActiveCta(null);
      }
      lastTickPosRef.current = pos;
      if (IS_PREVIEW && video && video.playbackRate !== rateRef.current) {
        video.playbackRate = rateRef.current;
      }
      if (!IS_PREVIEW && pos >= src.durationSeconds) {
        setEnded(true);
        video?.pause();
        clearInterval(timer);
        return;
      }
      // readyState >= 1 (metadata あり) から補正する。iOS で初期シークが
      // 巻き戻された場合も、この 1 秒 tick が毎回ライブ位置へ戻す。
      if (
        !IS_PREVIEW &&
        video && video.readyState >= 1 && Math.abs(video.currentTime - pos) >= DRIFT_TOLERANCE
      ) {
        video.currentTime = pos;
      }
      // サクラコメント流し込み
      const comments = src.comments;
      const items: ChatItem[] = [];
      while (
        commentIdxRef.current < comments.length &&
        comments[commentIdxRef.current].atSeconds <= pos
      ) {
        const cm: WebinarSakuraComment = comments[commentIdxRef.current];
        items.push({
          key: `s-${commentIdxRef.current}`,
          authorName: cm.authorName,
          body: cm.body,
        });
        commentIdxRef.current += 1;
      }
      // CTA カード流し込み (カードは通常コメントと同じくチャットに積む)
      const cards = src.ctas ?? [];
      while (ctaIdxRef.current < cards.length && cards[ctaIdxRef.current].atSeconds <= pos) {
        const card = cards[ctaIdxRef.current];
        trackFunnelEvent('cta_impression', card);
        items.push({
          key: `c-${card.id}`,
          authorName: '',
          body: '',
          ctaCard: card,
        });
        setActiveCta(card);
        ctaIdxRef.current += 1;
        // autoOpen: カード出現と同時にチャット欄をフォームへ切り替える
        if (card.autoOpen && card.kind === 'form') openCtaRef.current(card);
      }
      if (items.length > 0) setChat((prev) => [...prev.slice(-200), ...items]);
      // レガシー下部 CTA (cta_json) はカード未設定のウェビナーでのみ使用
      if (cards.length === 0 && src.cta && pos >= src.cta.showAtSeconds) setCtaVisible(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [state, joined, expectedPosition, trackFunnelEvent]);

  // 待機ルーム: 開始前サクラコメント (負の atSeconds) の流し込み (1秒 tick)
  useEffect(() => {
    if (!state || state.live || !state.waiting) return;
    const src = state;
    const timer = setInterval(() => {
      const pos = baseOffsetRef.current + (Date.now() - waitT0Ref.current) / 1000;
      const comments = src.comments;
      const items: ChatItem[] = [];
      while (
        commentIdxRef.current < comments.length &&
        comments[commentIdxRef.current].atSeconds <= pos
      ) {
        const cm = comments[commentIdxRef.current];
        items.push({ key: `w-${commentIdxRef.current}`, authorName: cm.authorName, body: cm.body });
        commentIdxRef.current += 1;
      }
      if (items.length > 0) setChat((prev) => [...prev.slice(-200), ...items]);
    }, 1000);
    return () => clearInterval(timer);
  }, [state]);

  // チャット自動スクロール
  useEffect(() => {
    chatBoxRef.current?.scrollTo({ top: chatBoxRef.current.scrollHeight });
  }, [chat]);

  // タブ復帰時の再同期
  useEffect(() => {
    const onVisible = () => {
      const video = videoRef.current;
      if (!IS_PREVIEW && document.visibilityState === 'visible' && video && stateRef.current?.live && joinedRef.current && !ended) {
        video.currentTime = expectedPosition();
        // バックグラウンド復帰でブラウザが muted に戻すことがあるので状態を同期
        void video.play().catch(() => undefined);
        setMuted(video.muted);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [expectedPosition, ended]);

  // ハートビート (配信終了後は送らない)
  useEffect(() => {
    if (!state?.live || !joined || ended || IS_PREVIEW) return;
    const src = state;
    const timer = setInterval(() => {
      const pos = Math.min(Math.floor(expectedPosition()), src.durationSeconds);
      void apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/heartbeat`, {
        sessionStartAt: src.sessionStartAt,
        positionSeconds: pos,
      }, ctx).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [state, joined, slug, ctx, expectedPosition, ended]);

  const sendComment = async () => {
    if (!state) return;
    // ライブ中は現在位置、待機ルーム中は次回セッション帰属の負の位置で投稿する
    let sessionStartAt: number;
    let atSeconds: number;
    if (state.live) {
      sessionStartAt = state.sessionStartAt;
      atSeconds = Math.floor(expectedPosition());
    } else if (state.waiting) {
      sessionStartAt = state.nextSessionAt;
      atSeconds = Math.floor(baseOffsetRef.current + (Date.now() - waitT0Ref.current) / 1000);
    } else {
      return;
    }
    const text = input.trim();
    if (!text) return;
    setInput('');
    setChat((prev) => [
      ...prev,
      { key: `u-${Date.now()}`, authorName: 'あなた', body: text, mine: true },
    ]);
    try {
      await apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/comments`, {
        sessionStartAt,
        atSeconds,
        body: text,
      }, ctx);
    } catch (err) {
      console.warn('comment post failed:', err);
    }
  };

  const openCta = (card: WebinarCtaCard) => {
    if (!state?.live) return;
    // クリック記録 (fire-and-forget、プレビューでは送らない)
    if (!IS_PREVIEW) {
      void apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/cta-click`, {
        sessionStartAt: state.sessionStartAt,
        ctaId: card.id,
      }, ctx).catch(() => undefined);
    }
    if (card.kind === 'url' && card.url) {
      if (typeof liff !== 'undefined' && liff.isInClient()) {
        liff.openWindow({ url: card.url, external: true });
      } else {
        window.open(card.url, '_blank', 'noopener');
      }
      return;
    }
    if (card.kind === 'form' && card.formId) {
      trackFunnelEvent('form_open', card);
      setFormSheet({ cta: card, phase: 'loading' });
      // 開封記録 (フォーム機能側のファネル計測に乗せる)
      if (!IS_PREVIEW) {
        // 帰属は Authorization の LINE ID トークンで判定される (body の ID は無視)
        void fetch(`/api/forms/${encodeURIComponent(card.formId)}/opened`, {
          method: 'POST',
          headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
          body: JSON.stringify({}),
        }).catch(() => undefined);
      }
      void fetch(`/api/forms/${encodeURIComponent(card.formId)}`)
        .then(async (r) => {
          const json = (await r.json()) as { success: boolean; data?: FormDef };
          if (!r.ok || !json.success || !json.data) throw new Error('form fetch failed');
          // シートが閉じられた/別カードに切り替わった後の遅延解決で上書きしない
          setFormSheet((prev) =>
            prev && prev.phase === 'loading' && prev.cta.id === card.id
              ? { cta: card, phase: 'form', def: json.data! }
              : prev,
          );
        })
        .catch(() => {
          setFormSheet((prev) =>
            prev && prev.phase === 'loading' && prev.cta.id === card.id
              ? {
                  cta: card, phase: 'error',
                  message: 'フォームを読み込めませんでした。もう一度お試しください。',
                }
              : prev,
          );
        });
    }
  };

  openCtaRef.current = openCta;

  const toggleMute = () => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
    setNeedsTap(false);
    void v.play().catch(() => undefined);
  };

  const clickCta = () => {
    if (!state?.live || !state.cta) return;
    void apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/cta-click`, {
      sessionStartAt: state.sessionStartAt,
    }, ctx).catch(() => undefined);
    const url = state.cta.url;
    if (typeof liff !== 'undefined' && liff.isInClient()) {
      liff.openWindow({ url, external: true });
    } else {
      window.open(url, '_blank', 'noopener');
    }
  };

  const [registering, setRegistering] = useState(false);
  // 24時間分48枠を最初から見せず、直近3時間（6枠）から段階的に開く。
  const [visibleSessionCount, setVisibleSessionCount] = useState(6);
  const registerSession = async (sessionStartAt: number) => {
    if (registering) return;
    setRegistering(true);
    try {
      await apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/register`, { sessionStartAt }, ctx);
      // 現在回を開始5分以内に予約した場合、その場でサーバーの予約判定を通して
      // 再生画面へ切り替える。未来回なら予約済み表示／待機ルームへ更新される。
      await load();
    } catch (err) {
      console.warn('register failed:', err);
    } finally {
      setRegistering(false);
    }
  };

  if (error) {
    return <div className="p-8 text-center text-gray-300">{error}</div>;
  }
  if (!state) {
    return <div className="p-8 text-center text-gray-500">読み込み中...</div>;
  }

  // ---- 待機ルーム (開始10分前〜): カウントダウン + 開始前チャット ----
  if (!state.live && state.waiting) {
    return (
      <div className="flex h-dvh justify-center bg-gray-900 text-white">
        <div className="flex h-full w-full max-w-md flex-col">
          <div className="relative flex aspect-video w-full shrink-0 flex-col items-center justify-center bg-gray-800 px-4">
            <span className="absolute left-2 top-2 rounded bg-gray-600 px-2 py-0.5 text-xs font-bold">
              まもなく開始
            </span>
            <p className="text-center text-sm font-bold text-gray-200">{state.title}</p>
            <p className="mt-3 font-mono text-4xl font-bold">{countdown}</p>
            <p className="mt-1 text-sm text-gray-400">で配信が始まります</p>
          </div>

          <div ref={chatBoxRef} className="flex-1 overflow-y-auto p-3 text-sm">
            {chat.map((item) => (
              <div key={item.key} className="mb-2">
                <span className={item.mine ? 'font-medium text-[#06C755]' : 'font-medium text-gray-400'}>
                  {item.authorName}
                </span>{' '}
                <span className="text-gray-100">{item.body}</span>
              </div>
            ))}
          </div>

          <div className="flex gap-2 border-t border-gray-700 p-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void sendComment();
              }}
              placeholder="コメントを入力..."
              maxLength={500}
              className="flex-1 rounded-full bg-gray-800 px-4 py-2 text-base text-white placeholder-gray-500"
            />
            <button
              onClick={() => void sendComment()}
              className="rounded-full bg-[#06C755] px-4 py-2 text-sm font-bold active:opacity-80"
            >
              送信
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ---- セッション選択メニュー (開催回を選んで予約) ----
  if (!state.live && (state.upcoming?.length ?? 0) > 0) {
    const upcoming = state.upcoming!;
    const visibleUpcoming = upcoming.slice(0, visibleSessionCount);
    const registered = state.registeredSessionAt ?? null;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gray-900 p-6 text-white">
        <p className="mb-2 text-sm text-gray-400">ライブ配信</p>
        <h1 className="mb-1 text-center text-xl font-bold">{state.title}</h1>
        {registered !== null ? (
          <div className="mt-5 w-full max-w-sm rounded-2xl bg-gray-800 p-5 text-center">
            <p className="text-sm text-[#06C755]">✅ 予約済み</p>
            <p className="mt-2 text-lg font-bold">{formatJp(registered)} の回</p>
            <p className="mt-3 text-xs leading-relaxed text-gray-400">
              開始前にLINEで視聴リンクをお送りします。
              <br />
              時間になったらこのページも自動で配信に切り替わります
            </p>
            <p className="mt-4 text-xs text-gray-500">別の回に変更する場合はもう一度選んでください</p>
          </div>
        ) : (
          <p className="mt-2 text-sm text-gray-400">参加する回を選んでください</p>
        )}
        <div className="mt-5 flex w-full max-w-sm flex-col gap-2">
          {visibleUpcoming.map((t) => (
            <button
              key={t}
              disabled={registering}
              onClick={() => void registerSession(t)}
              className={`rounded-full py-3 text-center font-bold active:opacity-80 disabled:opacity-50 ${
                registered === t
                  ? 'bg-[#06C755] text-white'
                  : 'bg-gray-800 text-gray-100'
              }`}
            >
              {t <= Math.floor(Date.now() / 1000)
                ? `${formatJp(t)} の回（今すぐ途中参加）`
                : `${formatJp(t)} の回`}
              {registered === t ? ' ✅' : ''}
            </button>
          ))}
          {visibleUpcoming.length < upcoming.length && (
            <button
              type="button"
              onClick={() => setVisibleSessionCount((count) => Math.min(count + 6, upcoming.length))}
              className="mt-1 rounded-full border border-gray-700 py-3 text-sm font-bold text-gray-300 active:opacity-80"
            >
              もっと先の時間を見る
            </button>
          )}
        </div>
      </div>
    );
  }

  // ---- 待機画面 (スケジュール未設定・開催予定なし) ----
  if (!state.live) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gray-900 p-6 text-white">
        <p className="mb-2 text-sm text-gray-400">次回のライブ配信</p>
        <h1 className="mb-6 text-center text-xl font-bold">{state.title}</h1>
        {state.nextSessionAt !== null ? (
          <>
            <p className="text-lg">{formatJp(state.nextSessionAt)} 開始</p>
            <p className="mt-4 font-mono text-3xl font-bold">{countdown}</p>
            <p className="mt-6 text-sm text-gray-400">開始時刻になると自動的に始まります</p>
          </>
        ) : (
          <p className="text-gray-400">次回の開催は未定です</p>
        )}
      </div>
    );
  }

  // ---- ライブ参加ゲート (途中参加の強制再生を防ぐ) ----
  if (state.live && !joined) {
    const elapsedMin = Math.max(1, Math.floor(expectedPosition() / 60));
    const upcoming = state.upcoming ?? [];
    const visibleUpcoming = upcoming.slice(0, visibleSessionCount);
    const registered = state.registeredSessionAt ?? null;
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center bg-gray-900 p-6 text-white">
        <span className="rounded bg-red-600 px-2 py-0.5 text-xs font-bold">● LIVE</span>
        <h1 className="mt-3 text-center text-xl font-bold">{state.title}</h1>
        <div className="mt-5 w-full max-w-sm rounded-2xl bg-gray-800/60 p-5 text-center">
          <p className="text-sm font-bold text-gray-400">🔴 いま配信中です（{elapsedMin}分経過）</p>
          <p className="mt-2 text-xs leading-relaxed text-gray-500">
            この回への途中からの参加はできません。
            <br />
            次の回のスタートからご参加ください
          </p>
        </div>
        {upcoming.length > 0 && (
          <>
            <p className="mt-6 text-sm text-gray-300">
              {registered !== null
                ? `✅ ${formatJp(registered)} の回を予約済み`
                : '次の回を最初から予約する'}
            </p>
            <div className="mt-3 flex w-full max-w-sm flex-col gap-2">
              {visibleUpcoming.map((t) => (
                <button
                  key={t}
                  disabled={registering}
                  onClick={() => void registerSession(t)}
                  className={`rounded-full py-3 text-center font-bold active:opacity-80 disabled:opacity-50 ${
                    registered === t ? 'bg-[#06C755] text-white' : 'bg-gray-800 text-gray-100'
                  }`}
                >
                  {formatJp(t)} の回{registered === t ? ' ✅' : ''}
                </button>
              ))}
              {visibleUpcoming.length < upcoming.length && (
                <button
                  type="button"
                  onClick={() => setVisibleSessionCount((count) => Math.min(count + 6, upcoming.length))}
                  className="mt-1 rounded-full border border-gray-700 py-3 text-sm font-bold text-gray-300 active:opacity-80"
                >
                  もっと先の時間を見る
                </button>
              )}
            </div>
            {registered !== null && (
              <p className="mt-3 text-xs text-gray-500">
                開始5分前にLINEでお知らせします。このページは閉じてOKです
              </p>
            )}
          </>
        )}
      </div>
    );
  }

  // ---- ライブ / 終了画面 ----
  // PC の横長ウィンドウで video (w-full) が画面高を食い尽くしてチャット欄が
  // 潰れないよう、全体をスマホ幅カラム (max-w-md) に閉じ込めて中央寄せする。
  // スマホでは max-w-md は効かないので挙動不変。
  return (
    <div className="flex h-dvh justify-center bg-gray-900 text-white">
      <div className="flex h-full w-full max-w-md flex-col">
      <div className="relative shrink-0">
        <video ref={videoRef} className="w-full" playsInline />
        {!ended && (
          <span className={`absolute left-2 top-2 rounded px-2 py-0.5 text-xs font-bold ${IS_PREVIEW || state.replay ? 'bg-gray-600' : 'bg-red-600'}`}>
            {IS_PREVIEW ? 'PREVIEW' : state.replay ? 'REPLAY' : '● LIVE'}
          </span>
        )}
        {!ended && (
          <button
            className="absolute right-2 top-2 rounded-full bg-black/60 px-3 py-1.5 text-lg leading-none"
            onClick={toggleMute}
            aria-label={muted ? '音声をONにする' : '音声をOFFにする'}
          >
            {muted ? '🔇' : '🔊'}
          </button>
        )}
        {needsTap && muted && !ended && (
          <button
            className="absolute inset-0 flex items-center justify-center bg-black/60"
            onClick={() => {
              const v = videoRef.current;
              if (v) {
                v.muted = false;
                setMuted(false);
                void v.play().catch(() => undefined);
              }
              setNeedsTap(false);
            }}
          >
            <span className="rounded-full bg-white px-6 py-3 font-bold text-gray-900">
              タップして音声をON
            </span>
          </button>
        )}
        {ended && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-black/80">
            <p className="text-lg font-bold">配信は終了しました</p>
            <p className="mt-2 text-sm text-gray-300">ご視聴ありがとうございました</p>
          </div>
        )}
      </div>

      {IS_PREVIEW && (
        <div className="flex items-center gap-2 border-b border-gray-700 px-3 py-1.5 text-xs">
          <span className="text-gray-400">速度</span>
          {PREVIEW_RATES.map((r) => (
            <button
              key={r}
              onClick={() => {
                const v = videoRef.current;
                if (v) v.playbackRate = r;
                setRate(r);
              }}
              className={`rounded-full px-2.5 py-1 font-bold ${rate === r ? 'bg-white text-gray-900' : 'bg-gray-800 text-gray-400'}`}
            >
              {r}x
            </button>
          ))}
        </div>
      )}

      <div ref={chatBoxRef} className="flex-1 overflow-y-auto p-3 text-sm">
        {chat.map((item) =>
          item.ctaCard ? (
            <div
              key={item.key}
              className="cta-card wb-card mb-3 p-4"
            >
              <p className="text-base font-bold text-gray-900">{item.ctaCard.title}</p>
              {item.ctaCard.body && (
                <p className="mt-1 text-sm leading-relaxed text-gray-600">{item.ctaCard.body}</p>
              )}
              <button
                onClick={() => openCta(item.ctaCard!)}
                className="mt-3 w-full rounded-full bg-[#06C755] py-3 text-center text-base font-bold text-white active:opacity-80"
              >
                {item.ctaCard.buttonLabel}
              </button>
            </div>
          ) : (
            <div key={item.key} className="mb-2">
              <span className={item.mine ? 'font-medium text-[#06C755]' : 'font-medium text-gray-400'}>
                {item.authorName}
              </span>{' '}
              <span className="text-gray-100">{item.body}</span>
            </div>
          ),
        )}
      </div>

      {activeCta ? (
        <button
          onClick={() => openCta(activeCta)}
          className="mx-3 mb-2 rounded-full bg-[#06C755] py-3 text-center font-bold text-white active:opacity-80"
        >
          {activeCta.buttonLabel}
        </button>
      ) : ctaVisible && state.cta ? (
        <button
          onClick={clickCta}
          className="mx-3 mb-2 rounded-full bg-[#06C755] py-3 text-center font-bold text-white active:opacity-80"
        >
          {state.cta.label}
        </button>
      ) : null}

      {!ended && !state.replay && (
        <div className="flex gap-2 border-t border-gray-700 p-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendComment();
            }}
            placeholder="コメントを入力..."
            maxLength={500}
            className="flex-1 rounded-full bg-gray-800 px-4 py-2 text-base text-white placeholder-gray-500"
          />
          <button
            onClick={() => void sendComment()}
            className="rounded-full bg-[#06C755] px-4 py-2 text-sm font-bold active:opacity-80"
          >
            送信
          </button>
        </div>
      )}

      {formSheet && (
        <FormSheet
          sheet={formSheet}
          ctx={ctx}
          slug={slug}
          onFunnelEvent={(eventType, fieldName) =>
            trackFunnelEvent(eventType, formSheet.cta, fieldName)}
          onClose={() => setFormSheet(null)}
          onSubmitted={(def) => setFormSheet({ cta: formSheet.cta, phase: 'done', def })}
        />
      )}
      </div>
    </div>
  );
}

// ─── インラインフォームシート ─────────────────────────────
// 動画は上部で再生継続したまま、下からせり上がるシートでフォーム回答を完結させる。
// 送信は既存 POST /api/forms/:id/submit — タグ付与・シナリオ発火・回答保存が
// フォーム機能側でそのまま動く。

function FormSheet({
  sheet,
  ctx,
  slug,
  onFunnelEvent,
  onClose,
  onSubmitted,
}: {
  sheet:
    | { cta: WebinarCtaCard; phase: 'loading' }
    | { cta: WebinarCtaCard; phase: 'form'; def: FormDef }
    | { cta: WebinarCtaCard; phase: 'done'; def: FormDef }
    | { cta: WebinarCtaCard; phase: 'error'; message: string };
  ctx: WebinarContext;
  slug: string;
  onFunnelEvent: (
    eventType: 'form_start' | 'field_complete' | 'submit_attempt' |
      'submit_success' | 'submit_error',
    fieldName?: string,
  ) => void;
  onClose: () => void;
  onSubmitted: (def: FormDef) => void;
}) {
  const [values, setValues] = useState<Record<string, string | string[]>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedRef = useRef(false);
  const completedFieldsRef = useRef(new Set<string>());
  const [consultation, setConsultation] = useState<ConsultationAvailability | null>(null);
  const [consultationLoading, setConsultationLoading] = useState(false);
  const [consultationError, setConsultationError] = useState<string | null>(null);
  const [bookingStartsAt, setBookingStartsAt] = useState<string | null>(null);
  const [booked, setBooked] = useState<BookedConsultation | null>(null);

  const hasValue = (value: string | string[] | undefined) =>
    Array.isArray(value) ? value.length > 0 : typeof value === 'string' && value.trim() !== '';

  const requiredFields = sheet.phase === 'form'
    ? sheet.def.fields.filter((field) => field.required)
    : [];
  const completedRequiredCount = requiredFields.filter((field) => hasValue(values[field.name])).length;
  const remainingRequiredCount = requiredFields.length - completedRequiredCount;
  const canSubmit = sheet.phase === 'form' && remainingRequiredCount === 0;

  const setValue = (name: string, v: string | string[]) => {
    if (!startedRef.current) {
      startedRef.current = true;
      onFunnelEvent('form_start');
    }
    setError(null);
    setValues((prev) => ({ ...prev, [name]: v }));
  };

  const markFieldComplete = (name: string, value: string | string[]) => {
    if (!hasValue(value) || completedFieldsRef.current.has(name)) return;
    completedFieldsRef.current.add(name);
    onFunnelEvent('field_complete', name);
  };

  const submit = async () => {
    if (sheet.phase !== 'form' || submitting) return;
    const def = sheet.def;
    for (const f of def.fields) {
      const v = values[f.name];
      if (f.required && !hasValue(v)) {
        setError(`「${f.label}」は必須項目です`);
        return;
      }
    }
    onFunnelEvent('submit_attempt');
    setSubmitting(true);
    setError(null);
    try {
      const r = await fetch(`/api/forms/${encodeURIComponent(def.id)}/submit`, {
        method: 'POST',
        headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json' }),
        body: JSON.stringify({ data: values }),
      });
      const json = (await r.json()) as { success: boolean; error?: string };
      if (!r.ok || !json.success) {
        onFunnelEvent('submit_error');
        setError(json.error || '送信に失敗しました。もう一度お試しください。');
        setSubmitting(false);
        return;
      }
      onFunnelEvent('submit_success');
      onSubmitted(def);
    } catch {
      onFunnelEvent('submit_error');
      setError('送信に失敗しました。通信環境をご確認ください。');
      setSubmitting(false);
    }
  };

  const inputCls =
    'w-full min-w-0 rounded border border-gray-300 bg-white px-3 py-2 text-base text-gray-900';
  const todayJst = new Date(Date.now() + 9 * 3600_000).toISOString().slice(0, 10);
  const meetingDateOptions = buildMeetingDateOptions(todayJst);

  const completionUrl = sheet.phase === 'done'
    ? sheet.def.onSubmitMessageContent?.match(/https?:\/\/[^\s]+/)?.[0] ?? null
    : null;

  useEffect(() => {
    if (sheet.phase !== 'done') return;
    let cancelled = false;
    setConsultationLoading(true);
    setConsultationError(null);
    void apiGet<{ ok: true; data: ConsultationAvailability }>(
      `/api/liff/webinars/${encodeURIComponent(slug)}/consultation-slots`,
      ctx,
    )
      .then((response) => {
        if (cancelled) return;
        setConsultation(response.data);
        const existing = response.data.existingBooking;
        if (existing?.status === 'confirmed' && existing.meetUrl) {
          setBooked({
            bookingId: existing.bookingId,
            status: 'confirmed',
            startsAt: existing.startsAt,
            endsAt: '',
            meetUrl: existing.meetUrl,
            externalEventId: '',
            created: false,
          });
        }
      })
      .catch(() => {
        if (!cancelled) setConsultationError('空き枠を読み込めませんでした。');
      })
      .finally(() => {
        if (!cancelled) setConsultationLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [sheet.phase, sheet.cta.id, ctx, slug]);

  const bookSlot = async (slot: ConsultationSlot) => {
    if (bookingStartsAt) return;
    setBookingStartsAt(slot.startsAt);
    setConsultationError(null);
    try {
      const response = await apiPost<{ ok: true; data: BookedConsultation }>(
        `/api/liff/webinars/${encodeURIComponent(slug)}/consultation-book`,
        { startsAt: slot.startsAt },
        ctx,
      );
      setBooked(response.data);
    } catch (err) {
      const status = (err as { status?: number }).status;
      setConsultationError(
        status === 409
          ? 'この枠は先に予約されました。別の時間を選んでください。'
          : '日程を確定できませんでした。もう一度お試しください。',
      );
      // 競合時は最新の空き枠を取り直す。
      if (status === 409) {
        try {
          const fresh = await apiGet<{ ok: true; data: ConsultationAvailability }>(
            `/api/liff/webinars/${encodeURIComponent(slug)}/consultation-slots`,
            ctx,
          );
          setConsultation(fresh.data);
        } catch {
          // 元のエラーを維持する。
        }
      }
    } finally {
      setBookingStartsAt(null);
    }
  };

  const groupedSlots = consultation?.slots.reduce<Record<string, ConsultationSlot[]>>(
    (groups, slot) => {
      (groups[slot.date] ??= []).push(slot);
      return groups;
    },
    {},
  ) ?? {};

  const formatConsultationDate = (startsAt: string) => new Date(startsAt).toLocaleString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    month: 'long',
    day: 'numeric',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  const formatSlotDate = (date: string) => new Date(`${date}T00:00:00+09:00`).toLocaleDateString(
    'ja-JP',
    { timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', weekday: 'short' },
  );

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end">
      <button
        aria-label="閉じる"
        className="flex-1 bg-black/40"
        onClick={onClose}
      />
      <div className="mx-auto flex w-full max-w-md max-h-[75vh] flex-col overflow-hidden rounded-t-2xl bg-white p-5 text-gray-900">
        <div className="mx-auto mb-3 h-1 w-10 rounded bg-gray-300" />
        {sheet.phase === 'loading' && (
          <p className="py-8 text-center text-gray-500">読み込み中...</p>
        )}
        {sheet.phase === 'error' && (
          <div className="py-6 text-center">
            <p className="text-gray-700">{sheet.message}</p>
            <button onClick={onClose} className="mt-4 rounded bg-gray-200 px-6 py-2 font-bold">
              閉じる
            </button>
          </div>
        )}
        {sheet.phase === 'done' && (
          <div className="flex min-h-0 flex-1 flex-col py-2">
            {booked ? (
              <div className="py-5 text-center">
                <p className="text-3xl">✅</p>
                <p className="mt-2 text-xl font-bold">個別相談が確定しました</p>
                <p className="mt-3 rounded-xl bg-green-50 px-4 py-3 text-lg font-bold text-green-800">
                  {formatConsultationDate(booked.startsAt)}
                </p>
                <a
                  href={booked.meetUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="mt-4 block w-full rounded-full bg-[#06C755] px-6 py-3 font-bold text-white"
                >
                  Google Meetを確認する
                </a>
                <p className="mt-3 text-xs leading-relaxed text-gray-500">
                  LINEにも参加リンクを送りました。前日と開始1時間前にもお知らせします。
                </p>
                <button
                  onClick={onClose}
                  className="mt-5 rounded-full border border-gray-300 px-8 py-2.5 font-bold text-gray-600 active:opacity-80"
                >
                  ライブに戻る
                </button>
              </div>
            ) : consultationLoading ? (
              <div className="py-10 text-center">
                <p className="text-lg font-bold">回答を受け付けました</p>
                <p className="mt-2 text-sm text-gray-500">実際の空き枠を確認しています...</p>
              </div>
            ) : consultation?.calendarReady ? (
              <>
                <div className="shrink-0 text-center">
                  <p className="text-2xl">📅</p>
                  <p className="mt-1 text-lg font-bold">このまま相談日時を確定</p>
                  <p className="mt-1 text-xs text-gray-500">
                    空いている枠だけを表示しています。選ぶとMeetまで自動発行されます。
                  </p>
                </div>
                <div className="mt-4 min-h-0 flex-1 space-y-4 overflow-y-auto pb-3">
                  {Object.keys(groupedSlots).length === 0 ? (
                    <p className="rounded-xl bg-gray-50 p-4 text-center text-sm text-gray-500">
                      現在、選べる枠がありません。
                    </p>
                  ) : Object.entries(groupedSlots).map(([date, slots]) => (
                    <section key={date}>
                      <h3 className="mb-2 text-left text-sm font-bold text-gray-700">
                        {formatSlotDate(date)}
                      </h3>
                      <div className="grid grid-cols-3 gap-2">
                        {slots.map((slot) => (
                          <button
                            key={slot.startsAt}
                            onClick={() => void bookSlot(slot)}
                            disabled={bookingStartsAt !== null}
                            className="rounded-lg border border-[#06C755] bg-white py-2.5 text-sm font-bold text-[#049f45] active:bg-green-50 disabled:opacity-50"
                          >
                            {bookingStartsAt === slot.startsAt ? '確定中...' : slot.start}
                          </button>
                        ))}
                      </div>
                    </section>
                  ))}
                </div>
                {consultationError && (
                  <p className="mt-2 shrink-0 text-center text-sm font-bold text-red-600">
                    {consultationError}
                  </p>
                )}
              </>
            ) : (
              <div className="py-6 text-center">
                <p className="text-2xl">🎉</p>
                <p className="mt-2 text-lg font-bold">回答を送信しました</p>
                <p className="mt-1 text-sm text-gray-500">
                  空いている15分枠を1つ選んでください。
                </p>
                {(consultation?.fallbackUrl || completionUrl) && (
                  <button
                    onClick={() => {
                      const url = consultation?.fallbackUrl || completionUrl;
                      if (url) window.location.assign(url);
                    }}
                    className="mt-5 w-full rounded-full bg-[#06C755] px-6 py-3 font-bold text-white active:opacity-80"
                  >
                    予約カレンダーを開く
                  </button>
                )}
                {consultationError && (
                  <p className="mt-3 text-sm text-red-600">{consultationError}</p>
                )}
                <button
                  onClick={onClose}
                  className="mt-4 rounded-full border border-gray-300 px-8 py-2.5 font-bold text-gray-600 active:opacity-80"
                >
                  あとで予約する
                </button>
              </div>
            )}
          </div>
        )}
        {sheet.phase === 'form' && (
          <div className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-y-auto pb-4">
              <h2 className="text-lg font-bold">{sheet.def.name}</h2>
              {sheet.def.description && (
                <p className="mt-1 text-sm text-gray-500">{sheet.def.description}</p>
              )}
              <div className="mt-4 space-y-4 pb-2">
                {sheet.def.fields.map((f) => {
                const dateMatch = /^meeting_date_(\d+)$/.exec(f.name);
                const timeMatch = /^meeting_time_(\d+)$/.exec(f.name);
                if (
                  timeMatch &&
                  sheet.def.fields.some((candidate) => candidate.name === `meeting_date_${timeMatch[1]}`)
                ) {
                  return null;
                }
                if (dateMatch) {
                  const order = dateMatch[1];
                  const timeField = sheet.def.fields.find(
                    (candidate) => candidate.name === `meeting_time_${order}`,
                  );
                  if (timeField) {
                    return (
                      <fieldset key={f.name} className="rounded-xl border border-gray-200 bg-gray-50 p-3">
                        <legend className="px-1 text-sm font-bold text-gray-700">
                          第{order}希望
                          {(f.required || timeField.required) && (
                            <span className="ml-1 text-red-500">*</span>
                          )}
                        </legend>
                        <div className="grid grid-cols-[minmax(0,1.15fr)_minmax(0,0.85fr)] gap-2">
                          <label className="block text-xs font-medium text-gray-600">
                            日付
                            <select
                              value={(values[f.name] as string) ?? ''}
                              onChange={(e) => {
                                setValue(f.name, e.target.value);
                                markFieldComplete(f.name, e.target.value);
                              }}
                              className={`mt-1 ${inputCls}`}
                            >
                              <option value="">日付を選択</option>
                              {meetingDateOptions.map((option) => (
                                <option key={option.value} value={option.value}>
                                  {option.label}
                                </option>
                              ))}
                            </select>
                          </label>
                          <label className="block text-xs font-medium text-gray-600">
                            開始時刻
                            <select
                              value={(values[timeField.name] as string) ?? ''}
                              onChange={(e) => {
                                setValue(timeField.name, e.target.value);
                                markFieldComplete(timeField.name, e.target.value);
                              }}
                              className={`mt-1 ${inputCls}`}
                            >
                              <option value="">選択</option>
                              {(timeField.options ?? []).map((option) => (
                                <option key={option} value={option}>{option}</option>
                              ))}
                            </select>
                          </label>
                        </div>
                      </fieldset>
                    );
                  }
                }
                return (
                <label key={f.name} className="block text-sm">
                  <span className="font-medium">
                    {f.label}
                    {f.required && <span className="ml-1 text-red-500">*</span>}
                  </span>
                  {f.type === 'textarea' ? (
                    <textarea
                      rows={3}
                      placeholder={f.placeholder}
                      value={(values[f.name] as string) ?? ''}
                      onChange={(e) => setValue(f.name, e.target.value)}
                      onBlur={(e) => markFieldComplete(f.name, e.target.value)}
                      className={`mt-1 ${inputCls}`}
                    />
                  ) : f.type === 'select' ? (
                    <select
                      value={(values[f.name] as string) ?? ''}
                      onChange={(e) => {
                        setValue(f.name, e.target.value);
                        markFieldComplete(f.name, e.target.value);
                      }}
                      className={`mt-1 ${inputCls}`}
                    >
                      <option value="">選択してください</option>
                      {(f.options ?? []).map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : f.type === 'radio' ? (
                    <div className="mt-1 space-y-1.5">
                      {(f.options ?? []).map((o) => (
                        <label key={o} className="flex items-center gap-2">
                          <input
                            type="radio"
                            name={f.name}
                            checked={values[f.name] === o}
                            onChange={() => {
                              setValue(f.name, o);
                              markFieldComplete(f.name, o);
                            }}
                          />
                          <span>{o}</span>
                        </label>
                      ))}
                    </div>
                  ) : f.type === 'checkbox' ? (
                    <div className="mt-1 space-y-1.5">
                      {(f.options ?? []).map((o) => {
                        const cur = (values[f.name] as string[]) ?? [];
                        return (
                          <label key={o} className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={cur.includes(o)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...cur, o]
                                  : cur.filter((x) => x !== o);
                                setValue(f.name, next);
                                markFieldComplete(f.name, next);
                              }}
                            />
                            <span>{o}</span>
                          </label>
                        );
                      })}
                    </div>
                  ) : (
                    <input
                      type={f.type}
                      placeholder={f.placeholder}
                      value={(values[f.name] as string) ?? ''}
                      onChange={(e) => setValue(f.name, e.target.value)}
                      onBlur={(e) => markFieldComplete(f.name, e.target.value)}
                      className={`mt-1 ${inputCls}`}
                    />
                  )}
                </label>
                );
                })}
              </div>
              {error && <p className="mt-2 text-sm font-bold text-red-600">{error}</p>}
            </div>
            <div className="-mx-5 -mb-5 shrink-0 border-t border-gray-200 bg-white px-5 pb-4 pt-3 shadow-[0_-4px_12px_rgba(0,0,0,0.06)]">
              <p className="mb-2 text-center text-xs font-bold text-gray-600" aria-live="polite">
                {canSubmit
                  ? `${requiredFields.length}項目の回答が完了しました`
                  : `入力完了 ${completedRequiredCount}/${requiredFields.length}`}
              </p>
              <button
                onClick={() => void submit()}
                disabled={submitting || !canSubmit}
                className="w-full rounded-full bg-[#06C755] py-3 text-base font-bold text-white shadow disabled:bg-gray-300 disabled:text-gray-500 disabled:opacity-100 active:opacity-80"
              >
                {submitting
                  ? '送信中...'
                  : canSubmit
                    ? '回答を送信して相談日時を選ぶ'
                    : `あと${remainingRequiredCount}項目を選択`}
              </button>
              <p className="mt-2 text-center text-xs text-gray-500">
                送信後、空いている15分枠を選べます
              </p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export function mountWebinar(container: HTMLElement, ctx: WebinarContext, slug: string): void {
  document.body.classList.add('wb-active');
  container.innerHTML = '';
  _root?.unmount();
  _root = createRoot(container);
  _root.render(
    <StrictMode>
      <WebinarApp ctx={ctx} slug={slug} />
    </StrictMode>,
  );
}
