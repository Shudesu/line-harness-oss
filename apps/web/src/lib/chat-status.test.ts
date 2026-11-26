import { describe, expect, it } from 'vitest'
import { acknowledgeChatInList, shouldAcknowledgeOnOpen, type ChatStatus } from './chat-status'

const chat = (id: string, status: ChatStatus) => ({ id, status })

describe('shouldAcknowledgeOnOpen', () => {
  it('only moves unread chats forward', () => {
    expect(shouldAcknowledgeOnOpen('unread')).toBe(true)
    expect(shouldAcknowledgeOnOpen('in_progress')).toBe(false)
    expect(shouldAcknowledgeOnOpen('resolved')).toBe(false)
  })
})

describe('acknowledgeChatInList', () => {
  it('turns the opened unread chat into in_progress and leaves the others alone', () => {
    const list = [chat('a', 'unread'), chat('b', 'unread')]
    expect(acknowledgeChatInList(list, 'a')).toEqual([chat('a', 'in_progress'), chat('b', 'unread')])
  })

  it('does not overwrite a status the operator already set', () => {
    const list = [chat('a', 'resolved'), chat('b', 'in_progress')]
    expect(acknowledgeChatInList(list, 'a')).toBe(list)
    expect(acknowledgeChatInList(list, 'b')).toBe(list)
  })

  it('returns the same list when the chat is not in it', () => {
    const list = [chat('a', 'unread')]
    expect(acknowledgeChatInList(list, 'zzz')).toBe(list)
  })
})
