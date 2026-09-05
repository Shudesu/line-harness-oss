import { useEffect, useMemo, useState } from 'react';
import { createApi } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';
import { jstToday, addDays, formatJp } from '../lib/datetime.js';
import WeekCalendar from './WeekCalendar.js';

const RANGE_DAYS = 14; // API は 14 日まで取得

export default function DateTimePicker({
  menuId,
  staffId,
  ctaLabel,
  onSelect,
  onBack,
  selected,
}: {
  menuId: string;
  staffId: string;
  ctaLabel: string;
  onSelect: (s: { date: string; start: string }) => void;
  onBack: () => void;
  selected?: { date: string; start: string } | null;
}) {
  const ctx = useSalonContext();
  const today = useMemo(() => jstToday(), []);
  const from = today;
  const to = addDays(today, RANGE_DAYS - 1);
  const maxOffset = Math.floor((RANGE_DAYS - 1) / 7);
  const [byDate, setByDate] = useState<Record<string, string[]> | null>(null);
  const [emptyReason, setEmptyReason] = useState<'no_working_hours' | 'calendar_unavailable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [weekOffset, setWeekOffset] = useState(0); // 0 = 今日始まり, 1 = +7 日

  useEffect(() => {
    setError(null);
    createApi(ctx)
      .availability(menuId, staffId, from, to)
      .then((r) => {
        const staff = r.by_staff[0];
        const slots = staff?.slots ?? [];
        if (slots.length === 0) {
          const sync = r.calendar_sync?.find((s) => s.staff_id === staff?.staff_id);
          if (sync?.configured && !sync.ok) setEmptyReason('calendar_unavailable');
          else if (staff?.has_working_hours === false) setEmptyReason('no_working_hours');
          else setEmptyReason(null);
        } else {
          setEmptyReason(null);
        }
        const grouped: Record<string, string[]> = {};
        for (const s of slots) (grouped[s.date] ??= []).push(s.start);
        setByDate(grouped);
        // 確認画面 → 戻る で再 mount されたとき、選択済みの slot を含む週を
        // 優先して復元する。これがないと 2 週目の選択が画面外に隠れる。
        if (selected) {
          for (let off = 0; off <= maxOffset; off++) {
            const ws = addDays(today, off * 7);
            for (let i = 0; i < 7; i++) {
              if (addDays(ws, i) === selected.date) {
                setWeekOffset(off);
                return;
              }
            }
          }
        }
        // 未選択時: 空きが今週ゼロ・来週にしか無いケースで離脱されないよう、
        // 最初に空きがある週まで自動で進めておく。
        for (let off = 0; off <= maxOffset; off++) {
          const ws = addDays(today, off * 7);
          let has = false;
          for (let i = 0; i < 7; i++) {
            if ((grouped[addDays(ws, i)] ?? []).length > 0) {
              has = true;
              break;
            }
          }
          if (has) {
            setWeekOffset(off);
            break;
          }
        }
      })
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
    // selected は初回 mount 時の値だけ使う（毎回再マウント前提）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ctx, menuId, staffId, from, to, today, maxOffset]);

  if (error) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="sb-card text-center">
          <p className="text-red-600 text-sm mb-2">空き枠の取得に失敗しました</p>
          <p className="text-gray-500 text-xs">{error}</p>
        </div>
      </div>
    );
  }
  if (!byDate) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="flex flex-col items-center py-12">
          <div className="sb-spinner" />
          <p className="text-sm text-gray-500 mt-3">空き枠を取得中…</p>
        </div>
      </div>
    );
  }

  // 全期間で枠ゼロかつ原因が特定できる場合は、カレンダーの代わりに理由を表示。
  // 「連携したのに枠が出ない」で原因が分からないまま詰まるのを防ぐ。
  if (emptyReason && Object.keys(byDate).length === 0) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="sb-card text-center">
          {emptyReason === 'no_working_hours' ? (
            <>
              <p className="text-sm font-bold text-gray-900 mb-2">
                予約受付時間が未設定のため、予約枠を表示できません
              </p>
              <p className="text-xs text-gray-500">
                店舗管理者の方へ: 管理画面の「予約スタッフ →
                シフト」で受付時間を保存すると、予約枠が表示されるようになります。
              </p>
            </>
          ) : (
            <>
              <p className="text-sm font-bold text-gray-900 mb-2">
                現在、予約枠を表示できません
              </p>
              <p className="text-xs text-gray-500">
                カレンダーとの同期に失敗しました。時間をおいて再度お試しください。
              </p>
            </>
          )}
        </div>
      </div>
    );
  }

  const weekStart = addDays(today, weekOffset * 7);
  const weekEnd = addDays(weekStart, 6);

  return (
    <div className="space-y-5 sb-fade-in">
      <BackButton onBack={onBack} />
      <div>
        <h1 className="text-base font-bold text-gray-900">日時を選んでください</h1>
        <p className="text-xs text-gray-500 mt-1">{ctaLabel}</p>
      </div>

      {/* 週ナビゲーション */}
      <div className="flex items-center justify-between text-sm">
        <button
          onClick={() => setWeekOffset(Math.max(0, weekOffset - 1))}
          disabled={weekOffset === 0}
          className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-30"
          style={{ background: '#f3f4f6', color: '#374151' }}
        >
          ← 前週
        </button>
        <span className="text-xs text-gray-600 tabular-nums">
          {formatJp(weekStart)} 〜 {formatJp(weekEnd)}
        </span>
        <button
          onClick={() => setWeekOffset(Math.min(maxOffset, weekOffset + 1))}
          disabled={weekOffset >= maxOffset}
          className="px-3 py-1.5 text-xs rounded-lg disabled:opacity-30"
          style={{ background: '#f3f4f6', color: '#374151' }}
        >
          次週 →
        </button>
      </div>

      <WeekCalendar
        byDate={byDate}
        weekStart={weekStart}
        onPick={onSelect}
        selectedDate={selected?.date}
        selectedStart={selected?.start}
      />

      <p className="text-[11px] text-gray-400 text-center pt-1">
        緑のセルをタップして時間を選択
      </p>
    </div>
  );
}

function BackButton({ onBack }: { onBack: () => void }) {
  return (
    <button onClick={onBack} className="sb-back-btn">
      <span aria-hidden>←</span>
      戻る
    </button>
  );
}
