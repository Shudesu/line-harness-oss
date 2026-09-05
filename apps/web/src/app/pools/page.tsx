'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { getApiBase } from '@/lib/api-base'
import Header from '@/components/layout/header'
import type { TrafficPool, PoolAccount, LineAccount } from '@line-crm/shared'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Empty } from '@cloudflare/kumo/components/empty'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Select } from '@cloudflare/kumo/components/select'

export default function PoolsPage() {
  const [pools, setPools] = useState<TrafficPool[]>([])
  const [accounts, setAccounts] = useState<LineAccount[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showCreate, setShowCreate] = useState(false)

  const load = async () => {
    setLoading(true)
    setError('')
    const [poolsRes, accRes] = await Promise.all([api.pools.list(), api.lineAccounts.list()])
    if (poolsRes.success) setPools(poolsRes.data)
    else setError('プール一覧の取得に失敗しました')
    if (accRes.success) setAccounts(accRes.data)
    setLoading(false)
  }

  useEffect(() => {
    load()
  }, [])

  // Pin main pool to the top
  const sortedPools = [...pools].sort((a, b) =>
    a.slug === 'main' ? -1 : b.slug === 'main' ? 1 : a.name.localeCompare(b.name),
  )

  return (
    <div>
      <Header
        title="プール管理"
        description="LINE 公式アカウントの分散先を管理します。アカウントが 1 つでも『メインプール』として表示されます。"
      />

      <div className="flex justify-between items-center mb-4">
        <span className="text-sm text-gray-500">{pools.length} プール</span>
        <Button
          type="button"
          variant="primary"
          size="sm"
          onClick={() => setShowCreate(true)}
        >
          + 新規プール
        </Button>
      </div>

      {error && (
        <Banner className="mb-4" variant="error" title="プールを読み込めませんでした" description={error} />
      )}

      {loading ? (
        <LayerCard className="p-8"><Loader className="mx-auto" /></LayerCard>
      ) : (
        <div className="space-y-3">
          {sortedPools.map((pool) => (
            <PoolCard key={pool.id} pool={pool} accounts={accounts} onChange={load} />
          ))}
        </div>
      )}

      {showCreate && (
        <CreatePoolModal
          accounts={accounts}
          onClose={() => setShowCreate(false)}
          onCreated={() => {
            setShowCreate(false)
            load()
          }}
        />
      )}
    </div>
  )
}

function PoolCard({
  pool,
  accounts,
  onChange,
}: {
  pool: TrafficPool
  accounts: LineAccount[]
  onChange: () => void
}) {
  const isMain = pool.slug === 'main'
  const apiBase = getApiBase() ?? ''
  const publicUrl = `${apiBase}/pool/${pool.slug}`
  const [copied, setCopied] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const onCopy = async () => {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 1200)
    } catch {
      // clipboard requires secure context — silent fallback
    }
  }
  const onDelete = async () => {
    if (isMain) return
    const res = await api.pools.delete(pool.id)
    if (res.success) {
      setDeleteOpen(false)
      onChange()
    }
    else alert(res.error ?? '削除に失敗しました')
  }

  return (
    <LayerCard className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h3 className="font-medium">
            {pool.name}
            {isMain && (
              <span className="ml-2"><Badge variant="info">既定</Badge></span>
            )}
          </h3>
          <p className="text-xs text-gray-500 font-mono">{pool.slug}</p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            size="xs"
            variant="secondary"
            onClick={onCopy}
          >
            {copied ? '✓ コピー済' : '公開 URL コピー'}
          </Button>
          {!isMain && (
            <Button
              type="button"
              size="xs"
              variant="destructive"
              onClick={() => setDeleteOpen(true)}
            >
              削除
            </Button>
          )}
        </div>
      </div>
      <PoolAccountList poolId={pool.id} accounts={accounts} onChange={onChange} />
      <Dialog.Root role="alertdialog" open={deleteOpen} onOpenChange={setDeleteOpen}>
        <Dialog>
          <Dialog.Title>プールを削除しますか？</Dialog.Title>
          <Dialog.Description className="mt-2">「{pool.name}」を削除します。この操作は取り消せません。</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setDeleteOpen(false)}>キャンセル</Button>
            <Button type="button" variant="destructive" onClick={onDelete}>削除</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </LayerCard>
  )
}

function PoolAccountList({
  poolId,
  accounts,
  onChange,
}: {
  poolId: string
  accounts: LineAccount[]
  onChange: () => void
}) {
  const [members, setMembers] = useState<PoolAccount[]>([])
  const [removeTarget, setRemoveTarget] = useState<string | null>(null)

  const reload = async () => {
    const res = await api.pools.accounts.list(poolId)
    if (res.success) setMembers(res.data)
  }

  useEffect(() => {
    reload()
  }, [poolId])

  const memberAccountIds = new Set(members.map((m) => m.lineAccountId))
  const candidates = accounts.filter((a) => !memberAccountIds.has(a.id))

  const onAdd = async (lineAccountId: string) => {
    const res = await api.pools.accounts.add(poolId, lineAccountId)
    if (res.success) {
      await reload()
      onChange()
    }
  }

  const onRemove = async () => {
    if (!removeTarget) return
    const res = await api.pools.accounts.remove(poolId, removeTarget)
    if (res.success) {
      setRemoveTarget(null)
      await reload()
      onChange()
    }
  }

  return (
    <div className="mt-2">
      <ul className="text-sm space-y-1">
        {members.map((m) => {
          const acc = accounts.find((a) => a.id === m.lineAccountId)
          return (
            <li
              key={m.id}
              className="flex items-center justify-between bg-gray-50 px-2 py-1 rounded"
            >
              <span>{acc?.name ?? m.lineAccountId}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                onClick={() => setRemoveTarget(m.id)}
              >
                外す
              </Button>
            </li>
          )
        })}
        {members.length === 0 && (
          <li className="text-xs text-gray-400">所属アカウントなし</li>
        )}
      </ul>
      {candidates.length > 0 && (
        <div className="mt-2">
          <Select
            size="sm"
            value=""
            onValueChange={(value) => { if (value) void onAdd(value) }}
            placeholder="＋ アカウントを追加"
            items={Object.fromEntries(candidates.map((account) => [account.id, account.name]))}
          />
        </div>
      )}
      <Dialog.Root role="alertdialog" open={removeTarget !== null} onOpenChange={(open) => { if (!open) setRemoveTarget(null) }}>
        <Dialog>
          <Dialog.Title>アカウントを外しますか？</Dialog.Title>
          <Dialog.Description className="mt-2">このアカウントをプールの配信先から外します。</Dialog.Description>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setRemoveTarget(null)}>キャンセル</Button>
            <Button type="button" variant="destructive" onClick={onRemove}>外す</Button>
          </div>
        </Dialog>
      </Dialog.Root>
    </div>
  )
}

function CreatePoolModal({
  accounts,
  onClose,
  onCreated,
}: {
  accounts: LineAccount[]
  onClose: () => void
  onCreated: () => void
}) {
  const [slug, setSlug] = useState('')
  const [name, setName] = useState('')
  const [activeAccountId, setActiveAccountId] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async () => {
    if (!slug || !name || !activeAccountId) return
    setSubmitting(true)
    setError('')
    const res = await api.pools.create({ slug, name, activeAccountId })
    setSubmitting(false)
    if (res.success) onCreated()
    else setError(res.error ?? '作成に失敗しました')
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && !submitting) onClose() }}>
      <Dialog className="w-full max-w-md">
        <Dialog.Title>新規プール</Dialog.Title>
        <Dialog.Description className="mt-1">分散先と最初の所属アカウントを設定します。</Dialog.Description>
        <div className="mt-4 space-y-3">
        {error && (
          <Banner size="sm" variant="error" title="作成できませんでした" description={error} />
        )}
        <Input
          label="スラッグ"
          value={slug}
          onChange={(e) => setSlug(e.target.value)}
          placeholder="slug (例: brand-a)"
          className="font-mono"
        />
        <Input
          label="表示名"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="表示名 (例: ブランドA)"
        />
        <Select
          label="最初の所属アカウント"
          value={activeAccountId}
          onValueChange={(value) => setActiveAccountId(value ?? '')}
          placeholder="最初の所属アカウントを選択"
          items={Object.fromEntries(accounts.map((account) => [account.id, account.name]))}
        />
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>キャンセル</Button>
          <Button
            type="button"
            variant="primary"
            onClick={onSubmit}
            loading={submitting}
            disabled={submitting || !slug || !name || !activeAccountId}
          >
            作成
          </Button>
        </div>
      </Dialog>
    </Dialog.Root>
  )
}
