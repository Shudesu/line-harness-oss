'use client'

import { useEffect, useState } from 'react'
import { api } from '@/lib/api'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Dialog } from '@cloudflare/kumo/components/dialog'
import { Loader } from '@cloudflare/kumo/components/loader'
import { Radio } from '@cloudflare/kumo/components/radio'
import { Select } from '@cloudflare/kumo/components/select'

type Tag = { id: string; name: string; color: string }

type Props = {
  groupId: string
  groupName: string
  onClose: () => void
}

type Mode =
  | { kind: 'tag'; tagId: string }
  | { kind: 'all-followers' }
  | { kind: 'set-default' }

export function ApplyToTagModal({ groupId, groupName, onClose }: Props) {
  const [tags, setTags] = useState<Tag[]>([])
  const [mode, setMode] = useState<Mode>({ kind: 'all-followers' })
  const [phase, setPhase] = useState<'config' | 'running' | 'done' | 'error'>(
    'config',
  )
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<{
    chunks: number
    total: number
    message?: string
    mode?: string
  } | null>(null)
  const [confirmDefault, setConfirmDefault] = useState(false)

  useEffect(() => {
    api.tags
      .list()
      .then((r) => {
        if (r.success) setTags(r.data ?? [])
      })
      .catch(() => {
        // タグ取得失敗 = 一覧空のまま
      })
  }, [])

  async function apply(confirmed = false) {
    // 「全員のデフォルト」は影響範囲が大きいので強い確認。
    if (mode.kind === 'set-default' && !confirmed) {
      setConfirmDefault(true)
      return
    }
    setConfirmDefault(false)
    setPhase('running')
    setError(null)
    try {
      const params =
        mode.kind === 'tag'
          ? { mode: 'bulk-link' as const, tagId: mode.tagId }
          : mode.kind === 'all-followers'
            ? { mode: 'bulk-link' as const, tagId: null }
            : { mode: 'set-default' as const }
      const res = await api.richMenuGroups.applyToTag(groupId, params)
      if (!res.success) throw new Error(res.error ?? '適用失敗')
      setResult(res.data)
      setPhase('done')
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setPhase('error')
    }
  }

  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open && phase !== 'running') onClose() }}>
      <Dialog className="w-full max-w-md p-6">
          <Dialog.Title>
            友だちにこのメニューを表示
          </Dialog.Title>
          <p className="text-sm text-gray-500 mb-5 break-all">「{groupName}」</p>

          {phase === 'config' && (
            <>
              <Radio.Group value={mode.kind} onValueChange={(value) => value === 'tag' ? setMode({ kind: 'tag', tagId: tags[0]?.id ?? '' }) : setMode({ kind: value as 'all-followers' | 'set-default' })} className="mb-5 space-y-3">
                <Radio.Item value="all-followers" label="このアカウントの全員に適用" description="現時点で友だち状態の全員に表示します。新規友だちには適用されません。" />
                <div className="rounded-lg border border-kumo-line p-3"><Radio.Item value="tag" label="タグで絞り込んで適用" description="指定したタグを持つ友だちだけに表示します。" disabled={tags.length === 0} /><div className="ml-7">
                  {mode.kind === 'tag' && (
                    <Select
                      label="対象タグ"
                      value={mode.tagId}
                      onValueChange={(value) => setMode({ kind: 'tag', tagId: value ?? '' })}
                      className="mt-2"
                      items={Object.fromEntries(tags.map((tag) => [tag.id, tag.name]))}
                    />
                  )}
                </div></div>
                <Radio.Item value="set-default" label="全員のデフォルトに設定する" description="新規友だちも含め全員に自動表示し、他メニューのデフォルト設定は解除します。" />
              </Radio.Group>
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary"
                  onClick={onClose}
                >
                  キャンセル
                </Button>
                <Button type="button" variant="primary"
                  onClick={() => void apply()}
                  disabled={mode.kind === 'tag' && !mode.tagId}
                >
                  実行する
                </Button>
              </div>
            </>
          )}

          {phase === 'running' && (
            <div className="text-center py-10 text-sm text-gray-500"><Loader className="mx-auto mb-2" />
              <div className="mb-2">適用中...</div>
              <div className="text-xs text-gray-400">
                LINE Messaging API に送信しています
              </div>
            </div>
          )}

          {phase === 'done' && result && (
            <>
              <Banner className="mb-4" variant="default" title="完了しました" description={result.message ?? `${result.total} 名の友だちに適用しました (${result.chunks} chunk)`} />
              <div className="flex justify-end">
                <Button type="button" variant="primary"
                  onClick={onClose}
                >
                  閉じる
                </Button>
              </div>
            </>
          )}

          {phase === 'error' && (
            <>
              <Banner className="mb-4" variant="error" title="適用できませんでした" description={error ?? undefined} />
              <div className="flex justify-end gap-2">
                <Button type="button" variant="secondary"
                  onClick={onClose}
                >
                  閉じる
                </Button>
                <Button type="button" variant="primary"
                  onClick={() => setPhase('config')}
                >
                  やり直す
                </Button>
              </div>
            </>
          )}
        <Dialog.Root role="alertdialog" open={confirmDefault} onOpenChange={setConfirmDefault}><Dialog><Dialog.Title>全員のデフォルトに設定しますか？</Dialog.Title><Dialog.Description className="mt-2">新規友だちを含む全員に表示され、同じアカウントの他メニューのデフォルト設定は解除されます。</Dialog.Description><div className="mt-6 flex justify-end gap-2"><Button type="button" variant="secondary" onClick={() => setConfirmDefault(false)}>キャンセル</Button><Button type="button" variant="primary" onClick={() => void apply(true)}>設定する</Button></div></Dialog></Dialog.Root>
      </Dialog>
    </Dialog.Root>
  )
}
