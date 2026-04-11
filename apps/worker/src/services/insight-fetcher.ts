import { LineClient } from '@line-crm/line-sdk'
import {
  getPendingInsights,
  updateInsightResult,
  markInsightFailed,
} from '@line-crm/db'

// Only run once per day — check if 24 hours have passed
const INSIGHT_INTERVAL_MS = 24 * 60 * 60 * 1000
let lastInsightRun = 0

export async function processInsightFetch(
  db: D1Database,
  lineClients: Map<string, LineClient>,
  defaultLineClient: LineClient,
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
      } else if (item.aggregationUnit) {
        // Multicast — use unit insight
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
