'use client'

import { useState, useEffect, useCallback } from 'react'
import Header from '@/components/layout/header'
import { api } from '@/lib/api'
import CcPromptButton from '@/components/cc-prompt-button'
import {
  Badge,
  Banner,
  Button,
  Card,
  CardContent,
  Input,
  Label,
} from '@/components/ui/primitives'
import type { IncomingWebhook, OutgoingWebhook } from '@line-crm/shared'

type Tab = 'incoming' | 'outgoing'

const MIN_SECRET_LENGTH = 32

const ccPrompts = [
  {
    title: 'Webhook設定ガイド',
    prompt: `Webhookの設定手順をガイドしてください。
1. 受信Webhook（Incoming）の作成とエンドポイントURLの設定方法
2. 送信Webhook（Outgoing）のURL・イベントタイプ・シークレット設定
3. LINE公式アカウントとのWebhook連携設定手順
手順を示してください。`,
  },
  {
    title: 'Webhookデバッグ',
    prompt: `Webhookの動作確認とデバッグをサポートしてください。
1. 受信・送信Webhookの有効/無効ステータスを確認
2. Webhookのテスト送信と応答検証の手順
3. よくあるエラーパターンとトラブルシューティング方法
手順を示してください。`,
  },
]

// Generate a 32-char URL-safe random secret in the browser. 24 random bytes
// produce exactly 32 base64 characters; remap +/ to -/_ instead of stripping
// so we always end up with 32 chars (stripping would drop the count).
function generateSecret(): string {
  const buf = new Uint8Array(24)
  crypto.getRandomValues(buf)
  let s = ''
  for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

function isHttpsUrl(value: string): boolean {
  try {
    return new URL(value).protocol === 'https:'
  } catch {
    return false
  }
}

export default function WebhooksPage() {
  const [tab, setTab] = useState<Tab>('incoming')
  const [incoming, setIncoming] = useState<IncomingWebhook[]>([])
  const [outgoing, setOutgoing] = useState<OutgoingWebhook[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const [inForm, setInForm] = useState({ name: '', sourceType: '', secret: '' })
  const [outForm, setOutForm] = useState({ name: '', url: '', eventTypes: '', secret: '' })

  // After a successful create the API returns the secret exactly once.
  // Show it to the operator with a copy affordance, then forget it.
  const [createdSecret, setCreatedSecret] = useState<{ name: string; secret: string } | null>(null)
  const [secretCopied, setSecretCopied] = useState(false)

  // Rotate-secret modal state. Used to recover legacy webhooks deactivated
  // by migration 034, or to rotate a leaked secret in place.
  const [rotateTarget, setRotateTarget] = useState<
    | { kind: 'incoming' | 'outgoing'; id: string; name: string; activate: boolean }
    | null
  >(null)
  const [rotateSecretValue, setRotateSecretValue] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const [inRes, outRes] = await Promise.all([
        api.webhooks.incoming.list(),
        api.webhooks.outgoing.list(),
      ])
      if (inRes.success) setIncoming(inRes.data)
      else setError(inRes.error)
      if (outRes.success) setOutgoing(outRes.data)
      else setError(outRes.error)
    } catch {
      setError('データの読み込みに失敗しました。もう一度お試しください。')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleToggleIncoming = async (id: string, currentActive: boolean) => {
    try {
      await api.webhooks.incoming.update(id, { isActive: !currentActive })
      load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleToggleOutgoing = async (id: string, currentActive: boolean) => {
    try {
      await api.webhooks.outgoing.update(id, { isActive: !currentActive })
      load()
    } catch {
      setError('更新に失敗しました')
    }
  }

  const handleDeleteIncoming = async (id: string) => {
    if (!confirm('この受信Webhookを削除しますか？')) return
    try {
      await api.webhooks.incoming.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleDeleteOutgoing = async (id: string) => {
    if (!confirm('この送信Webhookを削除しますか？')) return
    try {
      await api.webhooks.outgoing.delete(id)
      load()
    } catch {
      setError('削除に失敗しました')
    }
  }

  const handleCreateIncoming = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!inForm.name) return
    if (inForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const res = await api.webhooks.incoming.create({
        name: inForm.name,
        sourceType: inForm.sourceType || undefined,
        secret: inForm.secret,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setSecretCopied(false)
      setInForm({ name: '', sourceType: '', secret: '' })
      setShowCreate(false)
      load()
    } catch {
      setError('作成に失敗しました')
    }
  }

  const handleCreateOutgoing = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!outForm.name || !outForm.url) return
    if (!isHttpsUrl(outForm.url)) {
      setError('URLは https:// から始まる必要があります')
      return
    }
    if (outForm.secret.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const eventTypes = outForm.eventTypes
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const res = await api.webhooks.outgoing.create({
        name: outForm.name,
        url: outForm.url,
        eventTypes,
        secret: outForm.secret,
      })
      if (!res.success) {
        setError(res.error)
        return
      }
      setCreatedSecret({ name: res.data.name, secret: res.data.secret })
      setSecretCopied(false)
      setOutForm({ name: '', url: '', eventTypes: '', secret: '' })
      setShowCreate(false)
      load()
    } catch {
      setError('作成に失敗しました')
    }
  }

  const copySecret = async (secret: string) => {
    try {
      await navigator.clipboard.writeText(secret)
      setSecretCopied(true)
    } catch {
      // ignore — operator can still copy manually
    }
  }

  const handleRotateSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    if (!rotateTarget) return
    if (rotateSecretValue.length < MIN_SECRET_LENGTH) {
      setError(`シークレットは最低${MIN_SECRET_LENGTH}文字必要です`)
      return
    }
    try {
      const payload = { secret: rotateSecretValue, isActive: rotateTarget.activate || undefined }
      const res =
        rotateTarget.kind === 'incoming'
          ? await api.webhooks.incoming.update(rotateTarget.id, payload)
          : await api.webhooks.outgoing.update(rotateTarget.id, payload)
      if (!res.success) {
        setError(res.error)
        return
      }
      setRotateTarget(null)
      setRotateSecretValue('')
      load()
    } catch {
      setError('シークレットの更新に失敗しました')
    }
  }

  const endpointUrl = (id: string) =>
    `${typeof window !== 'undefined' ? window.location.origin : ''}/api/webhooks/incoming/${id}/receive`

  return (
    <div>
      <Header
        title="Webhook管理"
        action={
          <Button
            onClick={() => setShowCreate(!showCreate)}
            variant="primary"
          >
            {showCreate ? 'キャンセル' : '+ 新規Webhook'}
          </Button>
        }
      />

      {/* Rotate-secret modal — used to recover legacy webhooks or rotate. */}
      {rotateTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <form onSubmit={handleRotateSubmit} className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              「{rotateTarget.name}」のシークレットを{rotateTarget.activate ? '設定して有効化' : '更新'}
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              新しいシークレットを設定します。
              <strong className="text-red-600">設定後は今回限り画面に表示されません。</strong>
              控えておいてから「保存」を押してください。
            </p>
            <div className="flex gap-2 mb-4">
              <Input
                value={rotateSecretValue}
                onChange={(e) => setRotateSecretValue(e.target.value)}
                className="flex-1 font-mono mt-0"
                placeholder="ランダムな英数字32文字以上"
                required
                minLength={MIN_SECRET_LENGTH}
                autoFocus
              />
              <Button
                type="button"
                variant="outline"
                onClick={() => setRotateSecretValue(generateSecret())}
                className="whitespace-nowrap"
              >
                自動生成
              </Button>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setRotateTarget(null)
                  setRotateSecretValue('')
                }}
              >
                キャンセル
              </Button>
              <Button type="submit" variant="primary">
                保存
              </Button>
            </div>
          </form>
        </div>
      )}

      {/* Created-secret modal — shown ONCE after a successful create. */}
      {createdSecret && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-lg w-full p-6">
            <h2 className="text-lg font-semibold text-gray-900 mb-2">
              シークレットを保存してください
            </h2>
            <p className="text-sm text-gray-600 mb-4">
              「{createdSecret.name}」を作成しました。
              <strong className="text-red-600">このシークレットは今後二度と表示されません。</strong>
              閉じる前に必ず安全な場所に保存してください。
            </p>
            <div className="bg-gray-50 border border-gray-200 rounded p-3 mb-4">
              <code className="text-sm break-all">{createdSecret.secret}</code>
            </div>
            <div className="flex gap-2 justify-end">
              <Button
                variant="outline"
                onClick={() => copySecret(createdSecret.secret)}
              >
                {secretCopied ? 'コピー済み' : 'クリップボードにコピー'}
              </Button>
              <Button
                variant="primary"
                onClick={() => {
                  setCreatedSecret(null)
                  setSecretCopied(false)
                }}
              >
                保存しました
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Error */}
      {error && (
        <Banner tone="danger" className="mb-4">
          {error}
        </Banner>
      )}

      {/* Tabs */}
      <div className="flex gap-1 mb-6 bg-gray-100 rounded-lg p-1 w-fit">
        <button
          onClick={() => { setTab('incoming'); setShowCreate(false) }}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-md transition-colors ${
            tab === 'incoming'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          受信 (Incoming)
        </button>
        <button
          onClick={() => { setTab('outgoing'); setShowCreate(false) }}
          className={`px-4 py-2 min-h-[44px] text-sm font-medium rounded-md transition-colors ${
            tab === 'outgoing'
              ? 'bg-white text-gray-900 shadow-sm'
              : 'text-gray-500 hover:text-gray-700'
          }`}
        >
          送信 (Outgoing)
        </button>
      </div>

      {/* Create forms */}
      {showCreate && tab === 'incoming' && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <form onSubmit={handleCreateIncoming}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">受信Webhook作成</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>名前</Label>
                  <Input
                    value={inForm.name}
                    onChange={(e) => setInForm({ ...inForm, name: e.target.value })}
                    placeholder="LINE公式アカウント"
                    required
                  />
                </div>
                <div>
                  <Label>ソースタイプ</Label>
                  <Input
                    value={inForm.sourceType}
                    onChange={(e) => setInForm({ ...inForm, sourceType: e.target.value })}
                    placeholder="line"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>シークレット (最低{MIN_SECRET_LENGTH}文字)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={inForm.secret}
                      onChange={(e) => setInForm({ ...inForm, secret: e.target.value })}
                      className="flex-1 font-mono"
                      placeholder="ランダムな英数字32文字以上"
                      required
                      minLength={MIN_SECRET_LENGTH}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setInForm({ ...inForm, secret: generateSecret() })}
                      className="whitespace-nowrap mt-1"
                    >
                      自動生成
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    外部システムが Webhook 受信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名する際に使用します。
                  </p>
                </div>
              </div>
              <Button type="submit" variant="primary" className="mt-4">
                作成
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {showCreate && tab === 'outgoing' && (
        <Card className="mb-6">
          <CardContent className="pt-5">
            <form onSubmit={handleCreateOutgoing}>
              <h3 className="text-sm font-semibold text-gray-900 mb-4">送信Webhook作成</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label>名前</Label>
                  <Input
                    value={outForm.name}
                    onChange={(e) => setOutForm({ ...outForm, name: e.target.value })}
                    placeholder="外部CRM連携"
                    required
                  />
                </div>
                <div>
                  <Label>URL (https:// 必須)</Label>
                  <Input
                    type="url"
                    value={outForm.url}
                    onChange={(e) => setOutForm({ ...outForm, url: e.target.value })}
                    placeholder="https://example.com/webhook"
                    pattern="https://.*"
                    required
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>イベントタイプ (カンマ区切り、* で全イベント)</Label>
                  <Input
                    value={outForm.eventTypes}
                    onChange={(e) => setOutForm({ ...outForm, eventTypes: e.target.value })}
                    placeholder="friend.added, message.received"
                  />
                </div>
                <div className="sm:col-span-2">
                  <Label>シークレット (最低{MIN_SECRET_LENGTH}文字)</Label>
                  <div className="flex gap-2">
                    <Input
                      value={outForm.secret}
                      onChange={(e) => setOutForm({ ...outForm, secret: e.target.value })}
                      className="flex-1 font-mono"
                      placeholder="ランダムな英数字32文字以上"
                      required
                      minLength={MIN_SECRET_LENGTH}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setOutForm({ ...outForm, secret: generateSecret() })}
                      className="whitespace-nowrap mt-1"
                    >
                      自動生成
                    </Button>
                  </div>
                  <p className="text-xs text-gray-500 mt-1">
                    送信時に X-Webhook-Signature ヘッダで HMAC-SHA256 署名するために使われます。受信側で同じシークレットで検証してください。
                  </p>
                </div>
              </div>
              <Button type="submit" variant="primary" className="mt-4">
                作成
              </Button>
            </form>
          </CardContent>
        </Card>
      )}

      {/* Loading */}
      {loading ? (
        <Card className="overflow-hidden">
          {[...Array(4)].map((_, i) => (
            <div key={i} className="px-4 py-4 border-b border-gray-100 flex items-center gap-4 animate-pulse">
              <div className="flex-1 space-y-2">
                <div className="h-3 bg-gray-200 rounded w-48" />
                <div className="h-2 bg-gray-100 rounded w-32" />
              </div>
              <div className="h-5 bg-gray-100 rounded-full w-16" />
              <div className="h-3 bg-gray-100 rounded w-24" />
            </div>
          ))}
        </Card>
      ) : tab === 'incoming' ? (
        /* Incoming table */
        incoming.length === 0 && !showCreate ? (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-gray-500">受信Webhookがありません。「新規Webhook」から作成してください。</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ソースタイプ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">エンドポイントURL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">シークレット</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {incoming.map((wh) => (
                  <tr key={wh.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{wh.name}</td>
                    <td className="px-4 py-3 text-sm text-gray-600">{wh.sourceType || '-'}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                        {endpointUrl(wh.id)}
                      </code>
                    </td>
                    <td className="px-4 py-3">
                      {wh.hasSecret ? (
                        <Badge tone="success">設定済</Badge>
                      ) : (
                        <Badge tone="warning">未設定</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleIncoming(wh.id, wh.isActive)}
                        disabled={!wh.hasSecret && !wh.isActive}
                        className="disabled:opacity-50 disabled:cursor-not-allowed"
                        title={!wh.hasSecret && !wh.isActive ? 'シークレット未設定のため有効化できません' : ''}
                      >
                        {wh.isActive ? (
                          <Badge tone="success">有効</Badge>
                        ) : (
                          <Badge tone="neutral">無効</Badge>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(wh.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRotateTarget({
                            kind: 'incoming',
                            id: wh.id,
                            name: wh.name,
                            activate: !wh.hasSecret,
                          })
                          setRotateSecretValue('')
                        }}
                        className="mr-1"
                      >
                        {wh.hasSecret ? 'シークレット更新' : 'シークレット設定'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteIncoming(wh.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </Card>
        )
      ) : (
        /* Outgoing table */
        outgoing.length === 0 && !showCreate ? (
          <Card>
            <CardContent className="p-12 text-center">
              <p className="text-gray-500">送信Webhookがありません。「新規Webhook」から作成してください。</p>
            </CardContent>
          </Card>
        ) : (
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-200">
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">名前</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">URL</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">イベントタイプ</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">シークレット</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">ステータス</th>
                  <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">作成日</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {outgoing.map((wh) => {
                  const hasValidUrl = isHttpsUrl(wh.url)
                  const canActivate = wh.hasSecret && hasValidUrl
                  const blockedReason = !canActivate
                    ? !wh.hasSecret && !hasValidUrl
                      ? 'シークレット未設定 + URL が https:// ではないため有効化できません'
                      : !wh.hasSecret
                        ? 'シークレット未設定のため有効化できません'
                        : 'URL が https:// ではないため有効化できません'
                    : ''
                  return (
                  <tr key={wh.id} className="hover:bg-gray-50 transition-colors">
                    <td className="px-4 py-3 text-sm font-medium text-gray-900">{wh.name}</td>
                    <td className="px-4 py-3">
                      <code className="text-xs bg-gray-100 px-2 py-1 rounded text-gray-700 break-all">
                        {wh.url}
                      </code>
                      {!hasValidUrl && (
                        <p className="text-xs text-amber-700 mt-1">
                          ※ https:// で始まる完全な URL に作り直してください
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {wh.eventTypes.map((et) => (
                          <Badge key={et} tone="info">
                            {et}
                          </Badge>
                        ))}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      {wh.hasSecret ? (
                        <Badge tone="success">設定済</Badge>
                      ) : (
                        <Badge tone="warning">未設定</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={() => handleToggleOutgoing(wh.id, wh.isActive)}
                        disabled={!canActivate && !wh.isActive}
                        className="disabled:opacity-50 disabled:cursor-not-allowed"
                        title={blockedReason}
                      >
                        {wh.isActive ? (
                          <Badge tone="success">有効</Badge>
                        ) : (
                          <Badge tone="neutral">無効</Badge>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500">
                      {new Date(wh.createdAt).toLocaleDateString('ja-JP')}
                    </td>
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => {
                          setRotateTarget({
                            kind: 'outgoing',
                            id: wh.id,
                            name: wh.name,
                            activate: hasValidUrl && !wh.hasSecret,
                          })
                          setRotateSecretValue('')
                        }}
                        className="mr-1"
                      >
                        {wh.hasSecret ? 'シークレット更新' : 'シークレット設定'}
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleDeleteOutgoing(wh.id)}
                        className="text-red-500 hover:text-red-700 hover:bg-red-50"
                      >
                        削除
                      </Button>
                    </td>
                  </tr>
                  )
                })}
              </tbody>
            </table>
            </div>
          </Card>
        )
      )}
      <CcPromptButton prompts={ccPrompts} />
    </div>
  )
}
