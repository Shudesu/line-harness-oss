'use client'

import { useState } from 'react'
import Link from 'next/link'
import Header from '@/components/layout/header'
import { Badge } from '@cloudflare/kumo/components/badge'
import { Button } from '@cloudflare/kumo/components/button'
import { Input } from '@cloudflare/kumo/components/input'
import { LayerCard } from '@cloudflare/kumo/components/layer-card'
import { filterPlugins, PLUGIN_GUIDE_URL, PLUGIN_SUBMIT_URL, type PluginCategory } from '@/lib/plugin-catalog'

const categories = ['すべて', '自動化', '外部連携', '開発ツール'] as const
const linkStyle = 'inline-flex items-center justify-center rounded-lg px-4 py-2.5 text-sm font-semibold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-4'

export default function PluginsPage() {
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<PluginCategory | 'すべて'>('すべて')
  const plugins = filterPlugins(query, category)

  return (
    <div className="mx-auto max-w-6xl p-4 sm:p-6 lg:p-8">
      <Header title="プラグインマーケット" description="あなたの運用に、必要な拡張を。" />
      <section className="relative mb-8 overflow-hidden rounded-2xl bg-slate-950 p-6 text-white sm:p-10" aria-labelledby="market-title">
        <div className="pointer-events-none absolute -right-20 -top-28 h-80 w-80 rounded-full bg-emerald-500/20 blur-3xl" aria-hidden="true" />
        <div className="relative max-w-2xl">
          <p className="mb-4 text-xs font-semibold tracking-[0.2em] text-emerald-300">L HARNESS / PLUGIN MARKET · BETA</p>
          <h2 id="market-title" className="text-2xl font-bold leading-tight sm:text-4xl">その数行を、<br />あなたのプラグインに。</h2>
          <p className="mt-5 max-w-xl text-sm leading-7 text-slate-300 sm:text-base">配信ルールも、顧客データの連携も。本体の外に拡張を置けば、アップデートで独自コードが上書きされません。</p>
          <div className="mt-6 flex flex-wrap gap-3">
            <a href={PLUGIN_GUIDE_URL} target="_blank" rel="noreferrer" className={`${linkStyle} bg-emerald-400 text-slate-950 hover:bg-emerald-300`}>プラグインを作る ↗</a>
            <a href={PLUGIN_SUBMIT_URL} target="_blank" rel="noreferrer" className={`${linkStyle} border border-slate-600 text-white hover:bg-slate-800`}>マーケットに掲載する ↗</a>
          </div>
          <p className="mt-5 text-xs leading-5 text-slate-400">β版は導入ガイド付きのカタログです。各プラグインを別途セットアップして利用します。</p>
        </div>
      </section>

      <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-2" role="group" aria-label="カテゴリで絞り込む">
          {categories.map(value => <Button key={value} type="button" variant={category === value ? 'primary' : 'secondary'} aria-pressed={category === value} onClick={() => setCategory(value)}>{value}</Button>)}
        </div>
        <Input aria-label="プラグインを検索" placeholder="タグ、配信、外部連携…" value={query} onChange={event => setQuery(event.target.value)} className="w-full sm:max-w-64" />
      </div>
      <p className="mb-4 text-sm text-gray-500" role="status">{plugins.length}件のプラグイン・開発リソース</p>
      <div className="grid gap-4 md:grid-cols-2">
        {plugins.map(plugin => (
          <LayerCard key={plugin.id} className="flex h-full flex-col p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2"><Badge variant={plugin.publisher === 'official' ? 'success' : 'neutral'}>{plugin.publisher === 'official' ? '公式' : 'コミュニティ'}</Badge><Badge variant="neutral">{plugin.kind}</Badge><span className="ml-auto text-xs text-gray-400">{plugin.category}</span></div>
            <h2 className="text-lg font-bold text-gray-900">{plugin.name}</h2>
            <p className="mt-2 text-xs text-gray-400">{plugin.author} · {plugin.version}</p>
            <p className="mt-4 flex-1 text-sm leading-6 text-gray-600">{plugin.summary}</p>
            <p className="mt-4 text-xs leading-5 text-gray-500">{plugin.setup}</p>
            <details className="mt-3 text-xs leading-5 text-gray-500"><summary className="cursor-pointer font-medium">利用するデータ・操作</summary><p className="mt-2">{plugin.access}。これは機能の説明です。APIキーの権限をプラグイン単位に制限する仕組みではありません。</p></details>
            <a href={plugin.href} target="_blank" rel="noreferrer" className={`${linkStyle} mt-5 border border-gray-200 text-gray-900 hover:bg-gray-50`}>導入ガイド・ソースを見る ↗</a>
          </LayerCard>
        ))}
      </div>
      {plugins.length === 0 && <LayerCard className="p-10 text-center"><h2 className="font-semibold">該当するプラグインはありません</h2><p className="mt-2 text-sm text-gray-500">別のキーワードやカテゴリで探してください。</p><Button className="mt-4" variant="secondary" onClick={() => { setQuery(''); setCategory('すべて') }}>絞り込みを解除</Button></LayerCard>}

      <section className="mt-8 grid gap-6 rounded-xl border border-gray-200 bg-white p-6 md:grid-cols-2">
        <div><h2 className="text-lg font-bold text-gray-900">最初の作り手になろう。</h2><p className="mt-3 text-sm leading-7 text-gray-600">あなたのために書いた数行が、誰かの役に立つ拡張になります。連携先、導入手順、動作確認したバージョンを添えて、掲載を申請できます。</p><a href={PLUGIN_SUBMIT_URL} target="_blank" rel="noreferrer" className="mt-4 inline-block text-sm font-semibold text-emerald-700 underline underline-offset-4">掲載を申請する ↗</a></div>
        <div><h2 className="font-semibold text-gray-900">アップデートと共存するために</h2><p className="mt-3 text-sm leading-7 text-gray-600">独自コード・設定・データは、本体と別の場所で管理します。SDKのバージョンを固定し、本体を更新するときに接続を確認してください。現在の拡張対象はAPIで操作できる配信・自動処理・外部連携です。</p><Link href="/news" className="mt-4 inline-block text-sm font-semibold text-emerald-700 underline underline-offset-4">アップデートニュースを読む →</Link></div>
      </section>
    </div>
  )
}
