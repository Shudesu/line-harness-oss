'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { Button } from '@cloudflare/kumo/components/button';
import { Banner } from '@cloudflare/kumo/components/banner';
import { Input } from '@cloudflare/kumo/components/input';
type Key = {
  id: string;
  name: string;
  createdAt: number;
  lastUsedAt: number | null;
};
export default function PasskeysPage() {
  const [keys, setKeys] = useState<Key[]>([]),
    [name, setName] = useState('この端末'),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [pending, setPending] = useState('');
  const load = async () => {
    try {
      setKeys((await fetchApi<{ data: Key[] }>('/api/auth/passkeys')).data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const register = async () => {
    setBusy(true);
    setError('');
    try {
      const { startRegistration } = await import('@simplewebauthn/browser');
      const result = await fetchApi<{
        data: {
          options: Parameters<typeof startRegistration>[0]['optionsJSON'];
          challengeId: string;
        };
      }>('/api/auth/passkeys/register/options', { method: 'POST', body: '{}' });
      const response = await startRegistration({
        optionsJSON: result.data.options,
      });
      await fetchApi('/api/auth/passkeys/register/verify', {
        method: 'POST',
        body: JSON.stringify({
          challengeId: result.data.challengeId,
          response,
          name,
        }),
      });
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : '登録に失敗しました';
      setError(
        message.includes('reauth_required')
          ? 'ログインし直してから10分以内に登録してください。'
          : message,
      );
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    setBusy(true);
    try {
      await fetchApi('/api/auth/passkeys/' + pending, { method: 'DELETE' });
      setPending('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '削除に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  return (
    <main className="p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-xl font-bold">パスキー</h1>
      <p>
        次回から指紋・顔認証・セキュリティキーでログインできます。登録には10分以内のログインが必要です。管理画面のドメインを変えた場合は再登録してください。
      </p>
      {error && <Banner variant="alert" title={error} />}
      <Input
        aria-label="パスキー名"
        value={name}
        maxLength={100}
        onChange={(e) => setName(e.target.value)}
      />
      <Button disabled={busy || !name.trim()} onClick={() => void register()}>
        この端末のパスキーを登録
      </Button>
      <ul>
        {keys.map((key) => (
          <li key={key.id} className="border-b py-3 flex justify-between">
            <span>
              {key.name}（登録:{' '}
              {new Date(key.createdAt * 1000).toLocaleDateString('ja-JP')}）
            </span>
            <Button disabled={busy} onClick={() => setPending(key.id)}>
              削除
            </Button>
          </li>
        ))}
      </ul>
      {pending && (
        <div className="border rounded p-4">
          <p>
            このパスキーを削除しますか？
            別のログイン方法が利用できることを確認してください。
          </p>
          <Button disabled={busy} onClick={() => void remove()}>
            削除する
          </Button>
          <Button onClick={() => setPending('')}>キャンセル</Button>
        </div>
      )}
    </main>
  );
}
