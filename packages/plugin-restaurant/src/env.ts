export interface Env {
  DB: D1Database

  // LINE Harness connection
  LINE_HARNESS_API_URL: string
  LINE_HARNESS_API_KEY: string
  LINE_ACCOUNT_ID?: string

  // LIFF
  LIFF_ID: string
  /** Optional: LINE Login channel ID backing the LIFF app. When set, LIFF access tokens are checked against it. */
  LIFF_CHANNEL_ID?: string

  // Store profile / behavior
  STORE_NAME: string
  STAMP_GOAL: string
  REWARD_NAME: string
  WINBACK_DAYS: string
  /** Googleマップの口コミ投稿URL（未設定ならレビュー誘導は動かない） */
  GOOGLE_REVIEW_URL?: string
  /** 新規テイクアウト注文をスタッフに即時プッシュする ntfy.sh トピック（任意） */
  NTFY_TOPIC?: string

  /** 無料の自動音声通話（Telegram着信・CallMeBot）。店長のTelegramユーザー名（@付き）。要事前認可 */
  CALLMEBOT_TELEGRAM_USER?: string
  /** CallMeBot有料プランでの実電話架電（+81…）。月5〜30回上限プランなので低頻度店向け */
  CALLMEBOT_PHONE_NUMBER?: string
  /** secret: wrangler secret put CALLMEBOT_PHONE_APIKEY */
  CALLMEBOT_PHONE_APIKEY?: string

  // ClickSend実電話架電（審査なし・従量課金・回数無制限。宛先は STORE_PHONE_NUMBER）
  CLICKSEND_USERNAME?: string
  /** secret: wrangler secret put CLICKSEND_API_KEY */
  CLICKSEND_API_KEY?: string

  // 新規テイクアウト注文の自動架電（すべて設定されたときのみ有効・任意）
  TWILIO_ACCOUNT_SID?: string
  /** secret: wrangler secret put TWILIO_AUTH_TOKEN */
  TWILIO_AUTH_TOKEN?: string
  /** Twilioで購入した発信元番号（+81…） */
  TWILIO_FROM_NUMBER?: string
  /** 架電先＝お店の電話番号（+81…） */
  STORE_PHONE_NUMBER?: string

  // Secrets
  STAFF_PIN: string
  PLUGIN_API_KEY: string
}

export interface StoreConfig {
  storeName: string
  stampGoal: number
  rewardName: string
  winbackDays: number
  googleReviewUrl: string | null
  ntfyTopic: string | null
  callmebotUser: string | null
  callmebotPhone: { number: string; apiKey: string } | null
  clicksend: { username: string; apiKey: string; to: string } | null
  twilio: { accountSid: string; authToken: string; from: string; to: string } | null
}

export function storeConfig(env: Env): StoreConfig {
  return {
    storeName: env.STORE_NAME || 'お店',
    stampGoal: clampInt(env.STAMP_GOAL, 10, 1, 100),
    rewardName: env.REWARD_NAME || 'ご来店特典クーポン',
    winbackDays: clampInt(env.WINBACK_DAYS, 30, 7, 365),
    googleReviewUrl: env.GOOGLE_REVIEW_URL?.trim() || null,
    ntfyTopic: env.NTFY_TOPIC?.trim() || null,
    callmebotUser: env.CALLMEBOT_TELEGRAM_USER?.trim() || null,
    callmebotPhone:
      env.CALLMEBOT_PHONE_NUMBER && env.CALLMEBOT_PHONE_APIKEY
        ? { number: env.CALLMEBOT_PHONE_NUMBER.trim(), apiKey: env.CALLMEBOT_PHONE_APIKEY.trim() }
        : null,
    clicksend:
      env.CLICKSEND_USERNAME && env.CLICKSEND_API_KEY && env.STORE_PHONE_NUMBER
        ? {
            username: env.CLICKSEND_USERNAME.trim(),
            apiKey: env.CLICKSEND_API_KEY.trim(),
            to: env.STORE_PHONE_NUMBER.trim(),
          }
        : null,
    twilio:
      env.TWILIO_ACCOUNT_SID && env.TWILIO_AUTH_TOKEN && env.TWILIO_FROM_NUMBER && env.STORE_PHONE_NUMBER
        ? {
            accountSid: env.TWILIO_ACCOUNT_SID,
            authToken: env.TWILIO_AUTH_TOKEN,
            from: env.TWILIO_FROM_NUMBER,
            to: env.STORE_PHONE_NUMBER,
          }
        : null,
  }
}

function clampInt(raw: string | undefined, fallback: number, min: number, max: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  if (Number.isNaN(n)) return fallback
  return Math.min(max, Math.max(min, n))
}
