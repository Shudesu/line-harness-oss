import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { jstToday, addDays, formatJp } from '../lib/datetime.js';

export default function DateTimePicker({
  menuId,
  staffId,
  ctaLabel,
  onSelect,
  onBack,
}: {
  menuId: string;
  staffId: string;
  ctaLabel: string;
  onSelect: (s: { date: string; start: string }) => void;
  onBack: () => void;
}) {
  const [from] = useState(jstToday());
  const [to] = useState(addDays(jstToday(), 13));
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [emptyReason, setEmptyReason] = useState<'no_working_hours' | 'calendar_unavailable' | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .availability(menuId, staffId, from, to)
      .then((r) => {
        const staff = r.by_staff[0];
        const slots = staff?.slots ?? [];
        const grouped: Record<string, string[]> = {};
        for (const s of slots) (grouped[s.date] ??= []).push(s.start);
        setByDate(grouped);
        if (slots.length > 0) {
          setEmptyReason(null);
        } else {
          const sync = r.calendar_sync?.find((c) => c.staff_id === staff?.staff_id);
          if (sync?.configured && !sync.ok) setEmptyReason('calendar_unavailable');
          else if (staff?.has_working_hours === false) setEmptyReason('no_working_hours');
          else setEmptyReason(null);
        }
      })
      .catch((e) => setError(String(e)));
  }, [menuId, staffId, from, to]);

  if (error) return <p className="text-red-600">{error}</p>;
  if (!byDate) return <div className="text-gray-500">空き枠を取得中...</div>;

  const dates = Object.keys(byDate);
  return (
    <div className="space-y-3">
      <button onClick={onBack} className="text-sm text-gray-500">← 戻る</button>
      <h1 className="text-xl font-bold">日時を選んでください</h1>
      <p className="text-xs text-gray-500">{ctaLabel}</p>
      {dates.length === 0 ? (
        emptyReason === 'no_working_hours' ? (
          <div className="mt-4 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900 space-y-2">
            <p className="font-semibold">予約受付時間が未設定のため、予約枠を表示できません。</p>
            <p className="text-xs text-amber-800">
              店舗管理者の方へ: 管理画面の「予約スタッフ → シフト」で受付時間を保存すると、予約枠が表示されるようになります。
            </p>
          </div>
        ) : emptyReason === 'calendar_unavailable' ? (
          <p className="text-gray-500 mt-4">
            カレンダーとの同期に失敗したため、予約枠を表示できません。時間をおいて再度お試しください。
          </p>
        ) : (
          <p className="text-gray-500 mt-4">この期間に空きはありません。</p>
        )
      ) : (
        <div className="space-y-4">
          {dates.map((date) => (
            <section key={date}>
              <h2 className="font-semibold mb-2">{formatJp(date)}</h2>
              <div className="grid grid-cols-4 gap-2">
                {byDate[date].map((t) => (
                  <button
                    key={t}
                    onClick={() => onSelect({ date, start: t })}
                    className="border rounded py-2 text-sm hover:bg-gray-50 active:bg-gray-100"
                  >
                    {t}
                  </button>
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
