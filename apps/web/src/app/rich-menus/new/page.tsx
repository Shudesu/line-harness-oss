'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'
import { api } from '@/lib/api'
import { TEMPLATES, templateToAreas } from '@/lib/rich-menu-templates'
import { Banner } from '@cloudflare/kumo/components/banner'
import { Button } from '@cloudflare/kumo/components/button'
import { Checkbox } from '@cloudflare/kumo/components/checkbox'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { Radio } from '@cloudflare/kumo/components/radio'

export default function NewRichMenuPage() {
  const router = useRouter()
  const { selectedAccount } = useAccount()
  const [name, setName] = useState('')
  const [chatBarText, setChatBarText] = useState('メニュー')
  const [selected, setSelected] = useState(true)
  const [templateKey, setTemplateKey] = useState(TEMPLATES[0].key)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const tmpl = TEMPLATES.find((t) => t.key === templateKey) ?? TEMPLATES[0]

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!selectedAccount) {
      setError('アカウントを選択してください')
      return
    }
    if (!name.trim()) {
      setError('名前を入力してください')
      return
    }
    setSubmitting(true)
    setError(null)
    try {
      const res = await api.richMenuGroups.create({
        accountId: selectedAccount.id,
        name: name.trim(),
        chatBarText: chatBarText.trim(),
        size: tmpl.size,
        selected,
        pages: [
          { name: 'ページ 1', orderIndex: 0, areas: templateToAreas(tmpl) },
        ],
      })
      if (!res.success) throw new Error(res.error ?? '作成失敗')
      router.push(`/rich-menus/edit?id=${res.data.id}`)
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
      setSubmitting(false)
    }
  }

  return (
    <main className="p-6 max-w-2xl mx-auto">
      <Header
        title="新規リッチメニュー"
        description="作成後の編集画面で画像 upload や areas 編集ができます。"
      />
      <Link
        href="/rich-menus"
        className="text-sm text-gray-500 hover:underline mb-4 inline-block"
      >
        ← 一覧に戻る
      </Link>

      <LayerCard><form onSubmit={handleSubmit} className="space-y-5 p-6">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            名前 <span className="text-gray-400">(管理用)</span>
          </label>
          <Input
            label="名前（管理用）"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            placeholder="例: メインメニュー"
          />
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">
            トーク画面下の文言 <span className="text-gray-400">(14 文字以内)</span>
          </label>
          <Input
            label="トーク画面下の文言（14文字以内）"
            value={chatBarText}
            onChange={(e) => setChatBarText(e.target.value)}
            maxLength={14}
            required
          />
          <p className="mt-1 text-xs text-gray-500">
            ユーザーがトーク画面でメニューを開く前に表示される文言。
          </p>
        </div>

        <div>
          <Checkbox
              label="トークを開いたときにメニューを表示する"
              checked={selected}
              onCheckedChange={setSelected}
            />
              <span className="block mt-1 ml-7 text-xs text-gray-500">
                ON にすると、友だちがトーク画面を開いた直後からリッチメニューを展開します。
              </span>
        </div>

        <div>
          <label className="block text-sm font-medium text-gray-700 mb-2">
            初期テンプレート
          </label>
          <Radio.Group value={templateKey} onValueChange={(value) => setTemplateKey(value)} className="grid grid-cols-1 gap-2">
            {TEMPLATES.map((t) => (
              <Radio.Item key={t.key} value={t.key} label={`${t.label} — ${t.size === 'large' ? '2500×1686' : '2500×843'}`} description={t.description} />
            ))}
          </Radio.Group>
        </div>

        {error && (
          <Banner variant="error" title="作成できませんでした" description={error} />
        )}

        <div className="flex justify-end gap-2 pt-4 border-t border-gray-200">
          <Link
            href="/rich-menus"
            className="px-4 py-2 text-sm font-medium border border-gray-300 rounded-lg hover:bg-gray-50 transition-colors"
          >
            キャンセル
          </Link>
          <Button
            type="submit"
            variant="primary"
            loading={submitting}
            disabled={submitting || !selectedAccount}
          >
            作成して編集へ
          </Button>
        </div>
      </form></LayerCard>
    </main>
  )
}
