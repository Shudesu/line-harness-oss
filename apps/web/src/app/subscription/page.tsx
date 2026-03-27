'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '0',
    unit: '円/月',
    description: '個人・試験利用に最適',
    features: [
      'フレンド数 100人まで',
      'ブロードキャスト 5回/月',
      'シナリオ 2本まで',
      'タグ 10個まで',
      'API アクセス',
      'コミュニティサポート',
      '友だち追加で自動ステップ配信体験',
    ],
    stripePriceId: null,
  },
  {
    id: 'pro',
    name: 'Proプラン',
    price: '2,980',
    unit: '円/月',
    description: 'みやびラインを本格活用したい方に',
    features: [
      'フレンド数 10,000人まで',
      'ブロードキャスト 無制限',
      'シナリオ 無制限',
      'タグ 無制限',
      'セグメント配信',
      'Webhook 連携',
      'Claude AI 操作対応',
      'メールサポート',
      'Teachable 連携',
      'PPAL 連携（ベータ）',
    ],
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_PRO_PRICE_ID,
  },
  {
    id: 'business',
    name: 'Businessプラン',
    price: '9,800',
    unit: '円/月',
    description: '本格的なBtoBコミュニティ・法人向け',
    features: [
      'フレンド数 無制限',
      'ブロードキャスト 無制限',
      'シナリオ 無制限',
      'カスタムドメイン LIFF',
      'チームメンバー 10名',
      'SLA 99.9%',
      'Claude AI 操作対応',
      '専任サポート',
      'カスタム連携相談',
    ],
    stripePriceId: process.env.NEXT_PUBLIC_STRIPE_BUSINESS_PRICE_ID,
  },
]

interface SubscriptionData {
  plan: 'free' | 'pro' | 'business'
  status: string
  cancelAtPeriodEnd: boolean
  currentPeriodEnd: string | null
}

export default function SubscriptionPage() {
  const [sub, setSub] = useState<SubscriptionData | null>(null)
  const [loading, setLoading] = useState(true)
  const [userId] = useState<string | null>(
    typeof window !== 'undefined' ? localStorage.getItem('miyabi_user_id') : null,
  )

  useEffect(() => {
    if (!userId) {
      setLoading(false)
      return
    }
    const apiBase = process.env.NEXT_PUBLIC_API_BASE ?? ''
    fetch(`${apiBase}/api/subscriptions/${userId}`, {
      headers: { 'x-api-key': localStorage.getItem('miyabi_api_key') ?? '' },
    })
      .then((r) => r.json())
      .then((d: { success: boolean; data: SubscriptionData }) => {
        if (d.success) setSub(d.data)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [userId])

  const currentPlan = sub?.plan ?? 'free'
  const isActive = !sub || sub.status === 'active' || sub.status === 'trialing'

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <div className="text-gray-400">読み込み中...</div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50 py-12 px-4">
      <div className="max-w-5xl mx-auto">
        <div className="mb-8">
          <Link href="/" className="text-sm text-gray-500 hover:text-green-600">
            ← ダッシュボードに戻る
          </Link>
          <h1 className="text-3xl font-bold mt-4 mb-2">みやびライン プラン管理</h1>
          <p className="text-gray-500">現在のプランと利用状況を確認できます</p>
        </div>

        {/* 現在のプラン */}
        <div className="bg-white rounded-2xl border border-gray-200 p-6 mb-10">
          <h2 className="text-lg font-semibold mb-4">現在のプラン</h2>
          <div className="flex flex-col sm:flex-row items-start sm:items-center gap-4">
            <div>
              <span className="inline-block bg-green-100 text-green-800 text-sm font-bold px-3 py-1 rounded-full capitalize">
                {currentPlan.toUpperCase()}
              </span>
              {sub?.cancelAtPeriodEnd && (
                <span className="ml-2 inline-block bg-yellow-100 text-yellow-800 text-xs font-medium px-2 py-0.5 rounded-full">
                  期間終了時にキャンセル
                </span>
              )}
            </div>
            <div className="text-sm text-gray-500">
              ステータス:{' '}
              <span
                className={`font-medium ${
                  isActive ? 'text-green-600' : 'text-red-500'
                }`}
              >
                {sub?.status ?? 'active'}
              </span>
              {sub?.currentPeriodEnd && (
                <span className="ml-4">
                  次回更新: {new Date(sub.currentPeriodEnd).toLocaleDateString('ja-JP')}
                </span>
              )}
            </div>
          </div>
          {/* Stripe portal link */}
          <div className="mt-4">
            <a
              href="/api/stripe/portal"
              className="inline-flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition"
            >
              プランを変更・解約
            </a>
            <p className="text-xs text-gray-400 mt-1">Stripe カスタマーポータルで管理・解約できます。ご不明な点は support@ambitiousai.co.jp までお問い合わせください。</p>
          </div>
        </div>

        {/* プラン選択 */}
        <h2 className="text-xl font-bold mb-6">プランを変更する</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          {PLANS.map((plan) => {
            const isCurrent = plan.id === currentPlan
            return (
              <div
                key={plan.id}
                className={`relative rounded-2xl p-6 border-2 flex flex-col ${
                  isCurrent
                    ? 'border-green-500 shadow-lg shadow-green-100'
                    : 'border-gray-200 bg-white'
                }`}
              >
                {isCurrent && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-3 py-0.5 rounded-full">
                    現在のプラン
                  </div>
                )}

                <div className="mb-4">
                  <div className="text-lg font-bold mb-1">{plan.name}</div>
                  <div className="text-3xl font-bold">
                    ¥{plan.price}
                    <span className="text-sm font-normal text-gray-500">/{plan.unit}</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{plan.description}</div>
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-green-500 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>

                {isCurrent ? (
                  <button
                    disabled
                    className="w-full text-center py-2.5 rounded-xl font-bold bg-gray-100 text-gray-400 cursor-not-allowed text-sm"
                  >
                    現在のプラン
                  </button>
                ) : plan.id === 'free' ? (
                  <button className="w-full text-center py-2.5 rounded-xl font-bold border-2 border-gray-300 hover:border-gray-500 transition text-sm">
                    ダウングレード
                  </button>
                ) : (
                  <a
                    href={`/api/stripe/checkout?priceId=${plan.stripePriceId ?? ''}&userId=${userId ?? ''}`}
                    className="w-full text-center py-2.5 rounded-xl font-bold bg-green-600 text-white hover:bg-green-700 transition text-sm block"
                  >
                    {currentPlan === 'free'
                      ? `${plan.name} にアップグレード →`
                      : `${plan.name} に変更する →`}
                  </a>
                )}
              </div>
            )
          })}
        </div>

        <p className="text-center text-sm text-gray-400 mt-8">
          お支払いは Stripe によって安全に処理されます。いつでもキャンセル可能です。
          <br />
          ご不明な点は{' '}
          <a href="mailto:support@miyabi-line.com" className="text-green-600 hover:underline">
            support@miyabi-line.com
          </a>{' '}
          までお問い合わせください。
        </p>
      </div>
    </div>
  )
}
