/**
 * MCP Server for the restaurant plugin.
 *
 * Lets AI agents (Claude Code など) inspect reservations, members and stamp
 * stats, and issue rewards — via the plugin worker's admin API.
 *
 * .mcp.json example:
 *   {
 *     "mcpServers": {
 *       "restaurant": {
 *         "command": "node",
 *         "args": ["packages/plugin-restaurant/dist-mcp/index.js"],
 *         "env": {
 *           "RESTAURANT_PLUGIN_URL": "https://line-harness-plugin-restaurant.<you>.workers.dev",
 *           "RESTAURANT_PLUGIN_API_KEY": "..."
 *         }
 *       }
 *     }
 *   }
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { clientFromEnv } from './plugin-api.js'

const server = new McpServer({
  name: 'line-harness-plugin-restaurant',
  version: '0.1.0',
})

function jsonResult(data: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(data, null, 2) }] }
}

function errorResult(error: unknown) {
  return {
    content: [{ type: 'text' as const, text: `Error: ${error instanceof Error ? error.message : String(error)}` }],
    isError: true,
  }
}

server.tool(
  'list_reservations',
  '指定日（省略時は本日・JST）の予約一覧を取得する',
  { date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().describe('YYYY-MM-DD (JST)') },
  async ({ date }) => {
    try {
      return jsonResult(await clientFromEnv().listReservations(date))
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'lookup_member',
  '会員番号で会員情報（スタンプ数・来店回数・最終来店日）を取得する',
  { memberNo: z.string().describe('会員番号 (例: R-000123)') },
  async ({ memberNo }) => {
    try {
      return jsonResult(await clientFromEnv().getMember(memberNo))
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'get_restaurant_stats',
  '会員数・直近30日来店数・特典発行/消込数・今後の予約数を取得する',
  {},
  async () => {
    try {
      return jsonResult(await clientFromEnv().getStats())
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'issue_reward',
  '会員に特典クーポンを発行しLINEで通知する（実行前にユーザーの確認を取ること）',
  {
    memberNo: z.string().describe('会員番号 (例: R-000123)'),
    name: z.string().optional().describe('特典名（省略時は店舗デフォルト特典）'),
  },
  async ({ memberNo, name }) => {
    try {
      return jsonResult(await clientFromEnv().issueReward(memberNo, name))
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'create_campaign_coupon',
  '全員向けの共通クーポン（CP-コード）を作成する。配信は別途ブロードキャストで行う',
  {
    name: z.string().describe('キャンペーン名（例: 雨の日限定10%OFF）'),
    discountText: z.string().optional().describe('割引表記（例: 10%OFF）'),
    expiresAt: z.string().optional().describe('有効期限 YYYY-MM-DD（JST終日）'),
  },
  async ({ name, discountText, expiresAt }) => {
    try {
      return jsonResult(await clientFromEnv().createCampaign(name, discountText, expiresAt))
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'list_campaign_coupons',
  'キャンペーンクーポン一覧（使用回数・期限つき）を取得する',
  {},
  async () => {
    try {
      return jsonResult(await clientFromEnv().listCampaigns())
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'list_takeout_menu',
  'テイクアウトメニュー一覧（非公開含む）を取得する',
  {},
  async () => {
    try {
      return jsonResult(await clientFromEnv().listTakeoutMenu())
    } catch (e) {
      return errorResult(e)
    }
  },
)

server.tool(
  'upsert_takeout_menu_item',
  'テイクアウトメニューを追加・更新する（idを渡すと更新）',
  {
    id: z.string().optional().describe('更新時のみ指定'),
    name: z.string().describe('商品名'),
    price: z.number().int().min(0).describe('税込価格（円）'),
    description: z.string().optional(),
    isAvailable: z.boolean().optional().describe('false で非公開'),
    sortOrder: z.number().int().optional(),
  },
  async (input) => {
    try {
      return jsonResult(await clientFromEnv().upsertTakeoutMenuItem(input))
    } catch (e) {
      return errorResult(e)
    }
  },
)

async function main() {
  const transport = new StdioServerTransport()
  await server.connect(transport)
  console.error('Restaurant Plugin MCP Server running on stdio')
}

main().catch((error) => {
  console.error('Fatal error:', error)
  process.exit(1)
})
