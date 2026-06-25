// main.tsx — Event booking LIFF entry. Loaded via dynamic import from
// apps/worker/src/client/main.ts (?page=event&id=<eventId> or ?page=event-me).
// Mirrors salon-booking design language (LINE 緑 + sb-card + fade animations).

import { StrictMode, useEffect, useState, type ReactNode } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';

let _root: Root | null = null;

export interface EventBookingContext {
  liffId: string;
  lineUserId: string;
  idToken: string;
}

interface EventDetail {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  cancel_deadline_hours_before: number | null;
  // 既予約検出 (multi-account 含む): 同一人物が別アカで既に予約済の場合に
  // Worker が GET 時点で詰めて返す。null は未予約。
  my_existing_booking?: {
    id: string;
    status: string;
    slot_starts_at: string;
    line_account_id: string;
  } | null;
}

interface EventSlot {
  id: string;
  event_id: string;
  starts_at: string;
  ends_at: string;
  capacity: number | null;
  is_active: number;
  is_full?: boolean;
}

interface MyBooking {
  id: string;
  event_id: string;
  status: string;
  customer_note: string | null;
  event_name: string;
  event_image_url: string | null;
  venue_name: string | null;
  venue_url: string | null;
  cancel_deadline_hours_before: number | null;
  slot_starts_at: string;
  slot_ends_at: string;
}

interface EventListItem {
  id: string;
  name: string;
  venue_name: string | null;
  venue_url: string | null;
  image_url: string | null;
  description: string | null;
  description_centered: number;
  max_bookings_per_friend: number | null;
  requires_approval: number;
  next_slot_starts_at: string;
  next_slot_ends_at: string;
  future_slot_count: number;
}

function buildAuthHeaders(ctx: EventBookingContext, extra: Record<string, string> = {}): Record<string, string> {
  return { Authorization: `Bearer ${ctx.idToken}`, ...extra };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function apiGetOnce<T>(path: string, ctx: EventBookingContext): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const r = await fetch(url.toString(), { headers: buildAuthHeaders(ctx) });
  if (!r.ok) {
    const text = await r.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const err = new Error(`API ${r.status}`) as Error & { status: number; body: unknown };
    err.status = r.status;
    err.body = parsed ?? text;
    throw err;
  }
  return r.json() as Promise<T>;
}

async function apiGet<T>(path: string, ctx: EventBookingContext): Promise<T> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await apiGetOnce<T>(path, ctx);
    } catch (err) {
      lastError = err;
      const status = (err as { status?: number }).status;
      if (status != null && status < 500) break;
      await sleep(450);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

async function apiPost<T>(
  path: string,
  body: unknown,
  ctx: EventBookingContext,
  extraHeaders: Record<string, string> = {},
): Promise<T> {
  const url = new URL(path, window.location.origin);
  url.searchParams.set('liffId', ctx.liffId);
  const res = await fetch(url.toString(), {
    method: 'POST',
    headers: buildAuthHeaders(ctx, { 'Content-Type': 'application/json', ...extraHeaders }),
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    let parsed: unknown = null;
    try { parsed = JSON.parse(text); } catch { /* ignore */ }
    const err = new Error(`API ${res.status}`) as Error & { status: number; body: unknown };
    err.status = res.status;
    err.body = parsed ?? text;
    throw err;
  }
  return res.json();
}

function formatJp(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  });
}

function formatJpDateOnly(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', {
    year: 'numeric', month: '2-digit', day: '2-digit', weekday: 'short',
  });
}

function formatJpTimeOnly(iso: string): string {
  return new Date(iso).toLocaleString('ja-JP', { hour: '2-digit', minute: '2-digit' });
}

function uid(): string {
  return crypto.randomUUID();
}

// ─── Loading ──────────────────────────────────────────────

function Spinner() {
  return (
    <div className="flex items-center justify-center py-16">
      <div className="eb-spinner" />
    </div>
  );
}

// ─── Screens ──────────────────────────────────────────────

function EventDetailScreen({
  ctx,
  eventId,
  onPickSlot,
  onGoHistory,
  onGoList,
}: {
  ctx: EventBookingContext;
  eventId: string;
  onPickSlot: (slot: EventSlot, event: EventDetail) => void;
  onGoHistory: () => void;
  onGoList: () => void;
}) {
  const [event, setEvent] = useState<EventDetail | null>(null);
  const [slots, setSlots] = useState<EventSlot[]>([]);
  const [myActive, setMyActive] = useState<MyBooking[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [e, s] = await Promise.all([
          apiGet<EventDetail>(`/api/liff/events/${eventId}`, ctx),
          apiGet<{ items: EventSlot[] }>(`/api/liff/events/${eventId}/slots`, ctx),
        ]);
        if (cancelled) return;
        setEvent(e);
        setSlots(s.items);
        try {
          const [up, past] = await Promise.all([
            apiGet<{ items: MyBooking[] }>('/api/liff/events/me?tab=upcoming', ctx),
            apiGet<{ items: MyBooking[] }>('/api/liff/events/me?tab=past', ctx),
          ]);
          if (cancelled) return;
          const all = [...up.items, ...past.items];
          setMyActive(
            all.filter((b) => b.event_id === e.id && (b.status === 'requested' || b.status === 'confirmed')),
          );
        } catch {
          /* best-effort */
        }
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [ctx, eventId]);

  if (loading) return <Spinner />;
  if (error || !event) {
    // 404 / not_found / アカウント対象外を friendly に表示
    const isNotFound = error?.includes('404') || error?.includes('not_found');
    const friendly = isNotFound
      ? 'このイベントは現在受付を停止しています、または、ご利用中の LINE アカウントでは予約できません。'
      : (error ?? 'イベントが見つかりません');
    return (
      <div className="px-4 py-6 eb-fade-in">
        <div className="eb-card text-center">
          <p className="text-sm text-gray-700">{friendly}</p>
        </div>
      </div>
    );
  }

  // 既予約検出: Worker GET レスポンスの my_existing_booking で事前に分かる。
  // 別アカ経由でも identity_key で同一人物として検知される。
  // max=1 のときだけ「予約済み画面」で早期 return。max>1 や 制限なし では
  // 既予約を示しつつ slot 選択も継続できる必要がある。
  const max = event.max_bookings_per_friend;
  const existingBooking = event.my_existing_booking;
  if (existingBooking && max === 1) {
    return (
      <div className="pb-24 eb-fade-in">
        {event.image_url ? (
          <img src={event.image_url} alt="" className="w-full h-52 object-cover bg-gray-100" />
        ) : (
          <div className="w-full h-52 bg-gradient-to-br from-green-100 to-green-200" />
        )}
        <div className="px-4 -mt-6">
          <div className="eb-card eb-card-success">
            <div className="text-2xl mb-2">✅</div>
            <div className="text-base font-bold text-gray-900 mb-1">予約済みです</div>
            <div className="text-sm text-gray-700">{formatJp(existingBooking.slot_starts_at)}</div>
            <button onClick={onGoHistory} className="eb-primary-btn mt-4">
              予約履歴を見る
            </button>
          </div>
        </div>
      </div>
    );
  }

  const overLimit = max != null && myActive.length >= max;

  return (
    <div className="pb-24 eb-fade-in">
      {event.image_url ? (
        <img src={event.image_url} alt="" className="w-full h-52 object-cover bg-gray-100" />
      ) : (
        <div className="w-full h-52 bg-gradient-to-br from-green-100 to-green-200" />
      )}

      <div className="px-4 -mt-6">
        <div className="eb-card">
          <h1 className="text-lg font-bold text-gray-900 leading-snug">{event.name}</h1>
          <button onClick={onGoList} className="eb-list-back-btn mt-3">
            予約一覧に戻る
          </button>
          {event.venue_name && (
            <div className="mt-2 text-sm text-gray-700 flex items-start gap-1.5">
              <span>📍</span><span>{event.venue_name}</span>
            </div>
          )}
          {max != null && (
            <div className="mt-3 inline-flex items-center gap-1 eb-badge bg-gray-100 text-gray-700">
              あなたの予約 {myActive.length} / {max}
            </div>
          )}
          {existingBooking && (
            <div className="mt-3 text-xs eb-line-green-text">
              ✓ {formatJp(existingBooking.slot_starts_at)} の予約済みです
            </div>
          )}
        </div>

        {event.description && (
          <div className="eb-card mt-3">
            <div className={`text-sm whitespace-pre-wrap leading-relaxed text-gray-800 ${event.description_centered === 1 ? 'text-center' : ''}`}>
              {event.description}
            </div>
          </div>
        )}

        <div className="mt-5">
          <h2 className="text-sm font-bold text-gray-900 mb-2 px-1">日時を選択</h2>
          {slots.length === 0 ? (
            <div className="eb-card text-center text-sm text-gray-500">
              現在予約可能な枠はありません。
            </div>
          ) : (
            <ul className="space-y-2">
              {slots.map((s) => {
                const full = s.is_full === true;
                const disabled = full || overLimit;
                return (
                  <li key={s.id}>
                    <button
                      disabled={disabled}
                      onClick={() => onPickSlot(s, event)}
                      className="eb-slot-btn"
                    >
                      <span className="flex flex-col items-start">
                        <span className="text-xs opacity-70">{formatJpDateOnly(s.starts_at)}</span>
                        <span className="text-base">{formatJpTimeOnly(s.starts_at)} 〜 {formatJpTimeOnly(s.ends_at)}</span>
                      </span>
                      <span className="text-xs font-medium">
                        {full ? '満員' : s.capacity == null ? '原則MAX16名' : '受付中'}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
          {overLimit && (
            <p className="mt-3 text-xs text-red-600 px-1">
              このイベントへの予約上限（{max}）に達しています。
            </p>
          )}
        </div>

        <div className="mt-5">
          <button onClick={onGoHistory} className="eb-history-btn">
            予約履歴を見る
          </button>
        </div>
      </div>
    </div>
  );
}

function ConfirmScreen({
  ctx,
  event,
  slot,
  onBack,
  onDone,
}: {
  ctx: EventBookingContext;
  event: EventDetail;
  slot: EventSlot;
  onBack: () => void;
  onDone: (status: string) => void;
}) {
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [xAccount, setXAccount] = useState('');
  const [partySize, setPartySize] = useState('1');
  const [companionCount, setCompanionCount] = useState('0');
  const [companionNames, setCompanionNames] = useState('');
  const [note, setNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [idemKey] = useState(uid);

  function buildCustomerNote(): string {
    return [
      `名前: ${customerName.trim()}`,
      `電話番号: ${phone.trim()}`,
      `Xアカウント: ${xAccount.trim()}`,
      `人数: ${partySize.trim()}`,
      `同行者人数: ${companionCount.trim()}`,
      `同行者名: ${companionNames.trim()}`,
      `備考: ${note.trim()}`,
    ].join('\n');
  }

  async function submit() {
    const normalizedPartySize = Number(partySize);
    const normalizedCompanionCount = Number(companionCount);
    if (!customerName.trim()) {
      setError('名前を入力してください');
      return;
    }
    if (!phone.trim()) {
      setError('電話番号を入力してください');
      return;
    }
    if (!Number.isInteger(normalizedPartySize) || normalizedPartySize < 1) {
      setError('人数は1以上で入力してください');
      return;
    }
    if (!Number.isInteger(normalizedCompanionCount) || normalizedCompanionCount < 0) {
      setError('同行者人数は0以上で入力してください');
      return;
    }
    if (normalizedCompanionCount > 0 && !companionNames.trim()) {
      setError('同行者がいる場合は同行者名を入力してください');
      return;
    }
    const customerNote = buildCustomerNote();
    if (customerNote.length > 5000) {
      setError('入力内容は 5000 字以内で入力してください');
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const res = await apiPost<{ id: string; status: string }>(
        `/api/liff/events/${event.id}/bookings`,
        { slot_id: slot.id, customer_note: customerNote },
        ctx,
        { 'Idempotency-Key': idemKey },
      );
      onDone(res.status);
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
            return 'LINE 認証に失敗しました。一度トークルームに戻り、友だち追加が完了していることを確認してください。';
          case 'idempotent_in_progress': return '前回のリクエストを処理中です。少しお待ちください。';
          case 'duplicate_friend_booking': {
            const existing = (e.body as { existing?: { slot_starts_at?: string } } | undefined)?.existing;
            const when = existing?.slot_starts_at ? formatJp(existing.slot_starts_at) : '';
            return `このイベントは既に予約済みです${when ? `（${when}）` : ''}。予約履歴から確認できます。`;
          }
          default: return err instanceof Error ? err.message : String(err);
        }
      })();
      setError(msg);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="px-4 py-4 pb-24 space-y-4 eb-slide-up">
      <button onClick={onBack} className="eb-back-btn">
        <span aria-hidden>←</span>
        戻る
      </button>

      <div>
        <h1 className="text-base font-bold text-gray-900">予約内容のご確認</h1>
        <p className="text-xs text-gray-500 mt-1">最後にご確認ください</p>
      </div>

      <div className="eb-card">
        <dl className="space-y-3 text-sm">
          <Row label="イベント" value={event.name} />
          <Row label="日時" value={formatJp(slot.starts_at)} />
          {event.venue_name && <Row label="会場" value={event.venue_name} />}
        </dl>
      </div>

      {event.requires_approval === 1 && (
        <div className="bg-amber-50 border border-amber-200 text-amber-900 text-xs rounded-xl p-3">
          このイベントは承認制です。受付後、運営が承認するまでお待ちください。
        </div>
      )}

      <div className="space-y-3">
        <Field label="名前" required>
          <input
            value={customerName}
            onChange={(e) => setCustomerName(e.target.value)}
            placeholder="例: 山田 太郎"
            className="eb-input"
          />
        </Field>
        <Field label="電話番号" required>
          <input
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            placeholder="例: 09012345678"
            className="eb-input"
          />
        </Field>
        <Field label="Xアカウント">
          <input
            value={xAccount}
            onChange={(e) => setXAccount(e.target.value)}
            placeholder="例: @example"
            className="eb-input"
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="人数" required>
            <input
              value={partySize}
              onChange={(e) => setPartySize(e.target.value)}
              type="number"
              inputMode="numeric"
              min={1}
              className="eb-input"
            />
          </Field>
          <Field label="同行者人数">
            <input
              value={companionCount}
              onChange={(e) => setCompanionCount(e.target.value)}
              type="number"
              inputMode="numeric"
              min={0}
              className="eb-input"
            />
          </Field>
        </div>
        <Field label="同行者名">
          <textarea
            value={companionNames}
            onChange={(e) => setCompanionNames(e.target.value)}
            rows={2}
            placeholder="同行者がいる場合は名前を入力"
            className="eb-input"
          />
        </Field>
        <Field label="備考">
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={2000}
            placeholder="遅れる、質問など"
            className="eb-input"
          />
        </Field>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm">
          {error}
        </div>
      )}

      <button onClick={submit} disabled={submitting} className="eb-primary-btn">
        {submitting ? '送信中...' : '予約をリクエスト'}
      </button>
      <button onClick={onBack} disabled={submitting} className="eb-secondary-btn">
        戻る
      </button>
    </div>
  );
}

function Row({ label, value, valueClassName }: { label: string; value: string; valueClassName?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-xs text-gray-500 shrink-0">{label}</dt>
      <dd className={`text-right ${valueClassName ?? 'text-gray-900'}`}>{value}</dd>
    </div>
  );
}

function Field({ label, required, children }: { label: string; required?: boolean; children: ReactNode }) {
  return (
    <label className="block">
      <span className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}
        {required && <span className="text-red-500 text-xs ml-1">必須</span>}
      </span>
      {children}
    </label>
  );
}

function DoneScreen({
  status,
  onGoHistory,
  onGoList,
}: {
  status: string;
  onGoHistory: () => void;
  onGoList: () => void;
}) {
  const isPending = status === 'requested';
  return (
    <div className="px-4 py-10 text-center eb-slide-up">
      <div className="eb-card">
        <div className="text-5xl mb-3">{isPending ? '⏳' : '✅'}</div>
        <h1 className="text-lg font-bold mb-2 text-gray-900">
          {isPending ? '受付しました' : '予約が確定しました'}
        </h1>
        <p className="text-sm text-gray-600 mb-6 leading-relaxed">
          {isPending
            ? '運営の承認をお待ちください。承認されると LINE でお知らせします。'
            : '予約が確定しました。LINE で詳細をお送りしました。'}
        </p>
        <button onClick={onGoHistory} className="eb-primary-btn">
          予約履歴を見る
        </button>
        <button onClick={onGoList} className="eb-secondary-btn mt-3">
          イベント一覧へ
        </button>
      </div>
    </div>
  );
}

function EventListScreen({
  ctx,
  onOpenEvent,
  onGoHistory,
}: {
  ctx: EventBookingContext;
  onOpenEvent: (eventId: string) => void;
  onGoHistory: () => void;
}) {
  const [items, setItems] = useState<EventListItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const res = await apiGet<{ items: EventListItem[] }>('/api/liff/events', ctx);
        if (!cancelled) setItems(res.items);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (!cancelled) setLoading(false);
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [ctx]);

  return (
    <div className="pb-24 eb-fade-in">
      <div className="px-4 py-4">
        <div className="mb-3">
          <div>
            <h1 className="text-base font-bold text-gray-900">イベント一覧</h1>
            <p className="text-xs text-gray-500 mt-1">参加したい交流会を選択してください</p>
          </div>
        </div>

        <div className="eb-card mb-4">
          <p className="text-sm text-gray-700 leading-relaxed">
            予約内容の確認・キャンセルは予約履歴からできます。
          </p>
          <button onClick={onGoHistory} className="eb-history-btn mt-3">
            予約履歴を見る
          </button>
        </div>

        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm">{error}</div>}
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <div className="eb-card text-center text-sm text-gray-500 py-8">
            現在受付中のイベントはありません。
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((event) => (
              <button
                key={event.id}
                onClick={() => onOpenEvent(event.id)}
                className="eb-card !p-0 w-full text-left overflow-hidden"
              >
                {event.image_url ? (
                  <img src={event.image_url} alt="" className="w-full h-36 object-cover bg-gray-100" />
                ) : (
                  <div className="w-full h-7 bg-gradient-to-br from-green-100 to-green-200" />
                )}
                <div className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="text-sm font-bold text-gray-900 leading-snug">{event.name}</h2>
                    {event.requires_approval === 1 && (
                      <span className="eb-badge bg-amber-100 text-amber-800 shrink-0">承認制</span>
                    )}
                  </div>
                  <div className="mt-2 text-sm font-semibold text-gray-800">
                    {formatJpDateOnly(event.next_slot_starts_at)}
                  </div>
                  <div className="text-sm text-gray-700">
                    {formatJpTimeOnly(event.next_slot_starts_at)} 〜 {formatJpTimeOnly(event.next_slot_ends_at)}
                  </div>
                  {event.venue_name && (
                    <div className="mt-1 text-xs text-gray-500 truncate">📍 {event.venue_name}</div>
                  )}
                  <div className="mt-3 text-xs text-gray-500">
                    <span>{event.future_slot_count > 1 ? `日時 ${event.future_slot_count}件` : '受付中'}</span>
                    <span className="eb-card-cta">詳細・予約へ</span>
                  </div>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

const STATUS_LABEL: Record<string, { text: string; cls: string }> = {
  requested: { text: '承認待ち', cls: 'bg-amber-100 text-amber-800' },
  confirmed: { text: '確定', cls: 'bg-green-100 text-green-800' },
  rejected: { text: '見送り', cls: 'bg-gray-200 text-gray-700' },
  cancelled: { text: 'キャンセル', cls: 'bg-gray-100 text-gray-600' },
  expired: { text: '期限切れ', cls: 'bg-gray-100 text-gray-500' },
  attended: { text: '参加済', cls: 'bg-blue-100 text-blue-800' },
  no_show: { text: '不参加', cls: 'bg-red-100 text-red-700' },
};

function canCancel(b: MyBooking): boolean {
  if (b.status !== 'requested' && b.status !== 'confirmed') return false;
  if (b.cancel_deadline_hours_before == null) return false;
  const deadlineMs = new Date(b.slot_starts_at).getTime() - b.cancel_deadline_hours_before * 3600_000;
  return deadlineMs > Date.now();
}

function HistoryScreen({ ctx, onGoList }: { ctx: EventBookingContext; onGoList: () => void }) {
  const [tab, setTab] = useState<'upcoming' | 'past'>('upcoming');
  const [items, setItems] = useState<MyBooking[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    setLoading(true);
    setError(null);
    try {
      const res = await apiGet<{ items: MyBooking[] }>(`/api/liff/events/me?tab=${tab}`, ctx);
      setItems(res.items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  async function cancel(b: MyBooking) {
    if (!confirm(`「${b.event_name}」の予約をキャンセルしますか？`)) return;
    setBusy(true);
    setError(null);
    try {
      await apiPost(`/api/liff/events/me/${b.id}/cancel`, {}, ctx);
      await refresh();
    } catch (err) {
      const e = err as { body?: { error?: string } };
      const msg = (() => {
        switch (e.body?.error) {
          case 'cancel_deadline_passed': return 'キャンセル期限を過ぎています。';
          case 'cancel_not_allowed': return 'このイベントは LIFF からのキャンセル不可です。LINE で運営にご連絡ください。';
          case 'invalid_state': return 'この予約はキャンセルできない状態です。';
          default: return err instanceof Error ? err.message : String(err);
        }
      })();
      setError(msg);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="pb-20 eb-fade-in">
      <div className="px-4 pt-4">
        <button onClick={onGoList} className="eb-list-back-primary-btn">
          予約一覧に戻る
        </button>
      </div>
      <div className="sticky top-12 z-10 bg-white border-b border-gray-200">
        <div className="flex">
          {(['upcoming', 'past'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-3 text-sm font-medium border-b-2 ${
                tab === t ? 'border-[#06C755] eb-line-green-text' : 'border-transparent text-gray-500'
              }`}
            >
              {t === 'upcoming' ? 'これから' : '過去'}
            </button>
          ))}
        </div>
      </div>
      <div className="px-4 py-4 space-y-3">
        {error && <div className="bg-red-50 border border-red-200 text-red-700 p-3 rounded-xl text-sm">{error}</div>}
        {loading ? (
          <Spinner />
        ) : items.length === 0 ? (
          <div className="eb-card text-center text-sm text-gray-500 py-8">
            {tab === 'upcoming' ? 'これからの予約はありません' : '過去の予約はありません'}
          </div>
        ) : (
          items.map((b) => {
            const s = STATUS_LABEL[b.status] ?? { text: b.status, cls: 'bg-gray-100' };
            return (
              <div key={b.id} className="eb-card !p-0 overflow-hidden">
                <div className="flex">
                  {b.event_image_url ? (
                    <img src={b.event_image_url} alt="" className="w-24 h-24 object-cover bg-gray-100 shrink-0" />
                  ) : (
                    <div className="w-24 h-24 bg-gradient-to-br from-green-100 to-green-200 shrink-0" />
                  )}
                  <div className="flex-1 p-3 min-w-0">
                    <div className="flex items-start justify-between gap-2">
                      <div className="font-semibold text-sm line-clamp-2 text-gray-900">{b.event_name}</div>
                      <span className={`eb-badge ${s.cls} shrink-0`}>{s.text}</span>
                    </div>
                    <div className="text-xs text-gray-600 mt-1">{formatJp(b.slot_starts_at)}</div>
                    {b.venue_name && <div className="text-xs text-gray-500 truncate">📍 {b.venue_name}</div>}
                  </div>
                </div>
                {canCancel(b) && (
                  <div className="border-t border-gray-100 px-3 py-2 text-right">
                    <button
                      onClick={() => cancel(b)}
                      disabled={busy}
                      className="text-sm text-red-600 disabled:opacity-50"
                    >
                      キャンセルする
                    </button>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

// ─── App ──────────────────────────────────────────────────

type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; eventId: string }
  | { kind: 'confirm'; event: EventDetail; slot: EventSlot }
  | { kind: 'done'; status: string }
  | { kind: 'history' };

function App({ ctx, initial }: { ctx: EventBookingContext; initial: Screen }) {
  const [screen, setScreen] = useState<Screen>(initial);

  const headerLabel = (() => {
    switch (screen.kind) {
      case 'list': return '茶はいダーツバー西新宿Luuイベント予約';
      case 'detail': return 'イベント予約';
      case 'confirm': return 'ご予約内容の確認';
      case 'done': return '完了';
      case 'history': return '予約履歴';
    }
  })();

  return (
    <div className="min-h-screen" style={{ background: '#f5f5f5' }}>
      <header
        className="px-4 py-3 text-white text-center font-bold sticky top-0 z-20"
        style={{ background: '#06C755', fontSize: '15px' }}
      >
        {headerLabel}
      </header>
      <main className="max-w-md mx-auto">
        {screen.kind === 'list' && (
          <EventListScreen
            ctx={ctx}
            onOpenEvent={(eventId) => setScreen({ kind: 'detail', eventId })}
            onGoHistory={() => setScreen({ kind: 'history' })}
          />
        )}
        {screen.kind === 'detail' && (
          <EventDetailScreen
            ctx={ctx}
            eventId={screen.eventId}
            onPickSlot={(slot, event) => setScreen({ kind: 'confirm', event, slot })}
            onGoHistory={() => setScreen({ kind: 'history' })}
            onGoList={() => setScreen({ kind: 'list' })}
          />
        )}
        {screen.kind === 'confirm' && (
          <ConfirmScreen
            ctx={ctx}
            event={screen.event}
            slot={screen.slot}
            onBack={() => setScreen({ kind: 'detail', eventId: screen.event.id })}
            onDone={(status) => setScreen({ kind: 'done', status })}
          />
        )}
        {screen.kind === 'done' && (
          <DoneScreen
            status={screen.status}
            onGoHistory={() => setScreen({ kind: 'history' })}
            onGoList={() => setScreen({ kind: 'list' })}
          />
        )}
        {screen.kind === 'history' && (
          <HistoryScreen
            ctx={ctx}
            onGoList={() => setScreen({ kind: 'list' })}
          />
        )}
      </main>
    </div>
  );
}

export function mountEventBooking(container: HTMLElement, ctx: EventBookingContext, initial: Screen): void {
  document.body.classList.add('eb-active');
  if (!_root) _root = createRoot(container);
  _root.render(
    <StrictMode>
      <App ctx={ctx} initial={initial} />
    </StrictMode>,
  );
}
