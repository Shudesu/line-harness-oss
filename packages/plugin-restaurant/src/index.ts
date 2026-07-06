/**
 * LINE Harness Plugin: Restaurant (飲食店特化拡張)
 *
 * Cloudflare Worker providing:
 *  - デジタル会員証・スタンプカード (LIFF)
 *  - 予約受付 + 前日/当日リマインド (LIFF + cron)
 *  - 再来店促進 (誕生日クーポン・呼び戻し, cron)
 *  - スタッフページ (来店コード・押印・特典消込・予約台帳)
 *  - Admin API (同梱のMCPサーバーが利用)
 *
 * Messaging is always delegated to LINE Harness — this worker never calls
 * LINE's Messaging API directly.
 */
import { Hono } from 'hono'
import type { Env } from './env.js'
import { storeConfig } from './env.js'
import type { AppContext } from './middleware/auth.js'
import { harnessClient } from './lib/harness.js'
import { liffApi } from './routes/liff.js'
import { staffApi } from './routes/staff.js'
import { adminApi } from './routes/admin.js'
import { cardPage } from './pages/card.js'
import { reservePage } from './pages/reserve.js'
import { takeoutPage } from './pages/takeout.js'
import { staffPage } from './pages/staff.js'
import { processReservationReminders } from './services/reservations.js'
import { processPendingNotifications } from './services/review.js'
import { runDailyJobs } from './services/crm.js'

const app = new Hono<AppContext>()

app.get('/health', (c) => c.json({ status: 'ok', plugin: 'restaurant' }))

// LIFF pages
app.get('/', (c) => c.redirect('/liff/card'))
app.get('/liff/card', (c) => c.html(cardPage(c.env.LIFF_ID, storeConfig(c.env).storeName)))
app.get('/liff/reserve', (c) => c.html(reservePage(c.env.LIFF_ID, storeConfig(c.env).storeName)))
app.get('/liff/takeout', (c) => c.html(takeoutPage(c.env.LIFF_ID, storeConfig(c.env).storeName)))
app.get('/staff', (c) => c.html(staffPage(c.env.LIFF_ID, storeConfig(c.env).storeName)))

// APIs
app.route('/api/liff', liffApi)
app.route('/api/staff', staffApi)
app.route('/api/admin', adminApi)

app.notFound((c) => c.json({ success: false, error: 'not found' }, 404))
app.onError((err, c) => {
  console.error('[restaurant] unhandled error:', err)
  return c.json({ success: false, error: 'internal error' }, 500)
})

export default {
  fetch: app.fetch,

  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = storeConfig(env)
    const client = harnessClient(env)
    const now = new Date()

    ctx.waitUntil(
      (async () => {
        const reminders = await processReservationReminders(env.DB, client, config, now)
        const queued = await processPendingNotifications(env.DB, client, config)
        const daily = await runDailyJobs(env.DB, client, config, now)
        console.log(
          `[restaurant] cron done: reminders=${reminders} queued=${queued} daily=${daily.ran ? `birthday=${daily.birthday} winback=${daily.winback}` : 'skipped'}`,
        )
      })(),
    )
  },
}
