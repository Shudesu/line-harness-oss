import { useSalonContext } from '../lib/context.js';

export default function Done() {
  const ctx = useSalonContext();
  const labels = ctx.labels;
  function gotoHistory() {
    const url = new URL(window.location.href);
    url.searchParams.set('view', 'history');
    window.location.href = url.toString();
  }
  function close() {
    // LINE 内なら liff.closeWindow が動く
    const liffGlobal = (window as unknown as { liff?: { closeWindow?: () => void } }).liff;
    if (liffGlobal?.closeWindow) {
      try { liffGlobal.closeWindow(); return; } catch { /* fallback */ }
    }
    window.close();
  }
  return (
    <div className="sb-fade-in pt-8 pb-4">
      <div className="sb-card text-center">
        <div
          className="w-16 h-16 mx-auto rounded-full flex items-center justify-center text-white text-3xl font-bold"
          style={{ background: '#06C755' }}
        >
          ✓
        </div>
        <h1 className="text-lg font-bold text-gray-900 mt-4">リクエストを送信しました</h1>
        <p className="text-sm text-gray-600 mt-3 leading-relaxed">
          {labels.doneReplyLine}
          <br />
          確定すると LINE に通知が届きます。
        </p>
        <div className="grid grid-cols-2 gap-2 mt-6">
          <button
            onClick={gotoHistory}
            className="py-3 rounded-xl font-semibold text-sm border-2 sb-line-green-text"
            style={{ borderColor: '#06C755' }}
          >
            {labels.historyButton}
          </button>
          <button
            onClick={close}
            className="py-3 rounded-xl font-semibold text-sm text-white"
            style={{ background: '#06C755' }}
          >
            閉じる
          </button>
        </div>
      </div>
      <p className="text-xs text-gray-400 text-center mt-4">user: {ctx.lineUserId.slice(0, 8)}…</p>
    </div>
  );
}
