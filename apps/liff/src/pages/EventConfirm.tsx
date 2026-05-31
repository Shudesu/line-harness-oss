import { type ReactNode, useEffect, useMemo, useState } from 'react';
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

interface SignupForm {
  name: string;
  xAccount: string;
  phone: string;
  people: string;
  companionCount: string;
  companionNames: string;
  memo: string;
}

const initialSignupForm: SignupForm = {
  name: '',
  xAccount: '',
  phone: '',
  people: '1',
  companionCount: '0',
  companionNames: '',
  memo: '',
};

function toPositiveInt(value: string): number | null {
  const trimmed = value.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const n = Number(trimmed);
  return Number.isSafeInteger(n) ? n : null;
}

function validateSignupForm(form: SignupForm): string | null {
  if (!form.name.trim()) return '名前を入力してください。';
  if (!form.phone.trim()) return '電話番号を入力してください。';
  const people = toPositiveInt(form.people);
  if (people == null || people < 1) return '人数は1以上の数字で入力してください。';
  const companionCount = toPositiveInt(form.companionCount);
  if (companionCount == null) return '同行者人数は0以上の数字で入力してください。';
  if (companionCount > people - 1) {
    return '同行者人数は、本人を除いた人数で入力してください。';
  }
  if (companionCount > 0 && !form.companionNames.trim()) {
    return '同行者がいる場合は、同行者名を入力してください。';
  }
  return null;
}

function buildCustomerNote(form: SignupForm): string {
  return [
    `名前: ${form.name.trim()}`,
    `Xアカウント: ${form.xAccount.trim()}`,
    `電話番号: ${form.phone.trim()}`,
    `人数: ${form.people.trim()}`,
    `同行者人数: ${form.companionCount.trim()}`,
    `同行者名: ${form.companionNames.trim()}`,
    `備考: ${form.memo.trim()}`,
  ].join('\n');
}

function FieldLabel({ children, required = false }: { children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-sm font-medium text-gray-700 mb-1">
      {children}
      {required && (
        <span className="ml-2 rounded bg-red-50 px-1.5 py-0.5 text-[11px] font-semibold text-red-600">
          必須
        </span>
      )}
    </label>
  );
}

export default function EventConfirm() {
  const { id } = useParams<{ id: string }>();
  const [search] = useSearchParams();
  const slotId = search.get('slotId') ?? '';
  const navigate = useNavigate();

  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slot, setSlot] = useState<EventSlot | null>(null);
  const [form, setForm] = useState<SignupForm>(initialSignupForm);
  const [submitting, setSubmitting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);

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
          setFatalError('選択した枠は受付終了しました。別の日時をお選びください。');
          return;
        }
        setSlot(found);
      } catch (err) {
        if (!cancelled) setFatalError(err instanceof Error ? err.message : String(err));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [id, slotId]);

  async function submit() {
    if (!id || !slotId) return;
    const validation = validateSignupForm(form);
    if (validation) {
      setFormError(validation);
      return;
    }
    const customerNote = buildCustomerNote(form);
    if (customerNote.length > 5000) {
      setFormError('入力内容は5000字以内で入力してください');
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const res = await api.createEventBooking(id, { slot_id: slotId, customer_note: customerNote }, idemKey);
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
      setFormError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  if (fatalError) {
    return (
      <div className="p-8 text-center">
        <div className="text-red-700 mb-4">{fatalError}</div>
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

  function updateField<K extends keyof SignupForm>(key: K, value: SignupForm[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <div className="mx-auto max-w-xl p-4 pb-20">
      <h1 className="text-lg font-bold mb-3">予約内容の確認</h1>
      <div className="border rounded p-3 mb-4 space-y-1">
        <div className="text-sm font-semibold">{event.name}</div>
        <div className="text-sm text-gray-700">日時: {formatJp(slot.starts_at)}</div>
        {event.venue_name && <div className="text-sm text-gray-700">会場: {event.venue_name}</div>}
      </div>

      {event.requires_approval === 1 && (
        <div className="bg-yellow-50 border border-yellow-200 text-yellow-900 text-xs rounded p-2 mb-3">
          このイベントは承認制です。受付後、運営が承認するまでお待ちください。
        </div>
      )}

      <div className="space-y-3">
        <div>
          <FieldLabel required>名前</FieldLabel>
          <input
            value={form.name}
            onChange={(e) => updateField('name', e.target.value)}
            className="w-full border rounded p-2 text-sm"
            placeholder="例: 山田 太郎"
            autoComplete="name"
          />
        </div>

        <div>
          <FieldLabel required>電話番号</FieldLabel>
          <input
            value={form.phone}
            onChange={(e) => updateField('phone', e.target.value)}
            className="w-full border rounded p-2 text-sm"
            placeholder="例: 09012345678"
            inputMode="tel"
            autoComplete="tel"
          />
        </div>

        <div>
          <FieldLabel>Xアカウント</FieldLabel>
          <input
            value={form.xAccount}
            onChange={(e) => updateField('xAccount', e.target.value)}
            className="w-full border rounded p-2 text-sm"
            placeholder="例: @example"
            autoCapitalize="none"
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <FieldLabel required>人数</FieldLabel>
            <input
              value={form.people}
              onChange={(e) => updateField('people', e.target.value)}
              className="w-full border rounded p-2 text-sm"
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </div>
          <div>
            <FieldLabel>同行者人数</FieldLabel>
            <input
              value={form.companionCount}
              onChange={(e) => updateField('companionCount', e.target.value)}
              className="w-full border rounded p-2 text-sm"
              inputMode="numeric"
              pattern="[0-9]*"
            />
          </div>
        </div>

        <div>
          <FieldLabel>同行者名</FieldLabel>
          <textarea
            value={form.companionNames}
            onChange={(e) => updateField('companionNames', e.target.value)}
            rows={2}
            className="w-full border rounded p-2 text-sm"
            placeholder="同行者がいる場合は名前を入力"
          />
        </div>

        <div>
          <FieldLabel>備考</FieldLabel>
          <textarea
            value={form.memo}
            onChange={(e) => updateField('memo', e.target.value)}
            rows={3}
            className="w-full border rounded p-2 text-sm"
            placeholder="遅れる、質問など"
          />
        </div>
      </div>

      {formError && <div className="bg-red-50 text-red-700 p-2 rounded mt-2 text-sm">{formError}</div>}

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
    </div>
  );
}
