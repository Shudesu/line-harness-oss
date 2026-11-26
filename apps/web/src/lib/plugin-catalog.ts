export const PLUGIN_REPO = 'https://github.com/Shudesu/line-harness-oss'
export const PLUGIN_GUIDE_URL = `${PLUGIN_REPO}/blob/main/docs/plugins/README.md`
export const PLUGIN_SUBMIT_URL = `${PLUGIN_REPO}/issues/new?template=plugin-submission.yml`

export type PluginCategory = '自動化' | '外部連携' | '開発ツール'
export interface PluginListing {
  id: string
  name: string
  summary: string
  category: PluginCategory
  kind: 'プラグイン' | 'テンプレート' | 'SDK' | 'MCP'
  author: string
  publisher: 'official' | 'community'
  version: string
  access: string
  setup: string
  href: string
  tags: string[]
}

// 同梱カタログ。追加は掲載審査後のPRで管理し、本体リリースに合わせて配布する。
// ダウンロード数・レビュー数・未実装の製品を生成しない。
export const pluginCatalog: PluginListing[] = [
  {
    id: 'tag-rules', name: '条件タグ付け', category: '自動化', kind: 'プラグイン',
    summary: '来店回数などの条件に合う友だちへタグを付与。タグ追加をきっかけに、既存のシナリオ配信へつなげられます。',
    author: 'L Harness', publisher: 'official', version: '0.1.0', access: '友だち・タグの読み取り、タグの追加',
    setup: '独立したCloudflare Workerとして導入。初期設定は確認モードです。',
    href: `${PLUGIN_REPO}/tree/main/examples/plugins/tag-rules`, tags: ['タグ', '来店', 'シナリオ', '配信', 'cron'],
  },
  {
    id: 'integration-template', name: '外部サービス連携スターター', category: '外部連携', kind: 'テンプレート',
    summary: '顧客データの同期、通知、MCP連携のコード例をまとめた開発用ひな形。連携先のAPI処理を追加して使います。',
    author: 'L Harness', publisher: 'official', version: '0.1.0', access: '実装する処理に応じて友だち情報・タグ・メッセージを操作',
    setup: '開発者向け。外部API・署名検証・通知の重複防止は実装が必要です。',
    href: `${PLUGIN_REPO}/tree/main/packages/plugin-template`, tags: ['予約', '顧客', 'Webhook', '通知', '外部API'],
  },
  {
    id: 'typescript-sdk', name: 'TypeScript SDK', category: '開発ツール', kind: 'SDK',
    summary: '友だち・タグ・配信などをTypeScriptから操作。独自の自動処理を、本体のコードから切り離して作れます。',
    author: 'L Harness', publisher: 'official', version: 'npmで公開版を確認', access: '呼び出すAPIに応じた操作',
    setup: 'Node.jsやCloudflare Workersなど、サーバー側で利用します。',
    href: `${PLUGIN_REPO}/tree/main/packages/sdk`, tags: ['TypeScript', 'API', '開発', 'SDK'],
  },
  {
    id: 'mcp-server', name: 'L Harness MCP Server', category: '開発ツール', kind: 'MCP',
    summary: 'AIエージェントからL Harnessを操作するための接続口。既存ツールを活用して運用を自動化できます。',
    author: 'L Harness', publisher: 'official', version: 'パッケージで確認', access: '公開ツールが呼び出すAPIの操作',
    setup: 'MCP対応のAIツールへ接続設定を追加します。',
    href: `${PLUGIN_REPO}/tree/main/packages/mcp-server`, tags: ['AI', 'MCP', '自動化'],
  },
]

export function filterPlugins(query: string, category: PluginCategory | 'すべて') {
  const words = query.trim().toLocaleLowerCase('ja-JP').split(/\s+/).filter(Boolean)
  return pluginCatalog.filter(plugin => {
    const haystack = [plugin.name, plugin.summary, plugin.kind, ...plugin.tags].join(' ').toLocaleLowerCase('ja-JP')
    return (category === 'すべて' || plugin.category === category) && words.every(word => haystack.includes(word))
  })
}
