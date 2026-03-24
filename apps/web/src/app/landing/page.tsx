import Link from 'next/link'

// ─── 料金プラン ────────────────────────────────────────
const PLANS = [
  {
    name: 'Free',
    price: '0',
    unit: '円/月',
    description: '個人・試験利用に最適',
    highlight: false,
    features: [
      'フレンド数 100人まで',
      'ブロードキャスト 5回/月',
      'シナリオ 2本まで',
      'タグ 10個まで',
      'API アクセス',
      'コミュニティサポート',
    ],
    cta: '無料で始める',
    ctaHref: '/login',
  },
  {
    name: 'Pro',
    price: '2,980',
    unit: '円/月',
    description: '本格的なLINE運用に',
    highlight: true,
    features: [
      'フレンド数 10,000人まで',
      'ブロードキャスト 無制限',
      'シナリオ 無制限',
      'タグ 無制限',
      'セグメント配信',
      'Webhook 連携',
      'Claude AI 操作対応',
      'メールサポート',
    ],
    cta: '14日間無料で試す',
    ctaHref: '/login',
  },
  {
    name: 'Business',
    price: '9,800',
    unit: '円/月',
    description: '大規模・法人向け',
    highlight: false,
    features: [
      'フレンド数 無制限',
      'ブロードキャスト 無制限',
      'シナリオ 無制限',
      'カスタムドメイン LIFF',
      'チームメンバー 10名',
      'SLA 99.9%',
      'Claude AI 操作対応',
      '専任サポート',
    ],
    cta: 'お問い合わせ',
    ctaHref: '/login',
  },
]

// ─── 機能比較表 ────────────────────────────────────────
const COMPARISON = [
  { feature: '月額費用', lStep: '17,000〜20,000円', miyabi: '0〜9,800円', highlight: true },
  { feature: 'フレンド数上限', lStep: 'プランにより制限', miyabi: 'Freeで100人〜', highlight: false },
  { feature: 'シナリオ数', lStep: '制限あり', miyabi: '無制限（Pro〜）', highlight: false },
  { feature: 'API アクセス', lStep: '❌', miyabi: '✅ 全プラン', highlight: true },
  { feature: 'AI（Claude）操作', lStep: '❌', miyabi: '✅ Pro〜', highlight: true },
  { feature: 'オープンソース', lStep: '❌', miyabi: '✅ MIT', highlight: false },
  { feature: 'セルフホスト可', lStep: '❌', miyabi: '✅ Cloudflare Workers', highlight: false },
]

// ─── クイックスタート手順 ──────────────────────────────
const STEPS = [
  { step: '01', title: 'アカウント作成', desc: '無料プランで今すぐ開始。クレジットカード不要。' },
  { step: '02', title: 'LINE チャネル接続', desc: 'LINE Developers Console で Webhook URL を設定するだけ。5分で完了。' },
  { step: '03', title: '友だち追加・タグ設定', desc: 'フレンドが自動で登録され、タグ・シナリオを設定できます。' },
  { step: '04', title: 'Claude AI で操作', desc: '「全員に〇〇と送って」と話しかけるだけで LINE 配信が完了。' },
]

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-white text-gray-900">

      {/* ─── Hero ─── */}
      <section className="bg-gradient-to-br from-green-50 to-emerald-100 py-20 px-4">
        <div className="max-w-4xl mx-auto text-center">
          <div className="inline-block bg-green-100 text-green-800 text-sm font-semibold px-3 py-1 rounded-full mb-6">
            🆕 L-step の 1/7 の価格で同等機能を実現
          </div>
          <h1 className="text-4xl md:text-6xl font-bold mb-6 leading-tight">
            みやびライン
            <br />
            <span className="text-green-600">AI ネイティブ</span>
            <br />
            LINE CRM
          </h1>
          <p className="text-xl text-gray-600 mb-10 max-w-2xl mx-auto">
            「来週のセミナー参加者に配信して」— 自然言語だけで LINE 公式アカウントを完全自動操作。
            フレンド管理・シナリオ配信・タグ付与を AI が代行します。
          </p>
          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              href="/login"
              className="bg-green-600 text-white px-8 py-4 rounded-xl font-bold text-lg hover:bg-green-700 transition"
            >
              0円で始める →
            </Link>
            <a
              href="https://github.com/ShunsukeHayashi/line-harness-oss"
              target="_blank"
              rel="noopener noreferrer"
              className="border-2 border-gray-300 text-gray-700 px-8 py-4 rounded-xl font-bold text-lg hover:border-green-600 hover:text-green-600 transition"
            >
              GitHub で見る
            </a>
          </div>
          <p className="mt-6 text-sm text-gray-500">
            クレジットカード不要 · MIT ライセンス · Cloudflare Workers で世界中にデプロイ
          </p>
        </div>
      </section>

      {/* ─── 数字で見るメリット ─── */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto grid grid-cols-1 md:grid-cols-3 gap-8 text-center">
          <div className="p-6">
            <div className="text-5xl font-bold text-green-600 mb-2">1/7</div>
            <div className="text-gray-600">L-step 比較の月額費用</div>
          </div>
          <div className="p-6">
            <div className="text-5xl font-bold text-green-600 mb-2">5分</div>
            <div className="text-gray-600">LINE チャネル接続の所要時間</div>
          </div>
          <div className="p-6">
            <div className="text-5xl font-bold text-green-600 mb-2">172+</div>
            <div className="text-gray-600">MCP ツール / Claude AI 対応</div>
          </div>
        </div>
      </section>

      {/* ─── 機能比較表 ─── */}
      <section className="py-16 px-4 bg-gray-50">
        <div className="max-w-3xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">L-step との比較</h2>
          <div className="overflow-x-auto">
            <table className="w-full border-collapse">
              <thead>
                <tr className="bg-gray-800 text-white">
                  <th className="p-4 text-left rounded-tl-lg">機能</th>
                  <th className="p-4 text-center">L-step</th>
                  <th className="p-4 text-center text-green-300 rounded-tr-lg">みやびライン</th>
                </tr>
              </thead>
              <tbody>
                {COMPARISON.map((row, i) => (
                  <tr
                    key={i}
                    className={`border-b ${row.highlight ? 'bg-green-50' : 'bg-white'}`}
                  >
                    <td className="p-4 font-medium">
                      {row.feature}
                      {row.highlight && (
                        <span className="ml-2 text-xs text-green-600 font-bold">★</span>
                      )}
                    </td>
                    <td className="p-4 text-center text-gray-500">{row.lStep}</td>
                    <td className="p-4 text-center text-green-700 font-semibold">{row.miyabi}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </section>

      {/* ─── クイックスタート ─── */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-4xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-12">4ステップで始められる</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            {STEPS.map((s) => (
              <div key={s.step} className="flex gap-4 p-6 border border-gray-200 rounded-2xl">
                <div className="text-3xl font-bold text-green-200 shrink-0 w-12">{s.step}</div>
                <div>
                  <div className="font-bold text-lg mb-1">{s.title}</div>
                  <div className="text-gray-600 text-sm">{s.desc}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── AI 操作デモ ─── */}
      <section className="py-16 px-4 bg-gradient-to-br from-gray-900 to-gray-800 text-white">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="text-3xl font-bold mb-6">Claude AI で自然言語操作</h2>
          <p className="text-gray-300 mb-10">
            MCP（Model Context Protocol）対応。Claude Code から話しかけるだけで LINE 操作が完了。
          </p>
          <div className="bg-gray-900 rounded-2xl p-6 text-left font-mono text-sm space-y-3">
            <div className="text-green-400">
              {'>'} 来週のセミナー参加者タグを持つ人に案内メッセージを送って
            </div>
            <div className="text-gray-300 pl-4">
              🤖 line_list_tags を実行中...
              <br />
              タグ「src:セミナー参加者」(id: tag-xxxx) を確認しました。
              <br />
              line_broadcast_text でタグ絞り込み配信を作成中...
              <br />
              <span className="text-green-400">✅ 配信完了！ 47名に送信しました。</span>
            </div>
          </div>
        </div>
      </section>

      {/* ─── 料金プラン ─── */}
      <section className="py-16 px-4 bg-white">
        <div className="max-w-5xl mx-auto">
          <h2 className="text-3xl font-bold text-center mb-4">シンプルな料金プラン</h2>
          <p className="text-center text-gray-500 mb-12">
            いつでもアップグレード・ダウングレード可能
          </p>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {PLANS.map((plan) => (
              <div
                key={plan.name}
                className={`relative rounded-2xl p-8 border-2 flex flex-col ${
                  plan.highlight
                    ? 'border-green-500 shadow-2xl shadow-green-100'
                    : 'border-gray-200'
                }`}
              >
                {plan.highlight && (
                  <div className="absolute -top-4 left-1/2 -translate-x-1/2 bg-green-500 text-white text-xs font-bold px-4 py-1 rounded-full">
                    人気 No.1
                  </div>
                )}
                <div className="mb-6">
                  <div className="text-xl font-bold mb-1">{plan.name}</div>
                  <div className="text-4xl font-bold">
                    ¥{plan.price}
                    <span className="text-base font-normal text-gray-500">/{plan.unit}</span>
                  </div>
                  <div className="text-sm text-gray-500 mt-1">{plan.description}</div>
                </div>
                <ul className="space-y-3 mb-8 flex-1">
                  {plan.features.map((f, i) => (
                    <li key={i} className="flex items-start gap-2 text-sm">
                      <span className="text-green-500 mt-0.5">✓</span>
                      {f}
                    </li>
                  ))}
                </ul>
                <Link
                  href={plan.ctaHref}
                  className={`text-center py-3 rounded-xl font-bold transition ${
                    plan.highlight
                      ? 'bg-green-600 text-white hover:bg-green-700'
                      : 'border-2 border-gray-300 hover:border-green-500 hover:text-green-600'
                  }`}
                >
                  {plan.cta}
                </Link>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ─── CTA ─── */}
      <section className="py-20 px-4 bg-green-600 text-white text-center">
        <div className="max-w-2xl mx-auto">
          <h2 className="text-4xl font-bold mb-4">今すぐ無料で始める</h2>
          <p className="text-green-100 mb-8 text-lg">
            クレジットカード不要。セットアップ5分。いつでも解約可能。
          </p>
          <Link
            href="/login"
            className="inline-block bg-white text-green-700 px-10 py-4 rounded-xl font-bold text-xl hover:shadow-xl transition"
          >
            0円で LINE CRM を始める →
          </Link>
        </div>
      </section>

      {/* ─── フッター ─── */}
      <footer className="py-10 px-4 bg-gray-900 text-gray-400 text-sm">
        <div className="max-w-4xl mx-auto flex flex-col md:flex-row justify-between items-center gap-4">
          <div className="font-bold text-white">みやびライン</div>
          <div className="flex gap-6">
            <a
              href="https://github.com/ShunsukeHayashi/line-harness-oss"
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-white transition"
            >
              GitHub
            </a>
            <Link href="/login" className="hover:text-white transition">
              ログイン
            </Link>
          </div>
          <div>© 2026 みやびライン / MIT License</div>
        </div>
      </footer>

    </div>
  )
}
