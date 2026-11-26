import { useCallback, useEffect, useRef, useState } from 'react';
import { useParams } from 'react-router-dom';
import liff from '@line/liff';
import { api, type WebinarState, type WebinarSakuraComment } from '../lib/api.js';

// 疑似ライブプレーヤー。時刻の権威はサーバー:
//   期待位置 = state.offsetSeconds + (performance.now() - t0) / 1000
// 動画側がバッファ等で 5 秒以上ズレたら期待位置へ強制シーク。
// シークバー・一時停止 UI は出さない (controls なし)。

const DRIFT_TOLERANCE = 5;
const HEARTBEAT_MS = 30_000;

interface ChatItem {
  key: string;
  authorName: string;
  body: string;
  mine?: boolean;
}

function formatJp(epoch: number): string {
  return new Date(epoch * 1000).toLocaleString('ja-JP', {
    month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

export default function Webinar() {
  const { slug } = useParams<{ slug: string }>();
  const [state, setState] = useState<WebinarState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ended, setEnded] = useState(false);
  const [needsTap, setNeedsTap] = useState(false);
  const [countdown, setCountdown] = useState('');
  const [chat, setChat] = useState<ChatItem[]>([]);
  const [input, setInput] = useState('');
  const [ctaVisible, setCtaVisible] = useState(false);

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
    if (!slug) return;
    try {
      const s = await api.webinarState(slug);
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
      else setError('読み込みに失敗しました。開き直してください。');
      console.error(err);
    }
  }, [slug]);

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
      const seekAndPlay = () => {
        v.currentTime = expectedPosition();
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
  useEffect(() => {
    if (!state?.live) return;
    const src = state;
    const timer = setInterval(() => {
      const video = videoRef.current;
      const pos = expectedPosition();
      if (pos >= src.durationSeconds) {
        setEnded(true);
        video?.pause();
        clearInterval(timer);
        return;
      }
      if (video && video.readyState >= 2 && Math.abs(video.currentTime - pos) >= DRIFT_TOLERANCE) {
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
      if (document.visibilityState === 'visible' && video && stateRef.current?.live && !ended) {
        video.currentTime = expectedPosition();
        void video.play().catch(() => undefined);
      }
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => document.removeEventListener('visibilitychange', onVisible);
  }, [expectedPosition, ended]);

  // ハートビート (配信終了後は送らない)
  useEffect(() => {
    if (!state?.live || !slug || ended) return;
    const src = state;
    const timer = setInterval(() => {
      const pos = Math.min(Math.floor(expectedPosition()), src.durationSeconds);
      void api.webinarHeartbeat(slug, src.sessionStartAt, pos).catch(() => undefined);
    }, HEARTBEAT_MS);
    return () => clearInterval(timer);
  }, [state, slug, expectedPosition, ended]);

  const sendComment = async () => {
    if (!state?.live || !slug) return;
    const text = input.trim();
    if (!text) return;
    setInput('');
    setChat((prev) => [
      ...prev,
      { key: `u-${Date.now()}`, authorName: 'あなた', body: text, mine: true },
    ]);
    try {
      await api.webinarComment(slug, state.sessionStartAt, Math.floor(expectedPosition()), text);
    } catch (err) {
      console.warn('comment post failed:', err);
    }
  };

  const clickCta = () => {
    if (!state?.live || !state.cta || !slug) return;
    void api.webinarCtaClick(slug, state.sessionStartAt).catch(() => undefined);
    const url = state.cta.url;
    if (liff.isInClient()) liff.openWindow({ url, external: true });
    else window.open(url, '_blank', 'noopener');
  };

  if (error) return <div className="p-8 text-center text-gray-600">{error}</div>;
  if (!state) return <div className="p-8 text-center text-gray-400">読み込み中...</div>;

  // ---- 待機画面 ----
  if (!state.live) {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center bg-gray-900 p-6 text-white">
        <p className="mb-2 text-sm text-gray-400">次回のライブ配信</p>
        <h1 className="mb-6 text-center text-xl font-bold">{state.title}</h1>
        {state.nextSessionAt !== null ? (
          <>
            <p className="text-lg">{formatJp(state.nextSessionAt)} 開始</p>
            <p className="mt-4 text-3xl font-mono font-bold">{countdown}</p>
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
          <span className="absolute left-2 top-2 rounded bg-red-600 px-2 py-0.5 text-xs font-bold">
            ● LIVE
          </span>
        )}
        {needsTap && videoRef.current?.muted && !ended && (
          <button
            className="absolute inset-0 flex items-center justify-center bg-black/60"
            onClick={() => {
              const v = videoRef.current;
              if (v) {
                v.muted = false;
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
            className="flex-1 rounded bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500"
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
