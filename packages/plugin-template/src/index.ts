/**
 * LINE Harness Plugin: MyService
 *
 * Cloudflare Worker that syncs data from MyService → LINE Harness
 * and sends notifications based on external conditions.
 *
 * Replace "MyService" with your actual service name throughout this template.
 */

import { syncExternalData } from './sync.js'
import { checkAndNotify } from './notify.js'

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

    // Step 1: Sync external data → LINE Harness tags/metadata
    await syncExternalData(env)

    // Step 2: Check conditions and send notifications
    await checkAndNotify(env)
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
      try {
        const body = await request.json() as Record<string, unknown>
        console.log('[MyService Plugin] Webhook received:', JSON.stringify(body))

        // TODO: Validate webhook signature from MyService
        // TODO: Process the webhook event
        // Example: a booking was confirmed → tag the friend, send confirmation message

        return new Response(JSON.stringify({ received: true }), {
          headers: { 'Content-Type': 'application/json' },
        })
      } catch (error) {
        console.error('[MyService Plugin] Webhook error:', error)
        return new Response(JSON.stringify({ error: 'Invalid request' }), {
          status: 400,
          headers: { 'Content-Type': 'application/json' },
        })
      }
    }

    return new Response('Not Found', { status: 404 })
  },
}
