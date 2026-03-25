import Link from 'next/link'

export default function TermsPage() {
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
        <h1 className="text-3xl font-bold mb-2">利用規約</h1>
        <p className="text-sm text-gray-500 mb-8">最終更新日: 2026年4月1日</p>

        <div className="space-y-8 text-gray-700 leading-relaxed">

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第1条（適用）</h2>
            <p className="text-sm">
              本規約は、合同会社みやび（以下「当社」）が提供する「みやびライン」（以下「本サービス」）の
              利用条件を定めるものです。本サービスをご利用いただく場合は、本規約に同意いただいたものとみなします。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第2条（利用登録）</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>登録を希望する方は、当社の定める方法によってアカウントを作成するものとします。</li>
              <li>当社は、登録希望者が以下に該当する場合、登録を拒否することがあります。
                <ul className="mt-1 ml-4 list-disc space-y-1 text-xs text-gray-600">
                  <li>虚偽の事項を届け出た場合</li>
                  <li>本規約に違反したことがある者からの申請である場合</li>
                  <li>反社会的勢力等と関係がある場合</li>
                </ul>
              </li>
              <li>本サービスは18歳以上の方を対象とします。未成年の方は保護者の同意を得た上でご利用ください。</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第3条（料金・支払い）</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>有料プランの利用料金は、当社が別途定める金額とします。</li>
              <li>料金は月額前払いとし、クレジットカードによる決済（Stripe）を利用します。</li>
              <li>無料トライアル期間終了後、自動的に有料プランへ移行します。</li>
              <li>当社は、事前に通知した上で料金を変更することがあります。</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第4条（返金ポリシー）</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>月額サブスクリプションを初めてご契約された場合、契約月の返金を申請できます（初月返金保証）。</li>
              <li>初月以降の返金は原則として対応しません。ただし、サービスの重大な障害等により当社の帰責事由がある場合はこの限りではありません。</li>
              <li>返金を希望される場合は support@ambitiousai.co.jp までご連絡ください。</li>
              <li>解約後の日割り返金は行いません。解約はいつでも可能で、次の更新日まで利用できます。</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第5条（禁止事項）</h2>
            <p className="text-sm mb-2">ユーザーは以下の行為をしてはなりません。</p>
            <ul className="list-disc list-inside space-y-1 text-sm">
              <li>法令または公序良俗に違反する行為</li>
              <li>スパム送信、迷惑メッセージの大量配信</li>
              <li>詐欺、フィッシング等の不正行為</li>
              <li>当社または第三者の知的財産権を侵害する行為</li>
              <li>本サービスのシステムへの不正アクセス</li>
              <li>LINE の利用規約に違反する行為</li>
              <li>その他、当社が不適切と判断する行為</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第6条（サービスの提供停止等）</h2>
            <p className="text-sm">
              当社は、以下の場合にはユーザーへの事前通知なく本サービスの全部または一部を停止・中断することがあります。
            </p>
            <ul className="mt-3 list-disc list-inside space-y-1 text-sm">
              <li>システムの保守・更新を行う場合</li>
              <li>地震・火災等の不可抗力により提供が困難な場合</li>
              <li>LINE Platform 等、外部サービスの障害が生じた場合</li>
            </ul>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第7条（免責事項）</h2>
            <ol className="list-decimal list-inside space-y-2 text-sm">
              <li>当社は、本サービスに起因してユーザーに生じたあらゆる損害について、当社の故意または重過失による場合を除き、責任を負いません。</li>
              <li>本サービスを通じて送信されるメッセージの内容・結果について、当社は責任を負いません。</li>
              <li>LINE アカウントの凍結・削除等、LINE 側の都合による影響について、当社は責任を負いません。</li>
            </ol>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第8条（サービス内容の変更・終了）</h2>
            <p className="text-sm">
              当社は、ユーザーへの事前通知をもって本サービスの内容を変更・終了することができます。
              サービス終了時には、少なくとも30日前に通知します。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第9条（利用規約の変更）</h2>
            <p className="text-sm">
              当社は必要と判断した場合、本規約を変更することができます。
              変更後の規約は本サービス上に掲示した時点から効力を生じます。
            </p>
          </section>

          <section>
            <h2 className="text-xl font-bold text-gray-900 mb-3">第10条（準拠法・管轄裁判所）</h2>
            <p className="text-sm">
              本規約の解釈には日本法を適用し、紛争については名古屋地方裁判所を専属的合意管轄裁判所とします。
            </p>
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
