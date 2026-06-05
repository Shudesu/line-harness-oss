'use client'

/**
 * トラックリンクの新規発行 / 編集モーダル
 *
 * skipLiff (認証スキップ) はデフォルト ON。これが L-TRACK 互換の主要モード。
 * mediaName / afAmount / afConfirmType は広告計測との突合用。
 */

import { useState } from 'react'
import { api } from '@/lib/api'

interface TrackedLinkLike {
  id: string
  name: string
  originalUrl: string
  isActive: boolean
  skipLiff: boolean
  mediaName: string | null
  afAmount: number | null
  afConfirmType: 'immediate' | '1h' | '3h' | '24h'
  lineAccountId: string | null
}

interface Props {
  initial: TrackedLinkLike | null
  selectedAccountId: string | null
  onClose: () => void
  onSaved: () => void
}

export default function EditTrackedLinkModal({
  initial,
  selectedAccountId,
  onClose,
  onSaved,
}: Props) {
  const isNew = initial === null
  const [name, setName] = useState(initial?.name ?? '')
  const [originalUrl, setOriginalUrl] = useState(initial?.originalUrl ?? '')
  const [skipLiff, setSkipLiff] = useState(initial?.skipLiff ?? true)
  const [mediaName, setMediaName] = useState(initial?.mediaName ?? '')
  const [afAmount, setAfAmount] = useState<string>(
    initial?.afAmount != null ? String(initial.afAmount) : '',
  )
  const [afConfirmType, setAfConfirmType] = useState<
    'immediate' | '1h' | '3h' | '24h'
  >(initial?.afConfirmType ?? 'immediate')
  const [isActive, setIsActive] = useState(initial?.isActive ?? true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const onSubmit = async () => {
    if (!name.trim() || (isNew && !originalUrl.trim())) {
      setError('名前と遷移先URLは必須です')
      return
    }
    const common = {
      skipLiff,
      mediaName: mediaName.trim() || null,
      afAmount: afAmount.trim() ? Number(afAmount) : null,
      afConfirmType,
    } as const

    setSaving(true)
    setError('')
    try {
      const r = isNew
        ? await api.trackedLinks.create({
            name: name.trim(),
            originalUrl: originalUrl.trim(),
            lineAccountId: selectedAccountId,
            ...common,
          })
        : await api.trackedLinks.update(
            initial!.id,
            {
              name: name.trim(),
              isActive,
              lineAccountId: initial?.lineAccountId ?? null,
              ...common,
            },
            { lineAccountId: selectedAccountId },
          )
      if (r.success) {
        onSaved()
      } else {
        setError((r as { error?: string }).error ?? '保存に失敗しました')
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '保存に失敗しました')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="mt-12 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-gray-900">
            {isNew ? 'トラックリンクを新規発行' : 'トラックリンクを編集'}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600"
          >
            ×
          </button>
        </div>

        {error && (
          <div className="mb-3 rounded border border-red-300 bg-red-50 p-2 text-sm text-red-800">
            {error}
          </div>
        )}

        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">
              名前 <span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
              placeholder="例: 6月特集_Meta_リール_01"
            />
          </div>

          {isNew && (
            <div>
              <label className="block text-sm font-medium text-gray-700">
                遷移先URL <span className="text-red-500">*</span>
              </label>
              <input
                type="url"
                value={originalUrl}
                onChange={(e) => setOriginalUrl(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="https://lin.ee/xxxxxxx"
              />
              <p className="mt-1 text-xs text-gray-500">
                LINE 友だち追加URL (https://line.me/R/ti/p/@xxx)、または 任意のLP URL
              </p>
            </div>
          )}

          <div className="rounded border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-start gap-2">
              <input
                type="checkbox"
                checked={skipLiff}
                onChange={(e) => setSkipLiff(e.target.checked)}
                className="mt-1"
              />
              <div className="flex-1">
                <div className="text-sm font-medium text-amber-900">
                  認証画面スキップモード（L-TRACK 互換）
                </div>
                <div className="mt-0.5 text-xs text-amber-800">
                  クリックから直接 LINE 友だち追加へ。LIFF を経由しないため認証画面が
                  出ない。代わりに friend 紐付けは時間窓のベストマッチで推定（精度に
                  限界あり）。OFF にすると LIFF 経由の高精度モードになる。
                </div>
              </div>
            </label>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">媒体名</label>
              <input
                type="text"
                value={mediaName}
                onChange={(e) => setMediaName(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="Meta / Google / IG / YouTube"
              />
              <p className="mt-1 text-xs text-gray-500">
                CSVエクスポートや集計時の媒体軸
              </p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700">AF金額（円）</label>
              <input
                type="number"
                value={afAmount}
                onChange={(e) => setAfAmount(e.target.value)}
                className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                placeholder="例: 5000"
                min={0}
                step={100}
              />
              <p className="mt-1 text-xs text-gray-500">
                広告CV報告時の固定金額（任意）
              </p>
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700">
              AF確定タイミング
            </label>
            <select
              value={afConfirmType}
              onChange={(e) =>
                setAfConfirmType(e.target.value as 'immediate' | '1h' | '3h' | '24h')
              }
              className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm shadow-sm focus:border-blue-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
            >
              <option value="immediate">即時（友だち追加と同時に CAPI 送信）</option>
              <option value="1h">1時間後（blocked チェック後）</option>
              <option value="3h">3時間後（blocked チェック後）</option>
              <option value="24h">24時間後（blocked チェック後）</option>
            </select>
            <p className="mt-1 text-xs text-gray-500">
              遅延を選ぶと、ブロック離脱した友だちを除外できる
            </p>
          </div>

          {!isNew && (
            <div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={isActive}
                  onChange={(e) => setIsActive(e.target.checked)}
                />
                有効
              </label>
              <p className="mt-1 text-xs text-gray-500">
                無効にすると新規クリックを受け付けず、URLは 404 を返す
              </p>
            </div>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={saving}
            className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          >
            キャンセル
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={saving}
            className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {saving ? '保存中…' : isNew ? '発行する' : '保存'}
          </button>
        </div>
      </div>
    </div>
  )
}
