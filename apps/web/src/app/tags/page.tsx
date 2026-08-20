'use client'

import { useState, useEffect, useCallback } from 'react'
import type { Tag } from '@line-crm/shared'
import { api, ApiError } from '@/lib/api'
import Header from '@/components/layout/header'
import TagBadge from '@/components/friends/tag-badge'

const PRESET_COLORS = [
  '#3B82F6', // blue (server default)
  '#10B981', // green
  '#F59E0B', // amber
  '#EF4444', // red
  '#8B5CF6', // purple
  '#EC4899', // pink
  '#06B6D4', // cyan
  '#6B7280', // gray
]

function TagMileageEditor({ tag, onSaved }: { tag: Tag; onSaved: () => void }) {
  const [reward, setReward] = useState(String(tag.mileageReward ?? 0))
  const [referralReward, setReferralReward] = useState(String(tag.referralMileageReward ?? 0))
  const [multiplier, setMultiplier] = useState(
    tag.mileageMultiplierBps == null ? '' : String(tag.mileageMultiplierBps / 10000),
  )
  const [priority, setPriority] = useState(String(tag.mileageMultiplierPriority ?? 0))
  const [saving, setSaving] = useState(false)

  const save = async () => {
    const rewardMiles = Number(reward)
    const referralRewardMiles = Number(referralReward)
    const multiplierBps = multiplier.trim() === '' ? null : Math.round(Number(multiplier) * 10000)
    const multiplierPriority = Number(priority)
    if (!Number.isInteger(rewardMiles) || rewardMiles < 0) return
    if (!Number.isInteger(referralRewardMiles) || referralRewardMiles < 0) return
    if (multiplierBps !== null && (!Number.isInteger(multiplierBps) || multiplierBps < 1000 || multiplierBps > 100000)) return
    if (!Number.isInteger(multiplierPriority) || multiplierPriority < 0) return
    setSaving(true)
    try {
      await api.tags.updateMileage(tag.id, {
        rewardMiles,
        referralRewardMiles,
        multiplierBps,
        multiplierPriority,
      })
      onSaved()
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <td className="px-3 py-3">
        <input
          aria-label={`${tag.name}の獲得マイル`}
          type="number"
          min={0}
          step={1}
          value={reward}
          onChange={(e) => setReward(e.target.value)}
          className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
        />
      </td>
      <td className="px-3 py-3">
        <input
          aria-label={`${tag.name}の紹介者マイル`}
          type="number"
          min={0}
          step={1}
          value={referralReward}
          onChange={(e) => setReferralReward(e.target.value)}
          className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
        />
      </td>
      <td className="px-3 py-3">
        <div className="flex items-center gap-1">
          <input
            aria-label={`${tag.name}の還元倍率`}
            type="number"
            min={0.1}
            max={10}
            step={0.1}
            placeholder="なし"
            value={multiplier}
            onChange={(e) => setMultiplier(e.target.value)}
            className="w-20 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
          />
          <span className="text-xs text-gray-400">倍</span>
        </div>
      </td>
      <td className="px-3 py-3">
        <input
          aria-label={`${tag.name}の倍率優先度`}
          type="number"
          min={0}
          max={1000}
          value={priority}
          onChange={(e) => setPriority(e.target.value)}
          className="w-16 px-2 py-1.5 text-sm border border-gray-300 rounded-md tabular-nums"
        />
      </td>
      <td className="px-3 py-3 text-right whitespace-nowrap">
        <button
          onClick={save}
          disabled={saving}
          className="px-2.5 py-1 text-xs font-medium text-green-700 hover:bg-green-50 rounded-md disabled:opacity-40"
        >
          {saving ? '保存中' : 'マイル保存'}
        </button>
      </td>
    </>
  )
}

export default function TagsPage() {
  const [items, setItems] = useState<Tag[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newColor, setNewColor] = useState(PRESET_COLORS[0])
  const [saving, setSaving] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const res = await api.tags.list({ withCounts: true })
      if (res.success) setItems(res.data)
    } catch {
      setError('読み込みに失敗しました')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (saving) return
    const name = newName.trim()
    if (!name) return
    if (items.some((t) => t.name === name)) {
      setError(`タグ「${name}」は既に存在します`)
      return
    }
    setSaving(true)
    setError('')
    try {
      await api.tags.create({ name, color: newColor })
      setNewName('')
      setCreating(false)
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(`タグ「${name}」は既に存在します`)
        load()
      } else {
        setError('作成に失敗しました')
      }
    } finally {
      setSaving(false)
    }
  }

  const handleDelete = async (tag: Tag) => {
    const count = tag.friendCount ?? 0
    const message = count > 0
      ? `タグ「${tag.name}」は ${count} 人の友だちに付与されています。\n削除すると全員からこのタグが外れます。よろしいですか？`
      : `タグ「${tag.name}」を削除しますか？`
    if (!confirm(message)) return
    setError('')
    try {
      await api.tags.delete(tag.id)
      load()
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        setError(`タグ「${tag.name}」はアフィリエイトオファー等で使用中のため削除できません`)
      } else {
        setError('削除に失敗しました')
      }
    }
  }

  return (
    <div>
      <Header
        title="タグ管理"
        description="本人のタグ獲得マイル、紹介した友だちがタグを獲得した時の紹介者マイル、今後の行動倍率を設定できます。反映は非同期です。"
        action={
          <button
            onClick={() => { setCreating(!creating); setError('') }}
            className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90"
            style={{ backgroundColor: '#06C755' }}
          >
            + 新規タグ
          </button>
        }
      />

      {error && (
        <div className="mb-4 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700 text-sm">
          {error}
        </div>
      )}

      {creating && (
        <div className="mb-4 p-4 bg-white rounded-lg shadow-sm border border-gray-200">
          <div className="flex flex-wrap items-end gap-4">
            <div className="flex-1 min-w-[200px]">
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">タグ名</label>
              <input
                type="text"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleCreate() }}
                placeholder="例: 見込み客"
                autoFocus
                className="w-full px-3 py-2 text-sm border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-500 mb-1.5">色</label>
              <div className="flex items-center gap-1.5">
                {PRESET_COLORS.map((c) => (
                  <button
                    key={c}
                    onClick={() => setNewColor(c)}
                    className={`w-7 h-7 rounded-full transition-transform ${newColor === c ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-110'}`}
                    style={{ backgroundColor: c }}
                    aria-label={`色 ${c}`}
                  />
                ))}
                <input
                  type="color"
                  value={newColor}
                  onChange={(e) => setNewColor(e.target.value)}
                  className="w-7 h-7 p-0 border border-gray-300 rounded cursor-pointer"
                  title="カスタム色"
                />
              </div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleCreate}
                disabled={saving || !newName.trim()}
                className="px-4 py-2 text-sm font-medium text-white rounded-lg transition-opacity hover:opacity-90 disabled:opacity-40"
                style={{ backgroundColor: '#06C755' }}
              >
                {saving ? '作成中...' : '作成'}
              </button>
              <button
                onClick={() => { setCreating(false); setNewName('') }}
                className="px-4 py-2 text-sm font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded-lg"
              >
                キャンセル
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-lg shadow-sm border border-gray-200 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">タグ</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">友だち数</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-gray-500 uppercase">作成日</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">獲得マイル</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">紹介者マイル</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">行動倍率</th>
                <th className="px-3 py-3 text-left text-xs font-semibold text-gray-500 uppercase">優先度</th>
                <th className="px-3 py-3" />
                <th className="px-4 py-3" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {loading ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">読み込み中...</td></tr>
              ) : items.length === 0 ? (
                <tr><td colSpan={9} className="px-4 py-8 text-center text-gray-400 text-sm">タグがありません</td></tr>
              ) : (
                items.map((t) => (
                  <tr key={t.id} className="hover:bg-gray-50">
                    <td className="px-4 py-3">
                      <TagBadge tag={t} />
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-700 tabular-nums">
                      {t.friendCount ?? 0}
                      <span className="text-xs text-gray-400 ml-0.5">人</span>
                    </td>
                    <td className="px-4 py-3 text-xs text-gray-500">
                      {t.createdAt ? new Date(t.createdAt).toLocaleDateString('ja-JP') : ''}
                    </td>
                    <TagMileageEditor tag={t} onSaved={load} />
                    <td className="px-4 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => handleDelete(t)}
                        className="px-2.5 py-1 text-xs font-medium text-red-500 hover:bg-red-50 rounded-md"
                      >
                        削除
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
