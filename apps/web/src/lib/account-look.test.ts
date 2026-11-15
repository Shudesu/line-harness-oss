import { describe, expect, it } from 'vitest'
import { INTERN_CHANNEL_ID, isInternAccount, isInternOnlyPage } from './account-look'

describe('isInternAccount', () => {
  it('KIDOUインターンの LINE のときだけ true', () => {
    expect(isInternAccount({ channelId: INTERN_CHANNEL_ID })).toBe(true)
    expect(isInternAccount({ channelId: '2008806062' })).toBe(false)
  })

  it('アカウントが決まっていないときは false', () => {
    expect(isInternAccount(null)).toBe(false)
    expect(isInternAccount(undefined)).toBe(false)
  })
})

describe('isInternOnlyPage', () => {
  it('友だち追加リンクと数字はインターン専用', () => {
    expect(isInternOnlyPage('/join-links')).toBe(true)
    expect(isInternOnlyPage('/intern-stats/')).toBe(true)
  })

  it('ほかの画面は対象外', () => {
    expect(isInternOnlyPage('/friends')).toBe(false)
    expect(isInternOnlyPage('/line-copy')).toBe(false)
    expect(isInternOnlyPage('/')).toBe(false)
  })
})
