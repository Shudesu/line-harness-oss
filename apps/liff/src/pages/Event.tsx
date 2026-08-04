import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api, type EventDetail, type EventSlot, type EventBookingMine } from '../lib/api.js';

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    weekday: 'short',
  });
}

export default function Event() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [myActive, setMyActive] = useState<EventBookingMine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    async function load() {
      try {
        // GET 系はパブリック（liffId 経由のアカウント解決のみ）。これらは
        // 失敗するとイベント詳細が出せないので全体失敗扱い。
        const [e, s] = await Promise.all([
          api.getEvent(id!),
          api.getEventSlots(id!),
        ]);
        if (cancelled) return;
        setEvent(e);
        setSlots(s.items);

        // 自分の予約数は id_token verify が必要。LIFF が Login Channel に
        // 紐付いてない / login_channel_id 未登録 / friend 未追加など、いろん
        // な要因で 401 になる可能性がある。バッジ表示が落ちるだけなので
        // best-effort にして本画面は描画を続ける。
        try {
          const [upcoming, past] = await Promise.all([
            api.myEventBookings('upcoming'),
            api.myEventBookings('past'),
          ]);
          if (cancelled) return;
          const all = [...upcoming.items, ...past.items];
          setMyActive(
            all.filter(
              (b) => b.event_id === e.id && (b.status === 'requested' || b.status === 'confirmed'),
            ),
          );
        } catch (authErr) {
          // 認証なし → 自分の予約数バッジを出さずに通常表示で続行。
          console.warn('[event] me bookings unavailable:', authErr);
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [id]);

  if (loading) return <div className="p-8 text-center text-gray-500">読み込み中...</div>;
  if (error) return <div className="p-4 bg-red-50 text-red-700">{error}</div>;
  if (!event) return null;

  const myCount = myActive.length;
  const max = event.max_bookings_per_friend;
  const overLimit = max != null && myCount >= max;

  return (
    <div className="pb-16">
      {event.image_url ? (
        <img src={event.image_url} alt="" className="w-full h-48 object-cover bg-gray-100" />
      ) : (
        <div className="w-full h-48 bg-gradient-to-br from-blue-100 to-blue-200" />
      )}
      <div className="p-4">
        <h1 className="text-xl font-bold mb-2">{event.name}</h1>
        {event.venue_name && (
          <div className="text-sm text-gray-700 mb-1">📍 {event.venue_name}</div>
        )}
        {event.venue_url && (
          <a
            href={event.venue_url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-sm text-blue-600 break-all underline"
          >
            {event.venue_url}
          </a>
        )}
        {event.description && (
          <div
            className={`mt-3 text-sm whitespace-pre-wrap ${event.description_centered === 1 ? 'text-center' : ''}`}
          >
            {event.description}
          </div>
        )}

        {max != null && (
          <div className="mt-3 inline-block bg-gray-100 text-xs px-2 py-1 rounded">
            あなたの予約 {myCount} / {max}
          </div>
        )}

        <h2 className="font-semibold mt-5 mb-2">日時を選択</h2>
        {slots.length === 0 ? (
          <div className="text-sm text-gray-500">現在予約可能な枠はありません。</div>
        ) : (
          <ul className="space-y-2">
            {slots.map((s) => {
              const full = s.remaining != null && s.remaining <= 0;
              const disabled = full || overLimit;
              return (
                <li key={s.id}>
                  <button
                    disabled={disabled}
                    onClick={() => navigate(`/events/${id}/confirm?slotId=${s.id}`)}
                    className={`w-full p-3 border rounded text-left flex justify-between items-center ${
                      disabled ? 'bg-gray-100 text-gray-400 cursor-not-allowed' : 'hover:bg-blue-50'
                    }`}
                  >
                    <span className="text-sm">{formatJp(s.starts_at)}</span>
                    <span className="text-xs">
                      {full
                        ? '満員'
                        : s.capacity == null
                        ? '定員なし'
                        : `残 ${s.remaining}`}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        )}
        {overLimit && (
          <div className="mt-3 text-xs text-red-600">
            このイベントへの予約上限（{max}）に達しています。
          </div>
        )}

        <div className="mt-6 text-center">
          <button
            onClick={() => navigate('/events/me')}
            className="text-sm text-blue-600 underline"
          >
            予約履歴を見る
          </button>
        </div>
      </div>
    </div>
  );
}
