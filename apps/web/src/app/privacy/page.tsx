import Link from 'next/link'

export default function PrivacyPage() {
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
        <h1 className="text-3xl font-bold mb-2">プライバシーポリシー</h1>
        <p className="text-sm text-gray-500 mb-8">最終更新日: 2026年4月1日</p>

        <div className="prose prose-gray max-w-none space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">1. 事業者情報</h2>
            <p>
              合同会社みやび（以下「当社」）は、みやびライン（以下「本サービス」）における
              個人情報の取り扱いについて、以下のとおりプライバシーポリシーを定めます。
            </p>
            <ul className="mt-3 space-y-1 text-sm">
              <li><span className="font-medium">事業者名:</span> 合同会社みやび</li>
              <li><span className="font-medium">代表社員:</span> 林 駿甫</li>
              <li><span className="font-medium">所在地:</span> 愛知県一宮市（詳細は特定商取引法表記参照）</li>
              <li><span className="font-medium">お問い合わせ:</span> support@ambitiousai.co.jp</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">2. 収集する情報</h2>
            <p>当社は以下の情報を収集します。</p>
            <ul className="mt-3 list-disc list-inside space-y-1 text-sm">
              <li>メールアドレス（アカウント登録時）</li>
              <li>LINE チャンネルアクセストークン（サービス利用のため）</li>
              <li>LINE 公式アカウントに登録された友だちの ID・表示名・プロフィール画像</li>
              <li>本サービス内で入力したタグ・シナリオ・メッセージ内容</li>
              <li>サービス利用ログ（操作履歴、エラーログ）</li>
              <li>決済情報（クレジットカード番号は Stripe が管理し、当社は保持しません）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">3. 利用目的</h2>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>本サービスの提供・運営・改善</li>
              <li>ユーザーサポートの提供</li>
              <li>利用規約違反の調査・対応</li>
              <li>統計データの作成（個人を特定できない形式）</li>
              <li>当社サービスに関するお知らせの送信</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">4. 第三者提供</h2>
            <p>
              当社は、以下の場合を除き、収集した個人情報を第三者に提供しません。
            </p>
            <ul className="mt-3 list-disc list-inside space-y-1 text-sm">
              <li>ご本人の同意がある場合</li>
              <li>法令に基づく開示が必要な場合</li>
              <li>人の生命・身体・財産の保護のために必要な場合</li>
            </ul>
            <p className="mt-3 text-sm">
              本サービスは以下のサービスを利用します。各サービスのプライバシーポリシーもご確認ください。
            </p>
            <ul className="mt-2 list-disc list-inside space-y-1 text-sm">
              <li>Cloudflare（インフラ・データ保管 — 米国）</li>
              <li>Stripe（決済処理）</li>
              <li>LINE Corporation（LINE API）</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">5. データの保管場所</h2>
            <p className="text-sm">
              本サービスのデータは <strong>Cloudflare のインフラ（米国）</strong> に保管されます。
              EU/EEA にお住まいの方は、データが米国に転送されることをご了承の上でご利用ください。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">6. データの保存期間</h2>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>アカウント情報: アカウント削除後 30 日間</li>
              <li>LINE 友だち情報: アカウント削除後 30 日間</li>
              <li>利用ログ: 90 日間</li>
              <li>決済記録: 法令に基づき 7 年間</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">7. お客様の権利</h2>
            <p className="text-sm">
              お客様は以下の権利を有します。support@ambitiousai.co.jp へご連絡ください。
            </p>
            <ul className="mt-3 list-disc list-inside space-y-1 text-sm">
              <li>個人情報の開示請求</li>
              <li>個人情報の訂正・削除請求</li>
              <li>個人情報の利用停止請求</li>
              <li>アカウント削除</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">8. Cookie・アクセス解析</h2>
            <p className="text-sm">
              本サービスではサービス改善のため、セッション維持に必要な Cookie を使用します。
              現時点では第三者のアクセス解析ツールは使用していません。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">9. ポリシーの変更</h2>
            <p className="text-sm">
              本ポリシーは必要に応じて改定することがあります。
              重要な変更がある場合は、本サービス上でお知らせします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">10. お問い合わせ</h2>
            <p className="text-sm">
              個人情報の取り扱いに関するお問い合わせは以下までご連絡ください。
            </p>
            <p className="mt-2 text-sm font-medium">support@ambitiousai.co.jp</p>
          </section>

        </div>
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
