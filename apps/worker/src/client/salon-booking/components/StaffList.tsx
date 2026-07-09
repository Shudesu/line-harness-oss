import { useEffect, useState } from 'react';
import { createApi, type StaffItem } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';

export default function StaffList({
  menuId,
  basePrice,
  onSelect,
  onBack,
}: {
  menuId: string;
  basePrice: number;
  onSelect: (s: StaffItem) => void;
  onBack: () => void;
}) {
  const ctx = useSalonContext();
  const labels = ctx.labels;
  const [list, setList] = useState<StaffItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    createApi(ctx)
      .staffOf(menuId)
      .then((r) => setList(r.staff))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ctx, menuId]);

  if (error) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="sb-card text-center">
          <p className="text-red-600 text-sm mb-2">{labels.staffError}</p>
          <p className="text-gray-500 text-xs mb-4">{error}</p>
          <button
            onClick={() => window.location.reload()}
            className="text-sm font-semibold sb-line-green-text underline"
          >
            再読み込み
          </button>
        </div>
      </div>
    );
  }
  if (!list) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="flex flex-col items-center py-12">
          <div className="sb-spinner" />
          <p className="text-sm text-gray-500 mt-3">{labels.staffLoading}</p>
        </div>
      </div>
    );
  }
  if (list.length === 0) {
    return (
      <div className="space-y-5 sb-fade-in">
        <BackButton onBack={onBack} />
        <div className="sb-card text-center text-sm text-gray-500">
          {labels.staffEmpty}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5 sb-fade-in">
      <BackButton onBack={onBack} />
      <div>
        <h1 className="text-base font-bold text-gray-900">{labels.staffTitle}</h1>
        <p className="text-xs text-gray-500 mt-1">step 2 / 4</p>
      </div>
      <ul className="space-y-2">
        {list.map((s) => (
          <li key={s.id}>
            <button
              onClick={() => onSelect(s)}
              className="w-full sb-card flex items-center gap-3 active:scale-[0.99]"
              style={{ transition: 'transform 0.1s, box-shadow 0.15s' }}
            >
              {s.profile_image_url ? (
                <img
                  src={s.profile_image_url}
                  alt={s.display_name}
                  className="w-12 h-12 rounded-full object-cover shrink-0"
                />
              ) : (
                <div
                  className="w-12 h-12 rounded-full shrink-0 flex items-center justify-center text-white font-semibold"
                  style={{
                    background: s.is_designation_optional
                      ? '#9CA3AF'
                      : 'linear-gradient(135deg, #06C755 0%, #04a046 100%)',
                  }}
                >
                  {s.is_designation_optional ? labels.staffOptionalAvatar : s.display_name.slice(0, 1)}
                </div>
              )}
              <div className="text-left flex-1 min-w-0">
                <div className="font-semibold text-gray-900">{s.display_name}</div>
                {s.role && <div className="text-xs text-gray-500 mt-0.5">{s.role}</div>}
                {s.is_designation_optional ? (
                  <div className="text-xs text-purple-600 mt-1">{labels.staffOptionalBadge}</div>
                ) : null}
              </div>
              {s.price !== 0 && (
                <div className="text-right shrink-0">
                  <div className="text-sm font-semibold sb-line-green-text tabular-nums">
                    ¥{s.price.toLocaleString()}
                  </div>
                  {s.price !== basePrice && <div className="text-xs text-gray-300">〜</div>}
                </div>
              )}
            </button>
          </li>
        ))}
      </ul>
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
