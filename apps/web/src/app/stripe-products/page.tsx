'use client'

/**
 * Phase 2-D: Stripe 商品マスタ管理 + 購入者限定アクション (Phase 2-E)
 *
 * 想定運用:
 * 1. Stripe Dashboard で商品を作成 → price_id (price_xxx) を取得
 * 2. このページで「＋ 新規追加」→ price_id を貼り付け
 * 3. 購入後に付けたいタグ・起動シナリオ・送信テンプレを紐付け
 * 4. webhook 経由で購入が来たら自動で実行される
 */

import { useEffect, useState } from 'react'
import { fetchApi } from '@/lib/api'
import Header from '@/components/layout/header'
import { useAccount } from '@/contexts/account-context'

interface StripeProduct {
  id: string
  line_account_id: string | null
  name: string
  description: string | null
  stripe_product_id: string | null
  stripe_price_id: string
  amount: number
  currency: string
  billing_type: 'one_time' | 'subscription'
  recurring_interval: 'day' | 'week' | 'month' | 'year' | null
  on_purchase_tag_id: string | null
  on_purchase_scenario_id: string | null
  on_purchase_message_template_id: string | null
  is_active: number
  created_at: string
}

interface Tag {
  id: string
  name: string
}
interface Scenario {
  id: string
  name: string
}
interface MessageTemplate {
  id: string
  name: string
}

export default function StripeProductsPage() {
  const { selectedAccountId } = useAccount()
  const [items, setItems] = useState<StripeProduct[]>([])
  const [tags, setTags] = useState<Tag[]>([])
  const [scenarios, setScenarios] = useState<Scenario[]>([])
  const [templates, setTemplates] = useState<MessageTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState<StripeProduct | null>(null)

  // フォーム状態
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [stripePriceId, setStripePriceId] = useState('')
  const [stripeProductId, setStripeProductId] = useState('')
  const [amount, setAmount] = useState(0)
  const [currency, setCurrency] = useState('jpy')
  const [billingType, setBillingType] = useState<'one_time' | 'subscription'>('one_time')
  const [recurringInterval, setRecurringInterval] = useState<'day' | 'week' | 'month' | 'year'>('month')
  const [onTagId, setOnTagId] = useState('')
  const [onScenarioId, setOnScenarioId] = useState('')
  const [onTemplateId, setOnTemplateId] = useState('')
  const [saving, setSaving] = useState(false)

  const load = async () => {
    setLoading(true)
    const qs = selectedAccountId ? `?lineAccountId=${encodeURIComponent(selectedAccountId)}` : ''
    const [pr, tr, sr, mr] = await Promise.all([
      fetchApi<{ success: boolean; data: StripeProduct[]; error?: string }>(`/api/stripe-products${qs}`),
      fetchApi<{ success: boolean; data: Tag[] }>('/api/tags'),
      fetchApi<{ success: boolean; data: Scenario[] }>('/api/scenarios'),
      fetchApi<{ success: boolean; data: MessageTemplate[] }>('/api/templates'),
    ])
    if (pr.success) setItems(pr.data)
    else setError(pr.error ?? '取得失敗')
    if (tr.success) setTags(tr.data)
    if (sr.success) setScenarios(sr.data)
    if (mr.success) setTemplates(mr.data)
    setLoading(false)
  }

  useEffect(() => {
    load()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedAccountId])

  const resetForm = () => {
    setEditing(null)
    setName('')
    setDescription('')
    setStripePriceId('')
    setStripeProductId('')
    setAmount(0)
    setCurrency('jpy')
    setBillingType('one_time')
    setRecurringInterval('month')
    setOnTagId('')
    setOnScenarioId('')
    setOnTemplateId('')
  }

  const onOpenNew = () => {
    resetForm()
    setShowForm(true)
  }

  const onOpenEdit = (item: StripeProduct) => {
    setEditing(item)
    setName(item.name)
    setDescription(item.description ?? '')
    setStripePriceId(item.stripe_price_id)
    setStripeProductId(item.stripe_product_id ?? '')
    setAmount(item.amount)
    setCurrency(item.currency)
    setBillingType(item.billing_type)
    setRecurringInterval((item.recurring_interval ?? 'month') as 'day' | 'week' | 'month' | 'year')
    setOnTagId(item.on_purchase_tag_id ?? '')
    setOnScenarioId(item.on_purchase_scenario_id ?? '')
    setOnTemplateId(item.on_purchase_message_template_id ?? '')
    setShowForm(true)
  }

  const onSave = async () => {
    if (!name.trim() || !stripePriceId.trim() || amount < 0) {
      alert('名前 / price_id / amount は必須')
      return
    }
    if (!stripePriceId.startsWith('price_')) {
      alert('price_id は price_ から始まる必要があります')
      return
    }
    setSaving(true)
    const payload = {
      lineAccountId: selectedAccountId ?? null,
      name: name.trim(),
      description: description.trim() || null,
      stripePriceId: stripePriceId.trim(),
      stripeProductId: stripeProductId.trim() || null,
      amount: Math.floor(amount),
      currency,
      billingType,
      recurringInterval: billingType === 'subscription' ? recurringInterval : null,
      onPurchaseTagId: onTagId || null,
      onPurchaseScenarioId: onScenarioId || null,
      onPurchaseMessageTemplateId: onTemplateId || null,
    }
    const r = editing
      ? await fetchApi<{ success: boolean; error?: string }>(`/api/stripe-products/${editing.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload),
        })
      : await fetchApi<{ success: boolean; error?: string }>(`/api/stripe-products`, {
          method: 'POST',
          body: JSON.stringify(payload),
        })
    setSaving(false)
    if (r.success) {
      setShowForm(false)
      resetForm()
      load()
    } else {
      alert(r.error ?? '保存失敗')
    }
  }

  const onToggle = async (item: StripeProduct) => {
    const r = await fetchApi<{ success: boolean }>(`/api/stripe-products/${item.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ isActive: !item.is_active }),
    })
    if (r.success) load()
  }

  const onDelete = async (item: StripeProduct) => {
    if (!confirm(`「${item.name}」を削除しますか?\n(過去の購入履歴は残ります)`)) return
    const r = await fetchApi<{ success: boolean; error?: string }>(`/api/stripe-products/${item.id}`, {
      method: 'DELETE',
    })
    if (r.success) load()
    else alert(r.error ?? '削除失敗')
  }

  const formatPrice = (amount: number, currency: string): string => {
    if (currency === 'jpy') return `¥${amount.toLocaleString()}`
    return `${amount / 100} ${currency.toUpperCase()}`
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
        <Header
          title="Stripe 商品販売"
          description="Stripe で販売する商品マスタ + 購入後の自動アクション"
          action={
            <button
              type="button"
              onClick={onOpenNew}
              className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
            >
              ＋ 新規追加
            </button>
          }
        />

        <div className="mb-4 rounded border border-blue-200 bg-blue-50 p-3 text-sm text-blue-900">
          <p className="font-medium mb-1">📌 使い方</p>
          <ol className="list-decimal pl-5 space-y-1">
            <li>Stripe Dashboard で商品 (Product) を作成 → Price を作る → <code>price_xxx</code> ID をコピー</li>
            <li>このページで「＋ 新規追加」→ name / price_id / amount を入力</li>
            <li>購入後の自動アクション (タグ付与・シナリオ起動・テンプレ送信) を設定</li>
            <li>Stripe webhook を <code>/api/integrations/stripe/webhook</code> に設定し、metadata に <code>line_friend_id</code> と <code>price_id</code> を入れる</li>
          </ol>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{error}</div>
        )}

        {loading ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">読み込み中…</div>
        ) : items.length === 0 ? (
          <div className="rounded border bg-white p-6 text-sm text-gray-500">
            商品はまだありません。「＋ 新規追加」で登録してください。
          </div>
        ) : (
          <div className="overflow-x-auto rounded-lg border bg-white">
            <table className="min-w-full divide-y divide-gray-200 text-sm">
              <thead className="bg-gray-50">
                <tr>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">商品名</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">価格</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">タイプ</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">購入後アクション</th>
                  <th className="px-4 py-2 text-center text-xs font-medium text-gray-500">状態</th>
                  <th className="px-4 py-2 text-left text-xs font-medium text-gray-500">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-200">
                {items.map((it) => {
                  const tagName = tags.find((t) => t.id === it.on_purchase_tag_id)?.name
                  const scenarioName = scenarios.find((s) => s.id === it.on_purchase_scenario_id)?.name
                  const templateName = templates.find((t) => t.id === it.on_purchase_message_template_id)?.name
                  return (
                    <tr key={it.id}>
                      <td className="px-4 py-3">
                        <div className="font-medium">{it.name}</div>
                        {it.description && <div className="text-xs text-gray-500">{it.description}</div>}
                        <div className="text-xs font-mono text-gray-400">{it.stripe_price_id}</div>
                      </td>
                      <td className="px-4 py-3 font-mono">{formatPrice(it.amount, it.currency)}</td>
                      <td className="px-4 py-3 text-xs">
                        {it.billing_type === 'subscription'
                          ? `定期 (${it.recurring_interval})`
                          : '単発'}
                      </td>
                      <td className="px-4 py-3 text-xs">
                        <ul className="space-y-0.5">
                          {tagName && <li>🏷 タグ: {tagName}</li>}
                          {scenarioName && <li>📋 シナリオ: {scenarioName}</li>}
                          {templateName && <li>💬 テンプレ: {templateName}</li>}
                          {!tagName && !scenarioName && !templateName && (
                            <li className="text-gray-400">なし</li>
                          )}
                        </ul>
                      </td>
                      <td className="px-4 py-3 text-center">
                        {it.is_active ? (
                          <span className="inline-flex items-center rounded bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-800">
                            有効
                          </span>
                        ) : (
                          <span className="inline-flex items-center rounded bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600">
                            無効
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2 text-xs">
                          <button
                            type="button"
                            onClick={() => onOpenEdit(it)}
                            className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                          >
                            編集
                          </button>
                          <button
                            type="button"
                            onClick={() => onToggle(it)}
                            className="rounded border border-gray-300 px-2 py-1 hover:bg-gray-50"
                          >
                            {it.is_active ? '無効化' : '有効化'}
                          </button>
                          <button
                            type="button"
                            onClick={() => onDelete(it)}
                            className="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                          >
                            削除
                          </button>
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {showForm && (
          <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
            <div className="mt-8 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-lg font-semibold">{editing ? '商品を編集' : '商品を追加'}</h2>
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    resetForm()
                  }}
                  className="text-gray-400 hover:text-gray-600"
                >
                  ×
                </button>
              </div>
              <div className="space-y-3">
                <div>
                  <label className="block text-sm font-medium text-gray-700">商品名</label>
                  <input
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    placeholder="例: hyhome 個別相談 90分"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">説明</label>
                  <textarea
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={2}
                    className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                  />
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Stripe Price ID</label>
                    <input
                      type="text"
                      value={stripePriceId}
                      onChange={(e) => setStripePriceId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                      placeholder="price_xxxxxxxxxxxx"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Stripe Product ID (任意)</label>
                    <input
                      type="text"
                      value={stripeProductId}
                      onChange={(e) => setStripeProductId(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm font-mono"
                      placeholder="prod_xxxxxxxx"
                    />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">価格</label>
                    <input
                      type="number"
                      min={0}
                      value={amount}
                      onChange={(e) => setAmount(Number(e.target.value))}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">通貨</label>
                    <select
                      value={currency}
                      onChange={(e) => setCurrency(e.target.value)}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="jpy">JPY (円)</option>
                      <option value="usd">USD</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">課金タイプ</label>
                    <select
                      value={billingType}
                      onChange={(e) => setBillingType(e.target.value as 'one_time' | 'subscription')}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="one_time">単発</option>
                      <option value="subscription">継続課金</option>
                    </select>
                  </div>
                </div>
                {billingType === 'subscription' && (
                  <div>
                    <label className="block text-sm font-medium text-gray-700">継続周期</label>
                    <select
                      value={recurringInterval}
                      onChange={(e) => setRecurringInterval(e.target.value as 'day' | 'week' | 'month' | 'year')}
                      className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                    >
                      <option value="day">日次</option>
                      <option value="week">週次</option>
                      <option value="month">月次</option>
                      <option value="year">年次</option>
                    </select>
                  </div>
                )}

                <div className="border-t pt-3">
                  <h3 className="text-sm font-medium text-gray-700 mb-2">購入後アクション (Phase 2-E)</h3>
                  <div className="space-y-2">
                    <div>
                      <label className="block text-xs text-gray-500">付与するタグ</label>
                      <select
                        value={onTagId}
                        onChange={(e) => setOnTagId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">(なし)</option>
                        {tags.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">起動するシナリオ</label>
                      <select
                        value={onScenarioId}
                        onChange={(e) => setOnScenarioId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">(なし)</option>
                        {scenarios.map((s) => (
                          <option key={s.id} value={s.id}>{s.name}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-xs text-gray-500">送信するテンプレ</label>
                      <select
                        value={onTemplateId}
                        onChange={(e) => setOnTemplateId(e.target.value)}
                        className="mt-1 w-full rounded-md border border-gray-300 px-3 py-2 text-sm"
                      >
                        <option value="">(なし)</option>
                        {templates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-6 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setShowForm(false)
                    resetForm()
                  }}
                  disabled={saving}
                  className="rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
                >
                  キャンセル
                </button>
                <button
                  type="button"
                  onClick={onSave}
                  disabled={saving}
                  className="rounded-md bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
                >
                  {saving ? '保存中…' : editing ? '更新' : '追加'}
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
