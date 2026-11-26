import { describe, expect, it, vi } from 'vitest'
import { applyTagRules, matchesRule, type RuleFriend } from '../examples/plugins/tag-rules/src/rules'

const friend = (overrides: Partial<RuleFriend> = {}): RuleFriend => ({
  id: 'friend-1', lineAccountId: 'account-1', isFollowing: true, metadata: { visitCount: 3 }, tags: [], ...overrides,
})
const options = { accountId: 'account-1', tagId: 'tag-1', dryRun: true }
function client(items: RuleFriend[]) {
  return { friends: {
    list: vi.fn().mockResolvedValue({ items, hasNextPage: false }),
    get: vi.fn().mockImplementation(async id => items.find(f => f.id === id)),
    addTag: vi.fn().mockResolvedValue(undefined),
  } }
}

describe('tag rules', () => {
  it('only matches finite numeric visit counts', () => {
    for (const visitCount of [null, '3', undefined, -1, 2, Infinity, NaN]) expect(matchesRule(friend({ metadata: { visitCount } }))).toBe(false)
    expect(matchesRule(friend())).toBe(true)
  })
  it('dry run excludes unfollowed and already tagged friends without any mutation', async () => {
    const api = client([friend(), friend({ id: 'blocked', isFollowing: false }), friend({ id: 'tagged', tags: [{ id: 'tag-1' }] })])
    expect(await applyTagRules(api, options)).toEqual({ scanned: 3, matched: 1, applied: 0, dryRun: true })
    expect(api.friends.get).not.toHaveBeenCalled()
    expect(api.friends.addTag).not.toHaveBeenCalled()
    expect(api.friends.list).toHaveBeenCalledWith({ accountId: 'account-1', limit: 100, offset: 0 })
  })
  it('paginates and rechecks tags before writing, including on subsequent runs', async () => {
    const second = friend({ id: 'friend-2' })
    const api = client([friend(), second])
    api.friends.list.mockResolvedValueOnce({ items: [friend()], hasNextPage: true }).mockResolvedValueOnce({ items: [second], hasNextPage: false })
    api.friends.get.mockResolvedValueOnce(friend({ tags: [{ id: 'tag-1' }] })).mockResolvedValueOnce(second)
    api.friends.addTag.mockImplementation(async () => { second.tags.push({ id: 'tag-1' }) })
    expect((await applyTagRules(api, { ...options, dryRun: false })).applied).toBe(1)
    expect(api.friends.list).toHaveBeenNthCalledWith(2, { accountId: 'account-1', limit: 100, offset: 100 })
    expect(api.friends.addTag).toHaveBeenCalledWith('friend-2', 'tag-1')
    api.friends.list.mockResolvedValue({ items: [second], hasNextPage: false })
    expect((await applyTagRules(api, { ...options, dryRun: false })).applied).toBe(0)
    expect(api.friends.addTag).toHaveBeenCalledTimes(1)
  })
  it('fails before writes if the API leaks another account or the scan exceeds its limit', async () => {
    const api = client([friend(), friend({ id: 'wrong-account', lineAccountId: 'account-2' })])
    await expect(applyTagRules(api, { ...options, dryRun: false })).rejects.toThrow('アカウント')
    expect(api.friends.addTag).not.toHaveBeenCalled()
    api.friends.list.mockResolvedValue({ items: [friend()], hasNextPage: true })
    await expect(applyTagRules(api, { ...options, dryRun: false })).rejects.toThrow('1,000件')
    expect(api.friends.addTag).not.toHaveBeenCalled()
  })
  it('propagates write failures and rejects missing account selection', async () => {
    const api = client([friend()])
    api.friends.addTag.mockRejectedValue(new Error('API unavailable'))
    await expect(applyTagRules(api, { ...options, dryRun: false })).rejects.toThrow('API unavailable')
    api.friends.list.mockClear()
    await expect(applyTagRules(api, { ...options, accountId: '' })).rejects.toThrow('LINE_ACCOUNT_ID')
    expect(api.friends.list).not.toHaveBeenCalled()
  })
})
