'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { Button } from '@cloudflare/kumo/components/button';
import { Banner } from '@cloudflare/kumo/components/banner';
type Extension = {
  id: string;
  name: string;
  url: string;
  launch: 'none' | 'ticket';
};
export default function ExtensionsPage() {
  const [entries, setEntries] = useState<Extension[]>([]),
    [active, setActive] = useState<{ name: string; url: string } | null>(null),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false);
  useEffect(() => {
    let cancelled = false;
    fetchApi<{ data: Extension[] }>('/api/admin/extensions')
      .then((r) => {
        if (!cancelled) setEntries(r.data);
      })
      .catch((e) => {
        if (!cancelled) setError(e.message);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  const launch = async (entry: Extension) => {
    setBusy(true);
    setError('');
    setActive(null);
    try {
      const url = new URL(entry.url);
      if (entry.launch === 'ticket') {
        const res = await fetchApi<{ data: { ticket: string } }>(
          '/api/admin/extensions/' + encodeURIComponent(entry.id) + '/launch',
          { method: 'POST', body: '{}' },
        );
        url.hash = 'lh_ticket=' + encodeURIComponent(res.data.ticket);
      }
      setActive({ name: entry.name, url: url.toString() });
    } catch (e) {
      setError(e instanceof Error ? e.message : '起動に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="p-6 space-y-4">
      <h1 className="text-xl font-bold">拡張機能</h1>
      {error && <Banner variant="alert" title={error} />}
      <div className="flex gap-3">
        {entries.map((e) => (
          <Button key={e.id} disabled={busy} onClick={() => void launch(e)}>
            {e.name}
          </Button>
        ))}
      </div>
      {!entries.length && <p>利用できる拡張機能はありません。</p>}
      {active && (
        <iframe
          key={active.url}
          title={active.name}
          src={active.url}
          referrerPolicy="no-referrer"
          sandbox="allow-scripts allow-forms"
          className="w-full h-[75vh] border rounded"
        />
      )}
    </main>
  );
}
