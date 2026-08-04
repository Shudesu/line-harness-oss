import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api, type EventDetail, type EventSlot } from '../lib/api.js';

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

function nanoid(): string {
  return crypto.randomUUID();
}

export default function EventConfirm() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const slotId = search.get('slotId') ?? '';
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slot, setSlot] = useState<EventSlot | null>(null);
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Stable Idempotency-Key — regenerate would defeat the purpose if user
  // taps twice. One key per Confirm-screen mount.
  const idemKey = useMemo(() => nanoid(), []);

  useEffect(() => {
    if (!id || !slotId) return;
    let cancelled = false;
    async function load() {
      try {
        const [e, s] = await Promise.all([api.getEvent(id!), api.getEventSlots(id!)]);
        if (cancelled) return;
        setEvent(e);
        const found = s.items.find((x) => x.id === slotId);
        if (!found) {
          // 枠が消えた / 満員でフィルタアウト / 開始済 → 詳細画面に戻すべき。
          // null のまま放置すると無限ローディングになる。
          setError('選択した枠は受付終了しました。別の日時をお選びください。');
          return;
        }
        setSlot(found);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id, slotId]);

  async function submit() {
    if (!id || !slotId) return;
    if (note.length > 5000) {
      setError('備考は5000字以内で入力してください');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await api.createEventBooking(id, { slot_id: slotId, customer_note: note || null }, idemKey);
      navigate(`/events/${id}/done?bookingId=${res.id}&status=${res.status}`);
    } catch (err) {
      const e = err as { status?: number; body?: { error?: string } };
      const code = e.body?.error;
      const msg = (() => {
        switch (code) {
          case 'slot_full': return 'すでに満員になりました。別の日時をお選びください。';
          case 'over_friend_limit': return 'このイベントへの予約上限に達しています。';
          case 'slot_started': return 'この枠は既に開始されています。';
          case 'slot_inactive': return 'この枠は受付を締め切りました。';
          case 'event_unpublished': return 'このイベントは現在受付を停止しています。';
          case 'unauthorized':
          case 'friend_not_found':
            return 'LINE 認証に失敗しました。一度 LINE のトークルームに戻り、友だち追加が完了していることを確認してから再度お試しください。';
          case 'idempotent_in_progress': return '前回のリクエストを処理中です。少しお待ちください。';
          default: return err instanceof Error ? err.message : String(err);
        }
      })();
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (error) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-700 mb-4">{error}</div>
        <button
          onClick={() => navigate(`/events/${id}`)}
          className="px-4 py-2 border rounded"
        >
          イベントページに戻る
        </button>
      </div>
    );
  }
  if (!event || !slot) {
    return <div className="p-8 text-center text-gray-500">読み込み中...</div>;
  }

  return (
    <div className="p-4 pb-20">
      <h1 className="text-lg font-bold mb-3">予約内容の確認</h1>
      <div className="border rounded p-3 mb-4 space-y-1">
        <div className="text-sm font-semibold">{event.name}</div>
        <div className="text-sm text-gray-700">📅 {formatJp(slot.starts_at)}</div>
        {event.venue_name && <div className="text-sm text-gray-700">📍 {event.venue_name}</div>}
      </div>

      {event.requires_approval === 1 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs rounded p-2 mb-3">
          このイベントは承認制です。受付後、運営が承認するまでお待ちください。
        </div>
      )}

      <label className="block text-sm font-medium mb-1">備考（任意）</label>
      <textarea
        value={note}
        onChange={(e) => setNote(e.target.value)}
        rows={4}
        maxLength={5000}
        className="w-full border rounded p-2 text-sm"
        placeholder="質問や伝えたいことがあれば..."
      />
      <div className="text-xs text-gray-500 text-right">{note.length} / 5000</div>

      {error && <div className="bg-red-50 text-red-700 p-2 rounded mt-2 text-sm">{error}</div>}

      <button
        onClick={submit}
        disabled={submitting}
        className="mt-5 w-full py-3 bg-blue-600 text-white rounded font-medium disabled:opacity-50"
      >
        {submitting ? '送信中...' : '予約をリクエスト'}
      </button>
      <button
        onClick={() => navigate(-1)}
        disabled={submitting}
        className="mt-2 w-full py-2 text-gray-600 text-sm"
      >
        戻る
      </button>
    </div>
  );
}
