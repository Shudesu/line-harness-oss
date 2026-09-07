export interface RuleFriend {
  id: string
  isFollowing: boolean
  lineAccountId?: string | null
  metadata: Record<string, unknown>
  tags: { id: string }[]
}

/** カスタマイズする場所。例: 来店回数が3回以上の友だち。 */
export function matchesRule(friend: RuleFriend): boolean {
  const visits = friend.metadata.visitCount
  return typeof visits === 'number' && Number.isFinite(visits) && visits >= 3
}

interface HarnessClient {
  friends: {
    list(params: { accountId: string; limit: number; offset: number }): Promise<{
      items: RuleFriend[]; hasNextPage: boolean
    }>
    get(id: string): Promise<RuleFriend>
    addTag(friendId: string, tagId: string): Promise<void>
  }
}

export async function applyTagRules(
  client: HarnessClient,
  options: { accountId: string; tagId: string; dryRun: boolean },
) {
  if (!options.accountId.trim() || !options.tagId.trim()) {
    throw new Error('LINE_ACCOUNT_ID と TARGET_TAG_ID を設定してください。')
  }
  const candidates = new Map<string, RuleFriend>()
  let scanned = 0
  // 大規模運用ではキュー・差分同期に置き換えてください。上限超過時は書き込み前に停止。
  for (let page = 0; ; page++) {
    if (page === 10) throw new Error('1,000件を超えました。差分同期またはキュー処理に変更してください。')
    const result = await client.friends.list({ accountId: options.accountId, limit: 100, offset: page * 100 })
    for (const friend of result.items) {
      scanned++
      if (friend.lineAccountId !== options.accountId) {
        throw new Error('APIのアカウント絞り込みを確認できません。書き込みを停止しました。')
      }
      if (friend.isFollowing && matchesRule(friend) && !friend.tags.some(t => t.id === options.tagId)) {
        candidates.set(friend.id, friend)
      }
    }
    if (!result.hasNextPage) break
    if (result.items.length === 0) throw new Error('空のページに継続フラグがあります。APIのページングを確認してください。')
  }
  let applied = 0
  if (!options.dryRun) {
    for (const friend of candidates.values()) {
      // 通常の再実行で既存タグを付け直さない。並行実行の厳密な排他は別途必要。
      const current = await client.friends.get(friend.id)
      if (current.lineAccountId !== options.accountId || !current.isFollowing || !matchesRule(current)) continue
      if (current.tags.some(t => t.id === options.tagId)) continue
      await client.friends.addTag(current.id, options.tagId)
      applied++
    }
  }
  return { scanned, matched: candidates.size, applied, dryRun: options.dryRun }
}
