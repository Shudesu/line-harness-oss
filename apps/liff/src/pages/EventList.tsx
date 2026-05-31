import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type EventListItem } from '../lib/api.js';

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('ja-JP', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('ja-JP', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function firstDescriptionLine(value: string | null): string {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean) || '';
}

export default function EventList() {
  const navigate = useNavigate();
  const [events, setEvents] = useState<EventListItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const res = await api.listEvents();
        if (!cancelled) setEvents(res.items);
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
  }, []);

  if (loading) return <div className="p-8 text-center text-gray-500">読み込み中...</div>;
  if (error) return <div className="p-4 bg-red-50 text-red-700">{error}</div>;

  return (
    <div className="min-h-screen bg-gray-50 pb-16">
      <div className="mx-auto max-w-xl">
        <div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-4 py-3">
          <h1 className="text-lg font-bold text-gray-900">イベント予約</h1>
          <p className="text-xs text-gray-500 mt-1">参加したいイベントを選択してください</p>
        </div>

        <div className="p-4 space-y-3">
          {events.length === 0 ? (
            <div className="bg-white border border-gray-200 rounded-lg p-6 text-center text-sm text-gray-500">
              現在予約可能なイベントはありません。
            </div>
          ) : (
            events.map((event) => {
              const description = firstDescriptionLine(event.description);
              return (
                <button
                  key={event.id}
                  type="button"
                  onClick={() => navigate(`/events/${event.id}`)}
                  className="w-full bg-white border border-gray-200 rounded-lg overflow-hidden text-left shadow-sm active:bg-gray-50"
                >
                  {event.image_url ? (
                    <img src={event.image_url} alt="" className="w-full h-36 object-cover bg-gray-100" />
                  ) : (
                    <div className="w-full h-3 bg-[#06C755]" />
                  )}
                  <div className="p-4">
                    <div className="text-xs font-semibold text-[#06C755] mb-1">
                      {formatDate(event.next_slot_starts_at)}
                      {' '}
                      {formatTime(event.next_slot_starts_at)}
                      {' - '}
                      {formatTime(event.next_slot_ends_at)}
                    </div>
                    <div className="text-base font-bold text-gray-900 leading-snug">{event.name}</div>
                    {event.venue_name && (
                      <div className="mt-2 text-xs text-gray-600">会場: {event.venue_name}</div>
                    )}
                    {description && (
                      <div className="mt-2 text-xs text-gray-500 line-clamp-2">{description}</div>
                    )}
                    <div className="mt-3 flex items-center justify-between">
                      <span className="text-xs text-gray-500">
                        {event.future_slot_count > 1 ? `${event.future_slot_count}枠` : '1枠'}
                      </span>
                      <span className="text-sm font-semibold text-[#06C755]">予約へ進む</span>
                    </div>
                  </div>
                </button>
              );
            })
          )}

          <div className="pt-2 text-center">
            <button
              onClick={() => navigate('/events/me')}
              className="text-sm text-[#06C755] underline"
            >
              予約履歴を見る
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
