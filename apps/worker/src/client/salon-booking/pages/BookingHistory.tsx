import { useEffect, useState } from 'react';
import { createApi, type BookingHistoryItem } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';
import HistoryCard from '../components/HistoryCard.js';

export default function BookingHistory() {
  const ctx = useSalonContext();
  const labels = ctx.labels;
  const [data, setData] = useState<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] } | null>(
    null,
  );
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    createApi(ctx)
      .me()
      .then(setData)
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ctx]);

  if (error) {
    return (
      <div className="sb-fade-in space-y-5">
        <div className="sb-card text-center">
          <p className="text-red-600 text-sm mb-2">予約履歴の取得に失敗しました</p>
          <p className="text-gray-500 text-xs mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm font-semibold sb-line-green-text underline"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
  if (!data) {
    return (
      <div className="flex flex-col items-center py-12 sb-fade-in">
        <div className="sb-spinner" />
        <p className="text-sm text-gray-500 mt-3">読み込み中…</p>
      </div>
    );
  }
  const list = tab === 'upcoming' ? data.upcoming : data.past;

  return (
    <div className="space-y-4 sb-fade-in">
      <div
        className="grid grid-cols-2 rounded-xl overflow-hidden"
        style={{ background: '#fff', boxShadow: '0 1px 2px rgba(0,0,0,0.04)' }}
      >
        <button
          onClick={() => setTab('upcoming')}
          className="py-3 text-sm font-semibold transition-colors"
          style={{
            background: tab === 'upcoming' ? '#06C755' : '#fff',
            color: tab === 'upcoming' ? '#fff' : '#6b7280',
          }}
        >
          これから ({data.upcoming.length})
        </button>
        <button
          onClick={() => setTab('past')}
          className="py-3 text-sm font-semibold transition-colors"
          style={{
            background: tab === 'past' ? '#06C755' : '#fff',
            color: tab === 'past' ? '#fff' : '#6b7280',
          }}
        >
          過去 ({data.past.length})
        </button>
      </div>
      {list.length === 0 ? (
        <div className="sb-card text-center text-sm text-gray-500 py-8">
          {tab === 'upcoming' ? 'これからの予約はありません' : '過去の予約はありません'}
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => (
            <HistoryCard key={b.id} booking={b} />
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-400 text-center pt-2">
        {labels.historyContactNotice}
      </p>
    </div>
  );
}
