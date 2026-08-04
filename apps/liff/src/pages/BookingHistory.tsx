import { useEffect, useState } from 'react';
import { api, type BookingHistoryItem } from '../lib/api.js';
import HistoryCard from '../components/HistoryCard.js';

export default function BookingHistory() {
  const [data, setData] = useState<{ upcoming: BookingHistoryItem[]; past: BookingHistoryItem[] } | null>(
    null,
  );
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');

  useEffect(() => {
    api.me().then(setData);
  }, []);

  if (!data) return <div className="p-4 text-gray-500">読み込み中...</div>;
  const list = tab === 'upcoming' ? data.upcoming : data.past;

  return (
    <div className="max-w-md mx-auto p-4 space-y-4">
      <div className="flex border-b">
        <button
          onClick={() => setTab('upcoming')}
          className={`flex-1 py-2 ${tab === 'upcoming' ? 'border-b-2 border-blue-600 font-semibold' : ''}`}
        >
          これから ({data.upcoming.length})
        </button>
        <button
          onClick={() => setTab('past')}
          className={`flex-1 py-2 ${tab === 'past' ? 'border-b-2 border-blue-600 font-semibold' : ''}`}
        >
          過去 ({data.past.length})
        </button>
      </div>
      {list.length === 0 ? (
        <p className="text-gray-500 text-center pt-8">まだ予約がありません。</p>
      ) : (
        <ul className="space-y-2">
          {list.map((b) => (
            <HistoryCard key={b.id} booking={b} />
          ))}
        </ul>
      )}
      <p className="text-xs text-gray-500 pt-4">
        変更・キャンセルはお店に LINE で直接ご連絡ください。
      </p>
    </div>
  );
}
