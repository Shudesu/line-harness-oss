// main.tsx — Affiliate self-serve React entry. Loaded via dynamic import from
// the LIFF orchestrator (apps/worker/src/client/main.ts) on ?page=affiliate.
// Caller passes an already-initialized LIFF context; the LINE access token
// authenticates every /api/liff/affiliate/* call server-side.
//
// NOTE: this mirrors apps/liff/src/pages/Affiliate.tsx, but that page imports
// `@line/liff` and calls liff.getAccessToken() itself. The worker client never
// bundles @line/liff (the orchestrator uses a `declare const liff` global), so
// we re-home the same UI here and take the access token via ctx instead.

import React, { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import './styles.css';

export interface AffiliateContext {
  liffId: string;
  lineUserId: string;
  /** LINE access token (liff.getAccessToken()); auth for the affiliate API. */
  lineAccessToken: string;
}

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
  rewardMiles: number;
  enrolled: boolean;
  refCode: string | null;
  url: string | null;
}

interface MileageData {
  programId: string;
  programName: string;
  available: number;
  pending: number;
  lifetimeEarned: number;
  spent: number;
}

interface MileageHistoryItem {
  id: string;
  entryType: 'grant' | 'reversal' | 'spend' | 'expiration' | 'adjustment';
  status: 'pending' | 'available' | 'void';
  amount: number;
  reason: string;
  source: string;
  sourceEventId: string | null;
  occurredAt: string;
}

interface MileageInsights {
  accountCount: number;
  rewardedActions: number;
  referralMiles: number;
  qualityReferralCount: number;
  lastEarnedAt: string | null;
}

interface MileageWalletData {
  mileage: MileageData;
  history: MileageHistoryItem[];
  insights: MileageInsights;
  opportunities: MileageOpportunity[];
}

interface MileageOpportunity {
  id: string;
  type: 'webinar' | 'friend_add';
  title: string;
  description: string;
  rewardMiles: number;
  nextRewardMiles: number;
  progressPercent: number;
  ctaLabel: string;
  url: string;
  targetAccountId?: string;
  completed?: boolean;
  mileageStatus?: 'credited' | 'pending' | 'waiting';
  creditedMiles?: number;
}

type State =
  | { phase: 'loading' }
  | { phase: 'not_registered' }
  | { phase: 'registered'; affiliate: AffiliateData; links: AffiliateLinkData[]; offers: OfferData[] }
  | { phase: 'error'; message: string };

let _root: Root | null = null;

// ─── API ────────────────────────────────────────────────

async function fetchMe(
  token: string,
): Promise<
  | { registered: true; affiliate: AffiliateData; links: AffiliateLinkData[] }
  | { registered: false }
> {
  const url = `/api/liff/affiliate/me?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (res.status === 404) return { registered: false };
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  const data = (await res.json()) as { affiliate: AffiliateData; links: AffiliateLinkData[] };
  return { registered: true, affiliate: data.affiliate, links: data.links };
}

async function fetchOffers(token: string): Promise<OfferData[]> {
  const url = `/api/liff/affiliate/offers?lineAccessToken=${encodeURIComponent(token)}`;
  const res = await fetch(url);
  if (!res.ok) return [];
  const data = (await res.json()) as { offers: OfferData[] };
  return data.offers;
}

async function fetchMileage(
  token: string,
): Promise<MileageWalletData> {
  const url = `/api/liff/mileage/me?lineAccessToken=${encodeURIComponent(token)}&limit=20`;
  const res = await fetch(url);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `API ${res.status}`);
  }
  return (await res.json()) as MileageWalletData;
}

async function postEnrollOffer(token: string, offerId: string): Promise<AffiliateLinkData> {
  const res = await fetch(`/api/liff/affiliate/offers/${encodeURIComponent(offerId)}/enroll`, {
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

async function postRegister(
  token: string,
): Promise<{ affiliate: AffiliateData; links: AffiliateLinkData[] }> {
  const res = await fetch('/api/liff/affiliate/register', {
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

async function postAddLink(
  token: string,
  label: string | null,
  offerId: string | null,
): Promise<AffiliateLinkData> {
  const res = await fetch('/api/liff/affiliate/links', {
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

// ─── Clipboard ──────────────────────────────────────────

/**
 * Copy `text` with graceful degradation for LIFF WebViews:
 *   1. navigator.clipboard.writeText  — modern, needs secure context + permission
 *   2. document.execCommand('copy')   — legacy textarea-select fallback
 *   3. neither worked → caller shows the URL selected for manual copy
 * Returns true only when the browser confirms the copy succeeded.
 */
async function copyText(text: string): Promise<boolean> {
  // 1. Async Clipboard API (may reject in insecure context / denied permission).
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to execCommand
  }

  // 2. Legacy execCommand('copy') via an off-screen, selected textarea.
  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    // Keep it out of view but still selectable (display:none breaks selection).
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

// ─── Components ─────────────────────────────────────────

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

function formatMileageDate(value: string): string {
  const parsed = new Date(value.includes('T') ? value : value.replace(' ', 'T'));
  if (Number.isNaN(parsed.getTime())) return value.slice(0, 10).replaceAll('-', '/');
  return new Intl.DateTimeFormat('ja-JP', {
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(parsed);
}

function mileageSourceLabel(source: string): string {
  const labels: Record<string, string> = {
    webinar: 'ウェビナー',
    instagram: 'Instagram',
    line: 'LINE',
    line_relationship: 'LINE継続',
    booking: '予約',
    form: 'フォーム',
    stripe: '購入',
    tag: 'タグ',
    tag_referral: '紹介',
    affiliate: '紹介',
    admin: '運営',
  };
  return labels[source] ?? source;
}

function MileageSummaryCard({ wallet }: { wallet: MileageWalletData }) {
  const { mileage, insights } = wallet;
  return (
    <section className="af-mileage-card space-y-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold opacity-80">{mileage.programName}</p>
          <p className="mt-1 text-4xl font-bold tracking-tight">
            {mileage.available.toLocaleString()}
            <span className="ml-1 text-sm font-semibold opacity-80">mile</span>
          </p>
          <p className="mt-1 text-xs opacity-75">現在利用できるマイル</p>
        </div>
        {mileage.pending > 0 && (
          <span className="rounded-full bg-white/20 px-3 py-1 text-xs font-semibold">
            確定待ち {mileage.pending.toLocaleString()}
          </span>
        )}
      </div>

      <div className="af-mileage-grid">
        <div>
          <span>累計獲得</span>
          <strong>{mileage.lifetimeEarned.toLocaleString()}</strong>
        </div>
        <div>
          <span>紹介で獲得</span>
          <strong>{insights.referralMiles.toLocaleString()}</strong>
        </div>
        <div>
          <span>利用済み</span>
          <strong>{mileage.spent.toLocaleString()}</strong>
        </div>
        <div>
          <span>良質な紹介</span>
          <strong>{insights.qualityReferralCount.toLocaleString()}人</strong>
        </div>
      </div>

      {insights.accountCount > 1 && (
        <p className="af-wallet-scope-note">
          {insights.accountCount}個のLINE公式アカウントで貯めたマイルを合算しています
        </p>
      )}
    </section>
  );
}

function MileageHistoryAccordion({ wallet }: { wallet: MileageWalletData }) {
  const { history, insights } = wallet;
  return (
    <details className="af-card af-history-accordion">
      <summary className="af-history-summary">
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-gray-900">マイル履歴</h2>
          <p className="text-[11px] text-gray-400 mt-0.5">行動後、定期集計で反映されます</p>
        </div>
        <div className="flex items-center gap-2">
          <span className="af-badge" style={{ background: '#fff7ed', color: '#b45309' }}>
            {insights.rewardedActions.toLocaleString()}回獲得
          </span>
          <span className="af-history-chevron" aria-hidden="true" />
        </div>
      </summary>

      <div className="af-history-content">
        {history.length === 0 ? (
          <div className="af-mileage-empty">
            LINEやウェビナーで行動すると、ここにマイル履歴が表示されます
          </div>
        ) : (
          <div className="af-history-list">
            {history.map((item) => (
              <div key={item.id} className={`af-history-row ${item.status === 'void' ? 'is-void' : ''}`}>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-gray-800 truncate">{item.reason}</div>
                  <div className="mt-1 flex items-center gap-2 text-[11px] text-gray-400">
                    <span>{mileageSourceLabel(item.source)}</span>
                    <span>{formatMileageDate(item.occurredAt)}</span>
                    {item.status === 'pending' && <span className="af-history-pending">確定待ち</span>}
                    {item.status === 'void' && <span>取消</span>}
                  </div>
                </div>
                <strong className={`af-history-amount ${item.amount < 0 ? 'is-minus' : ''}`}>
                  {item.amount > 0 ? '+' : ''}{item.amount.toLocaleString()}
                  <small> mile</small>
                </strong>
              </div>
            ))}
          </div>
        )}
      </div>
    </details>
  );
}

function MileageOpportunities({ items }: { items: MileageOpportunity[] }) {
  if (items.length === 0) return null;

  const accountItems = items.filter((item) => item.type === 'friend_add');
  const webinarItems = items.filter((item) => item.type === 'webinar');
  const registeredCount = accountItems.filter((item) => item.completed).length;

  return (
    <div className="space-y-5">
      {accountItems.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-1">
            <div>
              <h2 className="text-sm font-bold text-gray-900">LINEアカウント登録マイル</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">4アカウントの登録状況とマイル反映状況</p>
            </div>
            <span className="af-opportunity-live">{registeredCount}/{accountItems.length} 登録済み</span>
          </div>
          {accountItems.map((item) => (
            <article key={item.id} className={`af-opportunity-card ${item.completed ? 'is-completed' : ''}`}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="af-opportunity-kind">LINE ACCOUNT</span>
                  <h3 className="mt-2 text-sm font-bold leading-relaxed text-gray-900">{item.title}</h3>
                </div>
                <span className="af-opportunity-reward">
                  {item.completed
                    ? item.mileageStatus === 'credited'
                      ? `加算済み +${(item.creditedMiles ?? item.rewardMiles).toLocaleString()}`
                      : item.mileageStatus === 'pending'
                        ? '確定待ち'
                        : '登録済み'
                    : `+${item.rewardMiles.toLocaleString()}`}
                </span>
              </div>
              <p className="mt-2 text-xs font-semibold text-amber-800">{item.description}</p>
              {item.completed ? (
                <div className="af-opportunity-completed"><span aria-hidden="true">✓</span> 登録済み</div>
              ) : (
                <a href={item.url} className="af-opportunity-btn">
                  {item.ctaLabel}<span aria-hidden="true"> →</span>
                </a>
              )}
            </article>
          ))}
        </section>
      )}

      {webinarItems.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-end justify-between gap-3 px-1">
            <div>
              <h2 className="text-sm font-bold text-gray-900">今、マイルを増やせます</h2>
              <p className="text-[11px] text-gray-400 mt-0.5">あなたの未達成アクション</p>
            </div>
            <span className="af-opportunity-live">獲得チャンス</span>
          </div>
          {webinarItems.map((item) => (
            <article key={item.id} className="af-opportunity-card">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <span className="af-opportunity-kind">WEBINAR MISSION</span>
                  <h3 className="mt-2 text-sm font-bold leading-relaxed text-gray-900">{item.title}</h3>
                </div>
                <span className="af-opportunity-reward">最大 +{item.rewardMiles.toLocaleString()}</span>
              </div>
              <p className="mt-2 text-xs font-semibold text-amber-800">{item.description}</p>
              {item.progressPercent > 0 && (
                <div className="mt-3">
                  <div className="mb-1 flex justify-between text-[10px] text-gray-400">
                    <span>現在の視聴進捗</span><span>{item.progressPercent}%</span>
                  </div>
                  <div className="af-opportunity-progress">
                    <span style={{ width: `${item.progressPercent}%` }} />
                  </div>
                </div>
              )}
              <a href={item.url} className="af-opportunity-btn">
                {item.ctaLabel}<span aria-hidden="true"> →</span>
              </a>
            </article>
          ))}
        </section>
      )}
    </div>
  );
}

function ReferralSummary({ links }: { links: AffiliateLinkData[] }) {
  const totals = links.reduce(
    (sum, link) => ({
      clicks: sum.clicks + link.clickCount,
      friendAdds: sum.friendAdds + link.friendAdds,
      approved: sum.approved + link.conversionsApproved,
    }),
    { clicks: 0, friendAdds: 0, approved: 0 },
  );

  return (
    <section className="af-card">
      <div className="mb-3">
        <h2 className="text-sm font-bold text-gray-900">紹介の成果</h2>
        <p className="text-[11px] text-gray-400 mt-0.5">
          紹介した友だちが予約・視聴・購入へ進むと、追加マイルの対象になります
        </p>
      </div>
      <div className="af-referral-grid">
        <div><strong>{totals.clicks.toLocaleString()}</strong><span>クリック</span></div>
        <div><strong>{totals.friendAdds.toLocaleString()}</strong><span>友だち追加</span></div>
        <div><strong>{totals.approved.toLocaleString()}</strong><span>承認成果</span></div>
      </div>
    </section>
  );
}

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
 * A blank label falls back to the offer name server-side is not required — the
 * placeholder guides users toward per-SNS labels (X用 / Instagram用 …).
 */
function AddOfferLinkForm({
  token,
  offerId,
  atLimit,
  onAdded,
}: {
  token: string;
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
      const link = await postAddLink(token, label.trim() || null, offerId);
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
  token,
  atLimit,
  onEnrolled,
  onLinkAdded,
}: {
  offer: OfferData;
  offerLinks: AffiliateLinkData[];
  token: string;
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
      const link = await postEnrollOffer(token, offer.id);
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
        <div className="flex shrink-0 flex-col items-end gap-1">
          <span className="af-badge" style={{ background: '#ecfdf5', color: '#06C755' }}>
            {rewardText(offer.rewardAmount)}
          </span>
          {offer.rewardMiles > 0 && (
            <span className="af-badge" style={{ background: '#fff7ed', color: '#d97706' }}>
              +{offer.rewardMiles.toLocaleString()} mile
            </span>
          )}
        </div>
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
          <AddOfferLinkForm
            token={token}
            offerId={offer.id}
            atLimit={atLimit}
            onAdded={onLinkAdded}
          />
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

function App({ ctx }: { ctx: AffiliateContext }) {
  const token = ctx.lineAccessToken;
  const [state, setState] = useState<State>({ phase: 'loading' });
  const [wallet, setWallet] = useState<MileageWalletData | null>(null);
  const [registerBusy, setRegisterBusy] = useState(false);
  // registerCalledRef guards against a double-tap firing two POSTs while the
  // first is in flight. It is released in `finally` so that a *failed* register
  // can be retried — the button intentionally becomes clickable again on error.
  const registerCalledRef = useRef(false);

  const loadMe = useCallback(async () => {
    setState({ phase: 'loading' });
    try {
      const [result, mileageResult] = await Promise.all([fetchMe(token), fetchMileage(token)]);
      setWallet(mileageResult);
      if (result.registered) {
        // Fetch offers in parallel; fall back to [] on error so a transient
        // offers failure never blocks the main registered view.
        const offers = await fetchOffers(token).catch(() => []);
        setState({ phase: 'registered', affiliate: result.affiliate, links: result.links, offers });
      } else {
        setState({ phase: 'not_registered' });
      }
    } catch (e) {
      setState({ phase: 'error', message: e instanceof Error ? e.message : String(e) });
    }
  }, [token]);

  useEffect(() => {
    void loadMe();
  }, [loadMe]);

  async function handleRegister() {
    if (registerBusy || registerCalledRef.current) return;
    registerCalledRef.current = true;
    setRegisterBusy(true);
    try {
      const data = await postRegister(token);
      const offers = await fetchOffers(token).catch(() => []);
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
          <h1 className="text-lg font-bold text-gray-900">マイル・紹介</h1>
          <p className="text-sm text-gray-500 mt-1 leading-relaxed">
            貯まったマイルを確認し、紹介リンクからさらにマイルを増やせます。
          </p>
        </div>
        {wallet && <MileageSummaryCard wallet={wallet} />}
        {wallet && <MileageOpportunities items={wallet.opportunities} />}
        <div className="af-card space-y-3">
          <div>
            <h2 className="text-sm font-bold text-gray-900">紹介リンクを使う</h2>
            <p className="text-xs text-gray-500 mt-1 leading-relaxed">
              無料登録すると、案件ごと・SNSごとの紹介リンクを発行できます。
            </p>
          </div>
          <button onClick={handleRegister} disabled={registerBusy} className="af-primary-btn">
            {registerBusy ? '登録中…' : 'はじめる'}
          </button>
        </div>
        {wallet && <MileageHistoryAccordion wallet={wallet} />}
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
      <div>
        <h1 className="text-lg font-bold text-gray-900">マイル・紹介</h1>
        <p className="text-xs text-gray-500 mt-1">あなたの活動と紹介成果をまとめて確認できます</p>
      </div>

      {wallet && <MileageSummaryCard wallet={wallet} />}

      {wallet && <MileageOpportunities items={wallet.opportunities} />}

      <ReferralSummary links={links} />

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
              token={token}
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
              token={token}
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

      {wallet && <MileageHistoryAccordion wallet={wallet} />}
    </div>
  );
}

// ─── Mount ──────────────────────────────────────────────

export function mountAffiliate(container: HTMLElement, ctx: AffiliateContext): void {
  // body.af-active gates the namespaced preflight reset + #app inline override.
  // Add it synchronously before createRoot so the first paint isn't the browser
  // default (black button borders, list disc) — same rationale as salon-booking.
  document.body.classList.add('af-active');

  if (_root) {
    _root.unmount();
    _root = null;
  }
  container.innerHTML = '';
  _root = createRoot(container);
  _root.render(
    <StrictMode>
      <App ctx={ctx} />
    </StrictMode>,
  );
}

export function unmountAffiliate(): void {
  if (_root) {
    _root.unmount();
    _root = null;
  }
  document.body.classList.remove('af-active');
}
