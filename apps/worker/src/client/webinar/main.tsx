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

interface WebinarSakuraComment {
  atSeconds: number;
  authorName: string;
  body: string;
}

type WebinarState =
  | {
      live: true;
      title: string;
      durationSeconds: number;
      sessionStartAt: number;
      offsetSeconds: number;
      playlistUrl: string;
      cta: WebinarCta | null;
      comments: WebinarSakuraComment[];
    }
  | { live: false; title: string; nextSessionAt: number | null };

interface ChatItem {
  key: string;
  authorName: string;
  body: string;
  mine?: boolean;
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
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [ctaVisible, setCtaVisible] = useState(false);
  const [muted, setMuted] = useState(true);
  const [rate, setRate] = useState(1);
  const rateRef = useRef(1);
  rateRef.current = rate;

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const t0Ref = useRef(0);            // state 受信時の performance.now()
  const baseOffsetRef = useRef(0);    // state.offsetSeconds
  const commentIdxRef = useRef(0);    // 次に表示するサクラコメント index
  const chatBoxRef = useRef<HTMLDivElement | null>(null);
  const stateRef = useRef<WebinarState | null>(null);
  stateRef.current = state;

  const expectedPosition = useCallback(
    () => baseOffsetRef.current + (performance.now() - t0Ref.current) / 1000,
    [],
  );

  const load = useCallback(async () => {
    try {
      const s = await apiGet<WebinarState>(`/api/liff/webinars/${encodeURIComponent(slug)}`, ctx);
      if (s.live) {
        t0Ref.current = performance.now();
        baseOffsetRef.current = s.offsetSeconds;
        commentIdxRef.current = 0;
        setChat([]);
        setCtaVisible(false);
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
    if (!state?.live) return;
    const video = videoRef.current;
    if (!video) return;
    let hls: { destroy: () => void } | null = null;
    let cancelled = false;

    async function setup() {
      const v = video!;
      const src = state as Extract<WebinarState, { live: true }>;
      if (v.canPlayType('application/vnd.apple.mpegurl')) {
        v.src = src.playlistUrl;
      } else {
        const { default: Hls } = await import('hls.js');
        if (cancelled) return;
        if (!Hls.isSupported()) {
          setError('この端末では再生できません。');
          return;
        }
        const instance = new Hls();
        instance.loadSource(src.playlistUrl);
        instance.attachMedia(v);
        hls = instance;
      }
      v.muted = true;
      setMuted(true);
      if (IS_PREVIEW) v.controls = true;
      const seekAndPlay = () => {
        v.currentTime = IS_PREVIEW ? 0 : expectedPosition();
        v.play().then(() => setNeedsTap(true)).catch(() => setNeedsTap(true));
      };
      if (v.readyState >= 1) seekAndPlay();
      else v.addEventListener('loadedmetadata', seekAndPlay, { once: true });
    }
    void setup();
    return () => {
      cancelled = true;
      hls?.destroy();
    };
  }, [state, expectedPosition]);

  // ライブ進行: ドリフト補正・サクラコメント・CTA・終了判定 (1秒 tick)
  // プレビューは video.currentTime を位置の真とし、巻き戻しシークにも追従する
  const lastTickPosRef = useRef(0);
  useEffect(() => {
    if (!state?.live) return;
    const src = state;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const pos = IS_PREVIEW ? (video?.currentTime ?? 0) : expectedPosition();
      if (IS_PREVIEW && pos < lastTickPosRef.current - 1) {
        // 巻き戻された: コメントを頭から再構築
        commentIdxRef.current = 0;
        setChat([]);
        setCtaVisible(false);
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
      if (
        !IS_PREVIEW &&
        video && video.readyState >= 2 && Math.abs(video.currentTime - pos) >= DRIFT_TOLERANCE
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
      if (items.length > 0) setChat((prev) => [...prev.slice(-200), ...items]);
      if (src.cta && pos >= src.cta.showAtSeconds) setCtaVisible(true);
    }, 1000);
    return () => clearInterval(timer);
  }, [state, expectedPosition]);

  // チャット自動スクロール
  useEffect(() => {
    chatBoxRef.current?.scrollTo({ top: chatBoxRef.current.scrollHeight });
  }, [chat]);

  // タブ復帰時の再同期
  useEffect(() => {
    const onVisible = () => {
      const video = videoRef.current;
      if (!IS_PREVIEW && document.visibilityState === 'visible' && video && stateRef.current?.live && !ended) {
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
    if (!state?.live || ended || IS_PREVIEW) return;
    const src = state;
    const timer = setInterval(() => {
      const pos = Math.min(Math.floor(expectedPosition()), src.durationSeconds);
      void apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/heartbeat`, {
        sessionStartAt: src.sessionStartAt,
        positionSeconds: pos,
      }, ctx).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [state, slug, ctx, expectedPosition, ended]);

  const sendComment = async () => {
    if (!state?.live) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    setChat((prev) => [
      ...prev,
      { key: `u-${Date.now()}`, authorName: 'あなた', body: text, mine: true },
    ]);
    try {
      await apiPost(`/api/liff/webinars/${encodeURIComponent(slug)}/comments`, {
        sessionStartAt: state.sessionStartAt,
        atSeconds: Math.floor(expectedPosition()),
        body: text,
      }, ctx);
    } catch (err) {
      console.warn('comment post failed:', err);
    }
  };

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

  if (error) {
    return <div className="p-8 text-center text-gray-300">{error}</div>;
  }
  if (!state) {
    return <div className="p-8 text-center text-gray-500">読み込み中...</div>;
  }

  // ---- 待機画面 ----
  if (!state.live) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-6 text-white">
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

  // ---- ライブ / 終了画面 ----
  return (
    <div className="flex h-screen flex-col bg-gray-900 text-white">
      <div className="relative">
        <video ref={videoRef} className="w-full" playsInline />
        {!ended && (
          <span className={`absolute left-2 top-2 rounded px-2 py-0.5 text-xs font-bold ${IS_PREVIEW ? 'bg-gray-600' : 'bg-red-600'}`}>
            {IS_PREVIEW ? 'PREVIEW' : '● LIVE'}
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
              className={`rounded px-2 py-1 font-bold ${rate === r ? 'bg-blue-600 text-white' : 'bg-gray-800 text-gray-300'}`}
            >
              {r}x
            </button>
          ))}
        </div>
      )}

      <div ref={chatBoxRef} className="flex-1 overflow-y-auto p-3 text-sm">
        {chat.map((item) => (
          <div key={item.key} className="mb-2">
            <span className={item.mine ? 'font-bold text-green-400' : 'font-bold text-blue-300'}>
              {item.authorName}
            </span>{' '}
            <span className="text-gray-100">{item.body}</span>
          </div>
        ))}
      </div>

      {ctaVisible && state.cta && (
        <button
          onClick={clickCta}
          className="mx-3 mb-2 rounded-lg bg-orange-500 py-3 text-center font-bold text-white shadow-lg"
        >
          {state.cta.label}
        </button>
      )}

      {!ended && (
        <div className="flex gap-2 border-t border-gray-700 p-2">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void sendComment();
            }}
            placeholder="コメントを入力..."
            maxLength={500}
            className="flex-1 rounded bg-gray-800 px-3 py-2 text-base text-white placeholder-gray-500"
          />
          <button
            onClick={() => void sendComment()}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-bold"
          >
            送信
          </button>
        </div>
      )}
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
