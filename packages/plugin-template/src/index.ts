/**
 * L Harness Plugin: MyService
 *
 * Cloudflare Worker that syncs data from MyService → L Harness
 * and sends notifications based on external conditions.
 *
 * Replace "MyService" with your actual service name throughout this template.
 */

import { syncExternalData } from './sync.js'

export interface Env {
  LINE_HARNESS_API_URL: string
  LINE_HARNESS_API_KEY: string
  EXTERNAL_API_KEY: string
  LINE_ACCOUNT_ID?: string
}

export default {
  /**
   * Cron trigger: runs on the schedule defined in wrangler.toml.
   * Use this for periodic sync and notification checks.
   */
  async scheduled(
    _controller: ScheduledController,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<void> {
    console.log('[MyService Plugin] Cron triggered')

    // Step 1: Sync external data → L Harness tags/metadata
    await syncExternalData(env)

    // 通知例は src/notify.ts。イベント単位の重複防止・再送を実装してから接続する。
  },

  /**
   * HTTP handler: use for webhooks from the external service.
   * e.g., MyService sends a webhook when a booking is confirmed.
   */
  async fetch(
    request: Request,
    env: Env,
    _ctx: ExecutionContext,
  ): Promise<Response> {
    const url = new URL(request.url)

    // Health check
    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ status: 'ok', plugin: 'myservice' }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // Webhook endpoint: receives events from MyService
    if (url.pathname === '/webhook' && request.method === 'POST') {
      // 連携先の仕様に従って署名検証とイベント処理を実装してから有効化する。
      // 未実装のイベントを受領済みにせず、本文・顧客データもログへ出さない。
      return Response.json({ error: 'Webhook integration is not configured' }, { status: 501 })
    }

    return new Response('Not Found', { status: 404 })
  },
}
