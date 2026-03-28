/**
 * Sync: pull data from MyService and update LINE Harness friends.
 *
 * Common patterns:
 * - Sync customer status → metadata fields
 * - Sync subscription tiers → tags
 * - Sync appointment history → metadata
 */

import { LineHarness } from '@line-harness/sdk'
import { MyServiceClient } from './external-api.js'
import type { Env } from './index.js'

function createClients(env: Env) {
  const harness = new LineHarness({
    apiUrl: env.LINE_HARNESS_API_URL,
    apiKey: env.LINE_HARNESS_API_KEY,
    lineAccountId: env.LINE_ACCOUNT_ID,
  })
  const myService = new MyServiceClient(env.EXTERNAL_API_KEY)
  return { harness, myService }
}

/**
 * Main sync function: called by the cron handler.
 *
 * This example:
 * 1. Fetches all customers from MyService
 * 2. For each customer that has a LINE friend record, updates metadata and tags
 */
export async function syncExternalData(env: Env): Promise<void> {
  const { harness, myService } = createClients(env)

  // Fetch customers from the external service
  const customers = await myService.listCustomers()

  // Ensure required tags exist in LINE Harness
  const allTags = await harness.tags.list()
  const tagMap = new Map(allTags.map((t) => [t.name, t.id]))

  async function ensureTag(name: string, color?: string): Promise<string> {
    const existing = tagMap.get(name)
    if (existing) return existing
    const created = await harness.tags.create({ name, color })
    tagMap.set(name, created.id)
    return created.id
  }

  // Create tags for each tier (customize for your service)
  const tierTags: Record<string, string> = {}
  for (const tier of ['free', 'basic', 'premium']) {
    tierTags[tier] = await ensureTag(`myservice:${tier}`, '#3B82F6')
  }

  // Sync each customer
  for (const customer of customers) {
    if (!customer.lineUserId) continue

    try {
      // Find the LINE friend by paginating through all friends.
      // In production, store a mapping (externalId → friendId) in your own DB
      // to avoid full scans. This is a simplified example.
      let friend = null
      let offset = 0
      const pageSize = 100
      while (!friend) {
        const page = await harness.friends.list({ limit: pageSize, offset })
        friend = page.items.find(
          (f) => f.metadata?.externalId === customer.id,
        ) ?? null
        if (!page.hasNextPage) break
        offset += pageSize
      }
      if (!friend) continue

      // Update metadata with external service data
      await harness.friends.setMetadata(friend.id, {
        externalId: customer.id,
        myserviceTier: customer.tier,
        myserviceLastVisit: customer.lastVisitDate,
        myserviceVisitCount: customer.visitCount,
      })

      // Sync tier tag: remove old tier tags, add current one
      const currentTierTagId = tierTags[customer.tier]
      if (currentTierTagId) {
        for (const [tier, tagId] of Object.entries(tierTags)) {
          if (tier !== customer.tier) {
            // Remove non-matching tier tags (ignore errors if not assigned)
            try {
              await harness.friends.removeTag(friend.id, tagId)
            } catch {
              // Tag was not assigned, ignore
            }
          }
        }
        await harness.friends.addTag(friend.id, currentTierTagId)
      }

      console.log(`[Sync] Updated friend ${friend.id} (${customer.id})`)
    } catch (error) {
      console.error(`[Sync] Failed for customer ${customer.id}:`, error)
    }
  }

  console.log(`[Sync] Completed. Processed ${customers.length} customers.`)
}
