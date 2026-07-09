import { useEffect, useState } from 'react';
import { createApi, type MenuItem } from '../lib/api.js';
import { useSalonContext } from '../lib/context.js';

export default function MenuList({ onSelect }: { onSelect: (m: MenuItem) => void }) {
  const ctx = useSalonContext();
  const labels = ctx.labels;
  const [menus, setMenus] = useState<MenuItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    createApi(ctx)
      .menus()
      .then((r) => setMenus(r.menus))
      .catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [ctx]);

  if (error) {
    return (
      <div className="sb-card text-center" style={{ animation: 'sb-fade-in 0.3s' }}>
        <p className="text-red-600 text-sm mb-3">{labels.menuError}</p>
        <p className="text-gray-500 text-xs mb-4">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="text-sm font-semibold sb-line-green-text underline"
        >
          再読み込み
        </button>
      </div>
    );
  }
  if (!menus) {
    return (
      <div className="flex flex-col items-center py-12">
        <div className="sb-spinner" />
        <p className="text-sm text-gray-500 mt-3">{labels.menuLoading}</p>
      </div>
    );
  }
  if (menus.length === 0) {
    return (
      <div className="sb-card text-center text-sm text-gray-500">
        {labels.menuEmpty}
      </div>
    );
  }

  const grouped = new Map<string, MenuItem[]>();
  for (const m of menus) {
    const key = m.category_label ?? 'その他';
    if (!grouped.has(key)) grouped.set(key, []);
    grouped.get(key)!.push(m);
  }

  return (
    <div className="space-y-5 sb-fade-in">
      <div>
        <h1 className="text-base font-bold text-gray-900">{labels.menuTitle}</h1>
        <p className="text-xs text-gray-500 mt-1">step 1 / 4</p>
      </div>
      {[...grouped.entries()].map(([cat, items]) => (
        <section key={cat} className="space-y-2">
          <h2 className="text-xs font-semibold text-gray-500 uppercase tracking-wide px-1">
            {cat}
          </h2>
          <ul className="space-y-2">
            {items.map((m) => (
              <li key={m.id}>
                <button
                  onClick={() => onSelect(m)}
                  className="w-full text-left sb-card hover:shadow-md transition-shadow active:scale-[0.99]"
                  style={{ transition: 'box-shadow 0.15s, transform 0.1s' }}
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold text-gray-900">{m.name}</div>
                      {m.description && (
                        <p className="text-xs text-gray-500 mt-1 line-clamp-2">{m.description}</p>
                      )}
                      <div className="text-xs text-gray-400 mt-2">
                        所要 {m.duration_minutes}分
                        {m.buffer_after_minutes > 0 && (
                          <span className="text-gray-300"> +{m.buffer_after_minutes}</span>
                        )}
                      </div>
                    </div>
                    {m.base_price !== 0 && (
                      <div className="text-right shrink-0">
                        <div className="font-bold sb-line-green-text tabular-nums">
                          ¥{m.base_price.toLocaleString()}
                        </div>
                        <div className="text-xs text-gray-300">〜</div>
                      </div>
                    )}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
