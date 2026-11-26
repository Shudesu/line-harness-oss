'use client';
import { useEffect, useState } from 'react';
import { fetchApi } from '@/lib/api';
import { Button } from '@cloudflare/kumo/components/button';
import { Banner } from '@cloudflare/kumo/components/banner';
import { Input } from '@cloudflare/kumo/components/input';
import { Dialog } from '@cloudflare/kumo/components/dialog';
import { ClipboardText } from '@cloudflare/kumo/components/clipboard-text';
type Scope = 'read' | 'write' | 'send' | 'admin';
type Key = {
  id: string;
  name: string;
  key_last4: string;
  scopes: Scope[];
  last_used_at: number | null;
  expires_at: number | null;
  revoked_at: number | null;
};
const labels: Record<Scope, string> = {
  read: '読み取り',
  write: '作成・編集',
  send: 'メッセージ送信',
  admin: '連携設定の管理',
};
export default function MachineKeysPage() {
  const [keys, setKeys] = useState<Key[]>([]),
    [name, setName] = useState(''),
    [scopes, setScopes] = useState<Scope[]>(['read']),
    [days, setDays] = useState('90'),
    [token, setToken] = useState(''),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [offset, setOffset] = useState(0),
    [revoke, setRevoke] = useState<Key | null>(null);
  const load = async () => {
    try {
      const res = await fetchApi<{ data: Key[] }>(
        '/api/machine-keys?offset=' + offset,
      );
      setKeys(res.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '取得に失敗しました');
    }
  };
  useEffect(() => {
    void load();
  }, [offset]);
  const create = async () => {
    setBusy(true);
    setError('');
    try {
      const res = await fetchApi<{ data: { token: string } }>(
        '/api/machine-keys',
        {
          method: 'POST',
          body: JSON.stringify({
            name,
            scopes,
            expiresAt: Math.floor(Date.now() / 1000) + Number(days) * 86400,
          }),
        },
      );
      setToken(res.data.token);
      setName('');
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '発行に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  const remove = async () => {
    if (!revoke) return;
    setBusy(true);
    try {
      await fetchApi('/api/machine-keys/' + revoke.id, { method: 'DELETE' });
      setRevoke(null);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : '失効に失敗しました');
    } finally {
      setBusy(false);
    }
  };
  const date = (value: number | null) =>
    value ? new Date(value * 1000).toLocaleString('ja-JP') : 'なし';
  return (
    <main className="p-6 max-w-4xl mx-auto space-y-5">
      <h1 className="text-xl font-bold">APIキー（外部連携）</h1>
      <p>
        連携ごとにキーを発行します。まず読み取りのみを選び、必要な権限だけ追加してください。
      </p>
      {error && <Banner variant="alert" title={error} />}
      <div className="border rounded p-4 space-y-3">
        <Input
          aria-label="連携名"
          placeholder="例: レポート用MCP"
          value={name}
          onChange={(e) => setName(e.target.value)}
          maxLength={100}
        />
        <fieldset className="flex gap-4">
          <legend>権限</legend>
          {(Object.keys(labels) as Scope[]).map((scope) => (
            <label key={scope}>
              <input
                type="checkbox"
                checked={scopes.includes(scope)}
                onChange={(e) =>
                  setScopes(
                    e.target.checked
                      ? [...scopes, scope]
                      : scopes.filter((s) => s !== scope),
                  )
                }
              />
              {labels[scope]}
            </label>
          ))}
        </fieldset>
        <label>
          有効日数{' '}
          <input
            type="number"
            min="1"
            max="3650"
            value={days}
            onChange={(e) => setDays(e.target.value)}
            className="border rounded p-1"
          />
        </label>
        <Button
          disabled={
            busy ||
            !name.trim() ||
            !scopes.length ||
            !Number.isInteger(Number(days)) ||
            Number(days) < 1 ||
            Number(days) > 3650
          }
          onClick={() => void create()}
        >
          キーを発行
        </Button>
      </div>
      <table className="w-full text-sm">
        <thead>
          <tr>
            {['名前', '末尾', '権限', '最終使用', '期限', '操作'].map((v) => (
              <th key={v} className="text-left p-2">
                {v}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {keys.map((key) => (
            <tr key={key.id} className="border-t">
              <td className="p-2">{key.name}</td>
              <td>…{key.key_last4}</td>
              <td>{key.scopes.map((s) => labels[s]).join('・')}</td>
              <td>{date(key.last_used_at)}</td>
              <td>{date(key.expires_at)}</td>
              <td>
                {key.revoked_at ? (
                  '失効済み'
                ) : (
                  <Button disabled={busy} onClick={() => setRevoke(key)}>
                    失効
                  </Button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-3">
        <Button
          disabled={offset === 0}
          onClick={() => setOffset(Math.max(0, offset - 50))}
        >
          前へ
        </Button>
        <Button
          disabled={keys.length < 50 || offset >= 10000}
          onClick={() => setOffset(offset + 50)}
        >
          次へ
        </Button>
      </div>
      <Dialog.Root
        open={!!token}
        onOpenChange={(open) => {
          if (!open) setToken('');
        }}
      >
        <Dialog className="p-6">
          <Dialog.Title>キーを保存してください</Dialog.Title>
          <p className="my-3">
            この画面を閉じると再表示できません。連携先の秘密情報欄へ保存してください。
          </p>
          <ClipboardText text={token} />
          <Button onClick={() => setToken('')}>閉じる</Button>
        </Dialog>
      </Dialog.Root>
      <Dialog.Root
        open={!!revoke}
        onOpenChange={(open) => {
          if (!open) setRevoke(null);
        }}
      >
        <Dialog className="p-6">
          <Dialog.Title>「{revoke?.name}」を失効しますか？</Dialog.Title>
          <p className="my-3">
            このキーを使う連携は停止します。差し替え済みか確認してください。
          </p>
          <Button disabled={busy} onClick={() => void remove()}>
            失効する
          </Button>
          <Button onClick={() => setRevoke(null)}>キャンセル</Button>
        </Dialog>
      </Dialog.Root>
    </main>
  );
}
