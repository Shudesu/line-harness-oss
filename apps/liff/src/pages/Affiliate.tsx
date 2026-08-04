import liff from '@line/liff';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const BASE = import.meta.env.VITE_API_BASE ?? '';

interface AffiliateData {
  id: string;
  name: string;
  code: string;
  commissionRate: number;
  isActive: boolean;
  friendId: string;
}

interface AffiliateLinkData {
  refCode: string;
  label: string | null;
  url: string;
  clickCount: number;
  friendAdds: number;
  conversions: number;
  conversionsPending: number;
  conversionsApproved: number;
  offerId: string | null;
  offerName: string | null;
}

interface OfferData {
  id: string;
  name: string;
  description: string | null;
  rewardAmount: number;
  enrolled: boolean;
  refCode: string | null;
  url: string | null;
}

type State =
  | { phase: 'loading' }
  | { phase: 'not_registered' }
  | { phase: 'registered'; affiliate: AffiliateData; links: AffiliateLinkData[]; offers: OfferData[] }
  | { phase: 'error'; message: string };

async function getAccessToken(): Promise<string> {
  const token = liff.getAccessToken();
  if (!token) throw new Error('LINE アクセストークンを取得できませんでした');
  return token;
}

async function fetchMe(): Promise<
  | { registered: true; affiliate: AffiliateData; links: AffiliateLinkData[] }
  | { registered: false }
> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/affiliate/me?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (res.status === 404) return { registered: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
  return { registered: true, affiliate: data.affiliate, links: data.links };
}

async function postRegister(): Promise<{ affiliate: AffiliateData; links: AffiliateLinkData[] }> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  return (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
}

async function postAddLink(label: string | null, offerId: string | null): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/links`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token, label: label || null, offerId: offerId || null }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

async function fetchOffers(): Promise<OfferData[]> {
  const token = await getAccessToken();
  const url = `${BASE}/api/liff/affiliate/offers?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { offers: OfferData[] };
  return data.offers;
}

async function postEnrollOffer(offerId: string): Promise<AffiliateLinkData> {
  const token = await getAccessToken();
  const res = await fetch(`${BASE}/api/liff/affiliate/offers/${encodeURIComponent(offerId)}/enroll`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ lineAccessToken: token }),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { link: AffiliateLinkData };
  return data.link;
}

/**
 * Copy `text` with graceful degradation for LIFF WebViews:
 *   1. navigator.clipboard.writeText  — modern, needs secure context + permission
 *   2. document.execCommand('copy')   — legacy textarea-select fallback
 *   3. neither worked → caller shows the URL selected for manual copy
 * Returns true only when the browser confirms the copy succeeded.
 */
async function copyText(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.top = '-9999px';
    ta.style.left = '-9999px';
    ta.setAttribute('readonly', '');
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, ta.value.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    if (ok) return true;
  } catch {
    // fall through to manual-copy fallback
  }

  return false;
}

function CopyButton({ url, urlRef }: { url: string; urlRef: React.RefObject<HTMLInputElement | null> }) {
  const [copied, setCopied] = useState(false);
  const [manualCopy, setManualCopy] = useState(false);

  async function handleCopy() {
    const ok = await copyText(url);
    if (ok) {
      setManualCopy(false);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
      return;
    }
    setManualCopy(true);
    setTimeout(() => {
      const el = urlRef.current;
      if (el) {
        el.focus();
        el.select();
        el.setSelectionRange(0, el.value.length);
      }
    }, 0);
  }

  return (
    <>
      <button onClick={handleCopy} className="af-copy-btn">
        {copied ? 'コピー済み' : 'コピー'}
      </button>
      {manualCopy && (
        <div className="w-full space-y-1">
          <p className="text-xs text-gray-500">
            自動コピーできませんでした。下のURLを選択してコピーしてください。
          </p>
          <input
            ref={urlRef}
            type="text"
            readOnly
            value={url}
            onFocus={(e) => e.currentTarget.select()}
            className="af-input text-xs"
          />
        </div>
      )}
    </>
  );
}

const rewardText = (amount: number) =>
  amount > 0 ? `1件 ¥${amount.toLocaleString()}` : '報酬未設定';

/**
 * One issued link inside an offer card (or the "その他のリンク" section).
 * Shows the label, URL, copy button, and the per-link performance counters.
 */
function LinkRow({ link }: { link: AffiliateLinkData }) {
  const urlRef = useRef<HTMLInputElement>(null);

  return (
    <div className="af-link-row space-y-2">
      <div className="flex items-start justify-between gap-2 flex-wrap">
        <div className="min-w-0 flex-1">
          {link.label ? (
            <div className="text-sm font-semibold text-gray-800">{link.label}</div>
          ) : (
            <div className="text-sm font-semibold text-gray-500">リンク</div>
          )}
          <div className="text-xs text-gray-400 break-all mt-0.5">{link.url}</div>
        </div>
        <CopyButton url={link.url} urlRef={urlRef} />
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-600">
        <span>クリック <strong className="af-line-green-text">{link.clickCount}</strong></span>
        <span>友だち追加 <strong className="af-line-green-text">{link.friendAdds}</strong></span>
        <span>CV承認済み <strong className="af-line-green-text">{link.conversionsApproved}</strong></span>
        <span className="text-gray-400">審査中 {link.conversionsPending}</span>
      </div>
    </div>
  );
}

/**
 * Inline "この案件用のリンクを追加" form. Rendered inside an enrolled offer card
 * so the user's mental model is「案件があって、案件に対してリンクを作る」.
 */
function AddOfferLinkForm({
  offerId,
  atLimit,
  onAdded,
}: {
  offerId: string;
  atLimit: boolean;
  onAdded: (link: AffiliateLinkData) => void;
}) {
  const [open, setOpen] = useState(false);
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAdd() {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      const link = await postAddLink(label.trim() || null, offerId);
      onAdded(link);
      setLabel('');
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  if (atLimit) {
    return <div className="text-xs text-red-600">リンクの上限（20本）に達しています</div>;
  }

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="af-secondary-btn">
        ＋ この案件用のリンクを追加
      </button>
    );
  }

  return (
    <div className="space-y-2">
      <input
        type="text"
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        placeholder="例: X用、Instagram用"
        className="af-input"
        disabled={busy}
      />
      {error && <div className="text-xs text-red-600">{error}</div>}
      <div className="flex gap-2">
        <button onClick={handleAdd} disabled={busy} className="af-primary-btn">
          {busy ? '発行中…' : 'リンクを発行'}
        </button>
        <button
          onClick={() => {
            setOpen(false);
            setError(null);
          }}
          disabled={busy}
          className="shrink-0 px-4 rounded-xl text-sm text-gray-500"
        >
          やめる
        </button>
      </div>
    </div>
  );
}

/**
 * An offer card. Enrolled offers show their scoped links + the add-link form.
 * Unenrolled offers show the pitch (description + reward) and a 参加する CTA.
 */
function OfferCard({
  offer,
  offerLinks,
  atLimit,
  onEnrolled,
  onLinkAdded,
}: {
  offer: OfferData;
  offerLinks: AffiliateLinkData[];
  atLimit: boolean;
  onEnrolled: (link: AffiliateLinkData) => void;
  onLinkAdded: (link: AffiliateLinkData) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const enrollCalledRef = useRef(false);

  async function handleEnroll() {
    if (busy || enrollCalledRef.current) return;
    enrollCalledRef.current = true;
    setBusy(true);
    setError(null);
    try {
      const link = await postEnrollOffer(offer.id);
      onEnrolled(link);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      enrollCalledRef.current = false;
    }
  }

  return (
    <div className="af-card space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-base font-bold text-gray-900">{offer.name}</div>
          {offer.description && (
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">{offer.description}</p>
          )}
        </div>
        <span className="af-badge shrink-0" style={{ background: '#ecfdf5', color: '#06c755' }}>
          {rewardText(offer.rewardAmount)}
        </span>
      </div>

      {offer.enrolled ? (
        <div className="space-y-2">
          {offerLinks.length > 0 ? (
            offerLinks.map((l) => <LinkRow key={l.refCode} link={l} />)
          ) : (
            <div className="text-xs text-gray-400 py-1">
              リンクを追加すると紹介を始められます
            </div>
          )}
          <AddOfferLinkForm offerId={offer.id} atLimit={atLimit} onAdded={onLinkAdded} />
        </div>
      ) : (
        <>
          {error && <div className="text-xs text-red-600">{error}</div>}
          <button onClick={handleEnroll} disabled={busy} className="af-primary-btn">
            {busy ? '参加中…' : 'この案件に参加する'}
          </button>
        </>
      )}
    </div>
  );
}

export default function Affiliate() {
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [registerBusy, setRegisterBusy] = useState(false);
  // registerCalledRef guards against a double-tap firing two POSTs while the
  // first is in flight. It is released in `finally` so that a *failed* register
  // can be retried — the button intentionally becomes clickable again on error.
  const registerCalledRef = useRef(false);

  const loadMe = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const result = await fetchMe();
      if (result.registered) {
        const offers = await fetchOffers().catch(() => []);
        setState({ phase: 'registered', affiliate: result.affiliate, links: result.links, offers });
      } else {
        setState({ phase: 'not_registered' });
      }
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, []);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function handleRegister() {
    if (registerBusy || registerCalledRef.current) return;
    registerCalledRef.current = true;
    setRegisterBusy(true);
    try {
      const data = await postRegister();
      const offers = await fetchOffers().catch(() => []);
      setState({ phase: 'registered', affiliate: data.affiliate, links: data.links, offers });
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      // Release on both success and failure: success repaints to the registered
      // view (button gone), failure repaints to the error view whose retry path
      // re-runs loadMe → not_registered, so allowing another attempt is correct.
      setRegisterBusy(false);
      registerCalledRef.current = false;
    }
  }

  if (state.phase === 'loading') {
    return (
      <div className="af-fade-in flex flex-col items-center justify-center py-20 text-gray-500">
        <div className="af-spinner mb-3" />
        <span className="text-sm">読み込み中...</span>
      </div>
    );
  }

  if (state.phase === 'error') {
    return (
      <div className="af-fade-in max-w-md mx-auto p-4">
        <div className="bg-red-50 text-red-700 p-3 rounded-xl text-sm">{state.message}</div>
        <button onClick={loadMe} className="mt-3 text-sm af-line-green-text font-semibold underline">
          再読み込み
        </button>
      </div>
    );
  }

  if (state.phase === 'not_registered') {
    return (
      <div className="af-fade-in max-w-md mx-auto p-4 space-y-4">
        <div>
          <h1 className="text-lg font-bold text-gray-900">アフィリエイト</h1>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            案件に参加して、SNSごとに紹介リンクを作成できます。
          </p>
        </div>
        <button onClick={handleRegister} disabled={registerBusy} className="af-primary-btn">
          {registerBusy ? '登録中…' : 'はじめる'}
        </button>
      </div>
    );
  }

  // registered
  const { links, offers } = state;
  const atLimit = links.length >= 20;

  // Newest-first from the API; render oldest-first inside each offer so a stable
  // reading order matches issuance order.
  const orderedLinks = [...links].reverse();
  const linksByOffer = new Map<string, AffiliateLinkData[]>();
  const genericLinks: AffiliateLinkData[] = [];
  for (const l of orderedLinks) {
    if (l.offerId) {
      const arr = linksByOffer.get(l.offerId) ?? [];
      arr.push(l);
      linksByOffer.set(l.offerId, arr);
    } else {
      genericLinks.push(l);
    }
  }

  const enrolledOffers = offers.filter((o) => o.enrolled);
  const availableOffers = offers.filter((o) => !o.enrolled);

  function handleOfferEnrolled(newLink: AffiliateLinkData) {
    setState((prev) => {
      if (prev.phase !== 'registered') return prev;
      const updatedOffers = prev.offers.map((o) =>
        o.id === newLink.offerId
          ? { ...o, enrolled: true, refCode: newLink.refCode, url: newLink.url }
          : o,
      );
      return { ...prev, links: [...prev.links, newLink], offers: updatedOffers };
    });
  }

  function handleLinkAdded(newLink: AffiliateLinkData) {
    setState((prev) => {
      if (prev.phase !== 'registered') return prev;
      return { ...prev, links: [...prev.links, newLink] };
    });
  }

  return (
    <div className="af-fade-in max-w-md mx-auto p-4 pb-12 space-y-5" style={{ background: '#f7f8fa', minHeight: '100vh' }}>
      <h1 className="text-lg font-bold text-gray-900">アフィリエイト</h1>

      {/* 参加中の案件 — 案件ごとにリンクをまとめる */}
      {enrolledOffers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            参加中の案件
          </h2>
          {enrolledOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              offerLinks={linksByOffer.get(offer.id) ?? []}
              atLimit={atLimit}
              onEnrolled={handleOfferEnrolled}
              onLinkAdded={handleLinkAdded}
            />
          ))}
        </section>
      )}

      {/* 参加できる案件 */}
      {availableOffers.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            参加できる案件
          </h2>
          {availableOffers.map((offer) => (
            <OfferCard
              key={offer.id}
              offer={offer}
              offerLinks={[]}
              atLimit={atLimit}
              onEnrolled={handleOfferEnrolled}
              onLinkAdded={handleLinkAdded}
            />
          ))}
        </section>
      )}

      {/* その他のリンク — 案件に紐づかない既存の汎用リンクのみ表示（新規発行 UI なし） */}
      {genericLinks.length > 0 && (
        <section className="space-y-3">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            その他のリンク
          </h2>
          <div className="af-card space-y-2">
            {genericLinks.map((link) => (
              <LinkRow key={link.refCode} link={link} />
            ))}
          </div>
        </section>
      )}

      {offers.length === 0 && genericLinks.length === 0 && (
        <div className="af-card text-center text-sm text-gray-500">
          現在参加できる案件はありません
        </div>
      )}
    </div>
  );
}
