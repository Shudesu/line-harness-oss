import Link from 'next/link'

export default function TokuteiPage() {
  return (
    <div className="min-h-screen bg-white">
      {/* ナビゲーション */}
      <nav className="border-b px-4 py-4">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <Link href="/landing" className="text-green-600 font-bold text-lg">
            みやびライン
          </Link>
          <Link href="/landing" className="text-sm text-gray-500 hover:text-gray-700">
            ← トップへ戻る
          </Link>
        </div>
      </nav>

      <main className="max-w-3xl mx-auto px-4 py-12">
        <h1 className="text-3xl font-bold mb-2">特定商取引法に基づく表記</h1>
        <p className="text-sm text-gray-500 mb-8">最終更新日: 2026年4月1日</p>

        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <tbody>
              {[
                ['販売事業者', '合同会社みやび'],
                ['代表者', '林 駿甫'],
                ['所在地', '愛知県一宮市（詳細住所はご請求により開示します）'],
                ['電話番号', 'メールにてご対応します（support@ambitiousai.co.jp）'],
                ['メールアドレス', 'support@ambitiousai.co.jp'],
                ['サービス名', 'みやびライン（LINE Harness OSS SaaS版）'],
                ['販売価格', [
                  '• Free プラン: 無料',
                  '• Pro プラン: ¥2,980 / 月（税込）',
                  '• Business プラン: ¥9,800 / 月（税込）',
                ]],
                ['支払方法', 'クレジットカード（Visa / Mastercard / American Express / JCB）'],
                ['支払時期', '月額前払い。毎月の更新日に自動請求されます'],
                ['サービス開始時期', 'ご登録後すぐにご利用いただけます'],
                ['解約について', 'いつでも解約可能です。解約後も当月末まで利用できます'],
                ['返金ポリシー', [
                  '• 初月返金保証あり（有料プラン初回契約月に限り全額返金）',
                  '• 初月以降の返金は原則対応しません',
                  '• 返金申請: support@ambitiousai.co.jp',
                ]],
                ['動作環境', 'モダンブラウザ（Chrome / Firefox / Safari / Edge 最新版）'],
                ['必要なもの', 'LINE Developers アカウント・LINE 公式アカウント'],
                ['特記事項', [
                  '• 本サービスは Cloudflare の無料枠インフラを使用します',
                  '• データは米国（Cloudflare）のサーバーに保管されます',
                  '• LINE Corporation のサービス変更により機能が制限される場合があります',
                ]],
              ].map(([label, value]) => (
                <tr key={String(label)} className="border-b last:border-b-0">
                  <td className="bg-gray-50 p-4 font-medium text-gray-700 w-40 align-top">
                    {label}
                  </td>
                  <td className="p-4 text-gray-800 align-top">
                    {Array.isArray(value) ? (
                      <ul className="space-y-1">
                        {(value as string[]).map((item, i) => (
                          <li key={i}>{item}</li>
                        ))}
                      </ul>
                    ) : (
                      value
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <p className="mt-8 text-xs text-gray-500">
          本表記は特定商取引に関する法律（特商法）第11条および第12条の規定に基づくものです。
          ご不明な点は support@ambitiousai.co.jp までお問い合わせください。
        </p>
      </main>

      <footer className="border-t py-8 px-4 mt-16">
        <div className="max-w-3xl mx-auto flex flex-wrap gap-4 text-sm text-gray-500">
          <Link href="/privacy" className="hover:text-gray-700">プライバシーポリシー</Link>
          <Link href="/terms" className="hover:text-gray-700">利用規約</Link>
          <Link href="/tokutei" className="hover:text-gray-700">特定商取引法</Link>
          <span>© 2026 合同会社みやび</span>
        </div>
      </footer>
    </div>
  )
}
