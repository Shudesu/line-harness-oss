import { useState } from 'react';
import { createApi, type MenuItem, type StaffItem } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';
import { jstStartsAtIso, formatJp } from '../lib/datetime.js';

export default function Confirm({
  menu,
  staff,
  slot,
  onSubmitted,
  onBack,
}: {
  menu: MenuItem;
  staff: StaffItem;
  slot: { date: string; start: string };
  onSubmitted: () => void;
  onBack: () => void;
}) {
  const ctx = useSalonContext();
  const labels = ctx.labels;
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(() => crypto.randomUUID());

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);
    try {
      await createApi(ctx).createRequest(
        {
          menu_id: menu.id,
          staff_id: staff.id,
          starts_at: jstStartsAtIso(slot.date, slot.start),
          customer_note: note || undefined,
        },
        idemKey,
      );
      onSubmitted();
    } catch (e) {
      const err = e as { status?: number; body?: { error?: string } };
      if (err.status === 409 && err.body?.error === 'slot_conflict') {
        setError('この時間枠は他の方の予約と重なりました。日時を選び直してください。');
      } else {
        setError('予約リクエストの送信に失敗しました。時間をおいて再度お試しください。');
      }
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="space-y-4 sb-slide-up">
      <button onClick={onBack} className="sb-back-btn">
        <span aria-hidden>←</span>
        戻る
      </button>
      <div>
        <h1 className="text-base font-bold text-gray-900">内容のご確認</h1>
        <p className="text-xs text-gray-500 mt-1">step 4 / 4</p>
      </div>
      <div className="sb-card">
        <dl className="space-y-3 text-sm">
          <Row label={labels.confirmMenuLabel} value={menu.name} />
          <Row label={labels.confirmStaffLabel} value={staff.display_name} />
          <Row label="日時" value={`${formatJp(slot.date)} ${slot.start}`} />
          <Row label="所要" value={`${staff.duration_minutes} 分`} />
          {staff.price !== 0 && (
            <Row
              label={labels.confirmPriceLabel}
              value={`¥${staff.price.toLocaleString()}`}
              valueClassName="font-bold text-base sb-line-green-text"
            />
          )}
        </dl>
      </div>
      <label className="block">
        <span className="text-xs font-medium text-gray-600 mb-1 block">{labels.noteLabel}</span>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          className="w-full border border-gray-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500 resize-y bg-white"
          rows={3}
          placeholder={labels.notePlaceholder}
        />
      </label>
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-700 text-sm">
          {error}
        </div>
      )}
      <button
        onClick={handleSubmit}
        disabled={submitting}
        className="w-full text-white py-3.5 rounded-xl font-bold disabled:opacity-50"
        style={{ background: '#06C755', boxShadow: '0 1px 3px rgba(6, 199, 85, 0.3)' }}
      >
        {submitting ? '送信中…' : '予約をリクエスト'}
      </button>
      <p className="text-xs text-gray-400 text-center">
        確定すると LINE に通知が届きます
      </p>
    </div>
  );
}

function Row({
  label,
  value,
  valueClassName,
}: {
  label: string;
  value: string;
  valueClassName?: string;
}) {
  return (
    <div className="flex justify-between items-center pb-3 border-b border-gray-100 last:border-b-0 last:pb-0">
      <dt className="text-gray-500 text-xs">{label}</dt>
      <dd className={`text-gray-900 ${valueClassName ?? ''}`}>{value}</dd>
    </div>
  );
}
