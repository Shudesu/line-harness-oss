import { LineClient } from '@line-crm/line-sdk'
import {
  getPendingInsights,
  updateInsightResult,
  markInsightFailed,
  getLineAccountById,
} from '@line-crm/db'

// Only run once per day — check if 24 hours have passed
const INSIGHT_INTERVAL_MS = 24 * 60 * 60 * 1000
let lastInsightRun = 0

export async function processInsightFetch(
  db: D1Database,
  lineClients: Map<string, LineClient>,
  defaultLineClient: LineClient,
  /** Phase 1-G v3: 暗号化 token 復号用 */
  env?: { LINE_TOKEN_ENC_KEY?: string },
): Promise<void> {
  const now = Date.now()
  if (now - lastInsightRun < INSIGHT_INTERVAL_MS) {
    return
  }
  lastInsightRun = now

  const pending = await getPendingInsights(db)
  if (pending.length === 0) return

  for (const item of pending) {
    try {
      const client =
        (item.lineAccountId && lineClients.get(item.lineAccountId)) ||
        defaultLineClient

      if (item.lineRequestId) {
        // Broadcast — use message event insight
        const response = (await client.getMessageEventInsight(
          item.lineRequestId,
        )) as Record<string, unknown>
        const overview = response.overview as Record<string, unknown> | undefined
        await updateInsightResult(db, item.insightId, {
          delivered: (overview?.delivered as number) ?? null,
          uniqueImpression: (overview?.uniqueImpression as number) ?? null,
          uniqueClick: (overview?.uniqueClick as number) ?? null,
          uniqueMediaPlayed: (overview?.uniqueMediaPlayed as number) ?? null,
          rawResponse: JSON.stringify(response),
        })
      } else if (item.aggregationUnit && item.targetType === 'multi-account-dedup') {
        // Multi-account dedup — 同じ unit を複数チャネルで使ってるので、
        // account_ids をループして各アカウントの token で getUnitInsight を呼び合算する。
        // failed_account_ids は除外しない (途中まで送れたバッチがあるため、
        // 部分配信のメトリクスも拾いたい)。
        const sentDate = item.sentAt.slice(0, 10).replace(/-/g, '')
        const accountIds = item.accountIds ?? []
        const perAccountResponses: Array<{ accountId: string; data: unknown }> = []

        let aggImpression = 0
        let aggClick = 0
        let aggMedia = 0
        let hasAnyData = false

        let allCallsFailed = true
        for (const aid of accountIds) {
          // is_active は意図的にチェックしない: 配信時点で active だったアカウントが
          // insight 取得時 (送信から3日後) には deactivate されてる可能性があり、
          // その場合でも保存済みの channel_access_token があれば LINE API は叩ける。
          // is_active で skip すると、過去の配信メトリクスが欠損する。
          const account = await getLineAccountById(db, aid)
          if (!account) continue
          try {
            // Codex P2 修正: 復号失敗を per-account catch 内で扱う
            let token = account.channel_access_token
            if (env) {
              const { resolveAccessToken } = await import('../lib/account-token.js')
              token = await resolveAccessToken(env, token)
            }
            const accClient = new LineClient(token)
            const response = (await accClient.getUnitInsight(
              item.aggregationUnit,
              sentDate,
              sentDate,
            )) as Record<string, unknown>
            perAccountResponses.push({ accountId: aid, data: response })
            allCallsFailed = false
            const messages = response.messages as Array<Record<string, unknown>> | undefined
            const overview = messages?.[0] || {}
            aggImpression += (overview.uniqueImpression as number) ?? 0
            aggClick += (overview.uniqueClick as number) ?? 0
            aggMedia += (overview.uniqueMediaPlayed as number) ?? 0
            if (messages && messages.length > 0) hasAnyData = true
          } catch (err) {
            console.error(`[insight-fetcher] dedup account ${aid} failed:`, err)
            perAccountResponses.push({ accountId: aid, data: { error: String(err) } })
          }
        }

        if (allCallsFailed) {
          // LINE 側が全 API call を失敗させた = 一時障害の可能性。pending のまま
          // retry させる (markInsightFailed が retryCount を上げて次回再試行)。
          await markInsightFailed(db, item.insightId, item.retryCount)
        } else {
          // 1件でもデータが取れたなら ready に確定する。messages 配列が空の場合は
          // null をセット (insight 未集計 → 翌日に手動 fetch すれば取れる可能性)。
          // delivered は unit insight 仕様上含まれない。dedup では
          // broadcasts.success_count を delivered の近似値として渡す。これにより
          // updateInsightResult が open_rate / click_rate を計算できる
          // (手動 /fetch-insight ルートと一貫した動作)。
          await updateInsightResult(db, item.insightId, {
            delivered: item.successCount,
            uniqueImpression: hasAnyData ? aggImpression : null,
            uniqueClick: hasAnyData ? aggClick : null,
            uniqueMediaPlayed: hasAnyData ? aggMedia : null,
            rawResponse: JSON.stringify({ perAccount: perAccountResponses }),
          })
        }
      } else if (item.aggregationUnit) {
        // Multicast (single-account tag) — use unit insight
        const sentDate = item.sentAt.slice(0, 10).replace(/-/g, '')
        const response = (await client.getUnitInsight(
          item.aggregationUnit,
          sentDate,
          sentDate,
        )) as Record<string, unknown>
        const messages = response.messages as Array<Record<string, unknown>> | undefined
        const overview = messages?.[0] || {}
        await updateInsightResult(db, item.insightId, {
          delivered: null,
          uniqueImpression: (overview.uniqueImpression as number) ?? null,
          uniqueClick: (overview.uniqueClick as number) ?? null,
          uniqueMediaPlayed: (overview.uniqueMediaPlayed as number) ?? null,
          rawResponse: JSON.stringify(response),
        })
      } else {
        // No tracking info — mark as failed
        await markInsightFailed(db, item.insightId, item.retryCount)
      }
    } catch (error) {
      console.error(
        `Insight fetch failed for broadcast ${item.broadcastId}:`,
        error,
      )
      await markInsightFailed(db, item.insightId, item.retryCount)
    }
  }
}
