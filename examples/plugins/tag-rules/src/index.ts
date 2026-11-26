import { LineHarness } from '@line-harness/sdk'
import { applyTagRules } from './rules'

// 通常の変数・ランタイム型は wrangler types から生成。secret だけを補完します。
type PluginEnv = Env & { LINE_HARNESS_API_KEY: string }

export default {
  async scheduled(_controller, env) {
    if (!env.LINE_HARNESS_API_KEY) throw new Error('LINE_HARNESS_API_KEY をsecretに設定してください。')
    if (env.DRY_RUN !== 'true' && env.DRY_RUN !== 'false') throw new Error('DRY_RUN は true / false を指定してください。')
    const url = new URL(env.LINE_HARNESS_API_URL)
    if (url.protocol !== 'https:' || url.hostname === 'your-line-harness.example.com') {
      throw new Error('LINE_HARNESS_API_URL に本体のHTTPS API URLを設定してください。')
    }
    const client = new LineHarness({
      apiUrl: env.LINE_HARNESS_API_URL,
      apiKey: env.LINE_HARNESS_API_KEY,
      lineAccountId: env.LINE_ACCOUNT_ID,
    })
    const result = await applyTagRules(client, {
      accountId: env.LINE_ACCOUNT_ID,
      tagId: env.TARGET_TAG_ID,
      dryRun: env.DRY_RUN === 'true',
    })
    console.log(JSON.stringify({ event: 'tag-rules.completed', ...result }))
  },
  async fetch(request) {
    if (request.method === 'GET' && new URL(request.url).pathname === '/health') {
      return Response.json({ status: 'ok', plugin: 'tag-rules' })
    }
    return new Response('Not Found', { status: 404 })
  },
} satisfies ExportedHandler<PluginEnv>
