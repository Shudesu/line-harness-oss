import { useEffect, useState } from 'react';
import MenuList from '../components/MenuList.js';
import StaffList from '../components/StaffList.js';
import DateTimePicker from '../components/DateTimePicker.js';
import Confirm from '../components/Confirm.js';
import Done from '../components/Done.js';
import { useSalonContext } from '../lib/context.js';
import { createApi, type MenuItem, type StaffItem } from '../lib/api.js';

type Step = 'menu' | 'staff' | 'datetime' | 'confirm' | 'done';

const STEPS: Array<{ key: Step; label: string }> = [
  { key: 'menu', label: 'メニュー' },
  { key: 'staff', label: '担当' },
  { key: 'datetime', label: '日時' },
  { key: 'confirm', label: '確認' },
];

export default function Booking({
  peekMode,
  exitPeek,
  initialMenuId,
}: {
  peekMode: boolean;
  exitPeek: () => void;
  initialMenuId?: string | null;
}) {
  const ctx = useSalonContext();
  const [step, setStep] = useState<Step>('menu');
  const [menu, setMenu] = useState<MenuItem | null>(null);
  const [staff, setStaff] = useState<StaffItem | null>(null);
  const [slot, setSlot] = useState<{ date: string; start: string } | null>(null);
  // ?menu_id=... が指定されたら、メニュー一覧をスキップして staff から開始。
  // 該当 menu が無効/未公開だった場合は通常フローに fallback（黙って全
  // メニュー一覧を出す方が「初回オリエン直リンク経由なのに別メニュー
  // を選ばれる」事故より安全）。
  const [deepLinkResolving, setDeepLinkResolving] = useState(Boolean(initialMenuId));

  useEffect(() => {
    if (!initialMenuId) return;
    let cancelled = false;
    createApi(ctx)
      .menus()
      .then((res) => {
        if (cancelled) return;
        const hit = res.menus.find((m) => m.id === initialMenuId);
        if (hit) {
          setMenu(hit);
          setStep('staff');
        }
      })
      .catch(() => {
        // 解決失敗時は通常の menu 一覧フローへ。MenuList が同 API を
        // 再度叩くのでここで UI エラーを出す必要は無い。
      })
      .finally(() => {
        if (!cancelled) setDeepLinkResolving(false);
      });
    return () => {
      cancelled = true;
    };
  }, [ctx, initialMenuId]);

  function exitPeekToBooking() {
    const url = new URL(window.location.href);
    url.searchParams.delete('mode');
    window.history.replaceState(null, '', url.toString());
    exitPeek();
    setStep('confirm');
  }

  const showStepper = step !== 'done';
  const stepIdx = STEPS.findIndex((s) => s.key === step);

  return (
    <div>
      {showStepper && stepIdx >= 0 && (
        <div
          className="mb-5 px-1"
          style={{
            display: 'grid',
            gridTemplateColumns: `repeat(${STEPS.length}, minmax(0, 1fr))`,
            gap: 0,
          }}
        >
          {STEPS.map((s, i) => {
            const done = i < stepIdx;
            const active = i === stepIdx;
            const future = i > stepIdx;
            return (
              <div key={s.key} className="relative flex flex-col items-center">
                {/* 横線: 自分とひとつ前のサークルを繋ぐ。
                    サークル中心 (top: 12px) に合わせる */}
                {i > 0 && (
                  <span
                    aria-hidden
                    className="absolute"
                    style={{
                      top: 12,
                      left: '-50%',
                      width: '100%',
                      height: 2,
                      background: i <= stepIdx ? '#06C755' : '#e5e7eb',
                      zIndex: 0,
                    }}
                  />
                )}
                <div
                  className="relative flex items-center justify-center"
                  style={{
                    width: 24,
                    height: 24,
                    borderRadius: 9999,
                    background: future ? '#e5e7eb' : '#06C755',
                    color: future ? '#9ca3af' : '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    zIndex: 1,
                    boxShadow: active ? '0 0 0 4px rgba(6, 199, 85, 0.18)' : 'none',
                    transform: active ? 'scale(1.1)' : 'scale(1)',
                    transition: 'transform 0.2s, box-shadow 0.2s',
                  }}
                >
                  {done ? '✓' : i + 1}
                </div>
                <span
                  className="mt-1.5 text-[10px] leading-tight"
                  style={{
                    color: active ? '#111827' : '#9ca3af',
                    fontWeight: active ? 700 : 500,
                  }}
                >
                  {s.label}
                </span>
              </div>
            );
          })}
        </div>
      )}

      {step === 'menu' && deepLinkResolving && (
        <div className="py-12 text-center text-sm text-gray-500">読み込み中…</div>
      )}
      {step === 'menu' && !deepLinkResolving && (
        <MenuList
          onSelect={(m) => {
            if (menu?.id !== m.id) {
              setStaff(null);
              setSlot(null);
            }
            setMenu(m);
            setStep('staff');
          }}
        />
      )}
      {step === 'staff' && menu && (
        <StaffList
          menuId={menu.id}
          basePrice={menu.base_price}
          onSelect={(s) => {
            if (staff?.id !== s.id) setSlot(null);
            setStaff(s);
            setStep('datetime');
          }}
          onBack={() => setStep('menu')}
        />
      )}
      {step === 'datetime' && menu && staff && (
        <DateTimePicker
          menuId={menu.id}
          staffId={staff.id}
          ctaLabel={
            peekMode
              ? '空き状況の確認モードです（タップで予約に進めます）'
              : 'step 3 / 4'
          }
          selected={slot}
          onSelect={(picked) => {
            setSlot(picked);
            if (!peekMode) setStep('confirm');
          }}
          onBack={() => setStep('staff')}
        />
      )}
      {step === 'datetime' && peekMode && slot && (
        <div
          className="fixed bottom-0 left-0 right-0 px-4 py-3 sb-slide-up"
          style={{ background: 'rgba(255, 255, 255, 0.95)', backdropFilter: 'blur(8px)', borderTop: '1px solid #e5e7eb' }}
        >
          <div className="max-w-md mx-auto">
            <p className="text-xs text-gray-600 mb-2">
              選択中: <span className="font-semibold">{slot.date} {slot.start}</span>
            </p>
            <button
              onClick={exitPeekToBooking}
              className="w-full text-white py-3 rounded-xl font-bold text-sm"
              style={{ background: '#06C755', boxShadow: '0 1px 3px rgba(6, 199, 85, 0.3)' }}
            >
              この時間で予約に進む
            </button>
          </div>
        </div>
      )}
      {step === 'confirm' && menu && staff && slot && (
        <Confirm
          menu={menu}
          staff={staff}
          slot={slot}
          onSubmitted={() => setStep('done')}
          onBack={() => setStep('datetime')}
        />
      )}
      {step === 'done' && <Done />}
    </div>
  );
}
