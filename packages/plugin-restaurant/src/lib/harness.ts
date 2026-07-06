import { LineHarness } from '@line-harness/sdk'
import type { Env } from '../env.js'

export function harnessClient(env: Env): LineHarness {
  return new LineHarness({
    apiUrl: env.LINE_HARNESS_API_URL,
    apiKey: env.LINE_HARNESS_API_KEY,
    lineAccountId: env.LINE_ACCOUNT_ID,
  })
}

/**
 * Resolve a LINE userId to a LINE Harness friend id by paging the friends
 * list. Harness registers friends on webhook contact, so a LIFF visitor who
 * has added the account will normally be present. Returns null when not found
 * (e.g. webhook not yet delivered) — callers must tolerate that and retry on
 * a later interaction.
 */
export async function resolveFriendId(client: LineHarness, lineUserId: string): Promise<string | null> {
  const pageSize = 200
  for (let offset = 0; offset < 20_000; offset += pageSize) {
    const page = await client.friends.list({ limit: pageSize, offset })
    const hit = page.items.find((f) => (f as { lineUserId?: string }).lineUserId === lineUserId)
    if (hit) return hit.id
    if (!page.hasNextPage) return null
  }
  return null
}

/** Send a text message to a friend; swallow errors so one bad send never aborts a cron batch. */
export async function trySendText(client: LineHarness, friendId: string | null, text: string): Promise<boolean> {
  if (!friendId) return false
  try {
    await client.friends.sendMessage(friendId, text)
    return true
  } catch (error) {
    console.error('[restaurant] send failed:', friendId, error)
    return false
  }
}

/** Find a tag by name or create it. Returns null if the harness rejects both (e.g. no permission). */
export async function getOrCreateTag(client: LineHarness, name: string): Promise<string | null> {
  try {
    const tags = await client.tags.list()
    const hit = tags.find((t) => t.name === name)
    if (hit) return hit.id
    const created = await client.tags.create({ name })
    return created.id
  } catch (error) {
    console.error('[restaurant] tag setup failed:', name, error)
    return null
  }
}

export async function tryAddTag(client: LineHarness, friendId: string | null, tagId: string | null): Promise<void> {
  if (!friendId || !tagId) return
  try {
    await client.friends.addTag(friendId, tagId)
  } catch {
    // already tagged or transient failure — non-fatal
  }
}
