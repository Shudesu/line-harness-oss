// main.tsx — Salon booking React entry. Loaded via dynamic import from the
// LIFF orchestrator (apps/worker/src/client/main.ts). Caller passes already-
// initialized LIFF context (liffId / lineUserId / idToken).

import { StrictMode, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { SalonBookingProvider, type SalonBookingContext } from './lib/context.js';
import Booking from './pages/Booking.js';
import BookingHistory from './pages/BookingHistory.js';
import './styles.css';

let _root: Root | null = null;

function readUrlState(): { view: string | null; peekMode: boolean; menuId: string | null } {
  const params = new URLSearchParams(window.location.search);
  return {
    view: params.get('view'),
    peekMode: params.get('mode') === 'peek',
    menuId: params.get('menu_id'),
  };
}

function App({ ctx }: { ctx: SalonBookingContext }) {
  // peekMode は state として保持し、Booking から `exitPeek` で false に倒せる。
  const initial = readUrlState();
  const [view] = useState(initial.view);
  const [peekMode, setPeekMode] = useState(initial.peekMode);
  // menu_id ディープリンクは URL から1度だけ読む。お客様が「戻る」で
  // メニュー選択に戻った後にディープリンクで再ロックされないように、
  // mount 時点の値だけ Booking に渡す。
  const [initialMenuId] = useState(initial.menuId);

  const headerLabel = view === 'history' ? '予約履歴' : peekMode ? '空き状況' : 'ご予約';

  return (
    <SalonBookingProvider value={ctx}>
      <div className="min-h-screen sb-fade-in" style={{ background: '#f5f5f5' }}>
        <header
          className="px-4 py-3 text-white text-center font-bold"
          style={{ background: '#06C755', fontSize: '15px' }}
        >
          {headerLabel}
        </header>
        <main className="max-w-md mx-auto px-4 py-4 pb-24">
          {view === 'history' ? (
            <BookingHistory />
          ) : (
            <Booking
              peekMode={peekMode}
              exitPeek={() => setPeekMode(false)}
              initialMenuId={initialMenuId}
            />
          )}
        </main>
      </div>
    </SalonBookingProvider>
  );
}

export function mountSalonBooking(container: HTMLElement, ctx: SalonBookingContext): void {
  // body.sb-active は preflight reset と #app inline 上書きが効くための前提。
  // useEffect で付けると初回 paint がブラウザデフォルト (black border, list disc 等)
  // のままチラつくので、createRoot 前に同期で付ける。
  document.body.classList.add('sb-active');

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

export function unmountSalonBooking(): void {
  if (_root) {
    _root.unmount();
    _root = null;
  }
  document.body.classList.remove('sb-active');
}
