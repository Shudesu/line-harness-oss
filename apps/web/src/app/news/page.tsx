import Link from 'next/link'
import Header from '@/components/layout/header'
import { PLUGIN_GUIDE_URL, PLUGIN_SUBMIT_URL, PLUGIN_REPO } from '@/lib/plugin-catalog'

export default function NewsPage() {
  return (
    <div className="mx-auto max-w-4xl p-4 sm:p-6 lg:p-8">
      <Header title="アップデートニュース" description="L Harnessで、新しくできること。" />
      <article className="overflow-hidden rounded-2xl border border-gray-200 bg-white">
        <div className="bg-slate-950 p-6 text-white sm:p-10">
          <p className="text-xs font-semibold tracking-widest text-emerald-300">PLUGIN MARKET / BETA</p>
          <h2 className="mt-4 text-2xl font-bold leading-snug sm:text-3xl">「数行だけ変えたい」を、<br />アップデートのたびに諦めない。</h2>
          <p className="mt-4 text-sm leading-7 text-slate-300">プラグインマーケットと、独立して拡張を作る開発環境を追加しました。</p>
        </div>
        <div className="space-y-8 p-6 text-sm leading-7 text-gray-600 sm:p-10">
          <section><h3 className="mb-3 text-lg font-bold text-gray-900">ユーザーの声から始まった、拡張の入口</h3><p>本体のコードを少し変えて、自分の運用に合わせる。でも、アップデートするとその変更が消えてしまう。そんな声をきっかけに、既存のSDKとプラグインのひな形を、もっと使い始めやすい形に整えました。</p></section>
          <section><h3 className="mb-3 text-lg font-bold text-gray-900">今回追加したもの</h3><ul className="list-disc space-y-2 pl-5"><li>管理画面から探せるプラグインマーケット。カテゴリとキーワードで検索できます。</li><li>最初の公式プラグイン「条件タグ付け」。条件に合う友だちをタグで分類し、シナリオ配信につなげます。</li><li>本体の外に開発用フォルダを作るコマンド。公開済みSDKを使って独立して開発できます。</li><li>開発ガイドとコミュニティ向けの掲載申請窓口。</li></ul></section>
          <section><h3 className="mb-3 text-lg font-bold text-gray-900">独自コードを、本体の外へ</h3><p>プラグインを別のリポジトリ・別のWorkerに置くことで、本体更新によるコードの上書きを避けられます。APIの仕様変更による影響は別に確認が必要なので、SDKのバージョン固定と更新前の動作確認も開発ガイドにまとめました。</p><p className="mt-3">β版はガイドから個別に導入するカタログです。管理画面内でのワンクリック導入、決済、管理画面の表示を差し替える機能は含まれていません。</p></section>
          <section><h3 className="mb-3 text-lg font-bold text-gray-900">次は、あなたのプラグインを</h3><p>外部サービスとの連携や、業務に合わせた自動処理を募集します。小さな機能から、一緒にマーケットを育てていきましょう。</p><div className="mt-5 flex flex-wrap gap-x-6 gap-y-3 font-semibold text-emerald-700"><Link href="/plugins" className="underline underline-offset-4">マーケットを見る →</Link><a href={PLUGIN_GUIDE_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">開発ガイド ↗</a><a href={PLUGIN_SUBMIT_URL} target="_blank" rel="noreferrer" className="underline underline-offset-4">掲載申請 ↗</a></div></section>
        </div>
      </article>
      <div className="mt-6 flex flex-wrap gap-5 text-sm text-gray-500"><Link href="/updates" className="underline underline-offset-4">この環境のアップデート履歴</Link><a href={`${PLUGIN_REPO}/releases`} target="_blank" rel="noreferrer" className="underline underline-offset-4">すべてのリリースノート ↗</a></div>
    </div>
  )
}
