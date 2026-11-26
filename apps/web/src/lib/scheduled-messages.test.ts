import { describe, expect, it } from 'vitest'
import { formatJst, jstLocalInputToIso, toJstLocalInput } from './scheduled-messages'

describe('scheduled message JST helpers', () => {
  it('treats the picker value as JST regardless of browser timezone', () => {
    expect(jstLocalInputToIso('2026-11-20T19:00')).toBe('2026-11-20T19:00:00+09:00')
    expect(Date.parse(jstLocalInputToIso('2026-11-20T19:00')!)).toBe(Date.parse('2026-11-20T10:00:00Z'))
    expect(jstLocalInputToIso('2026-11-20 19:00')).toBeNull()
    expect(jstLocalInputToIso('')).toBeNull()
  })
  it('round-trips and formats in JST', () => {
    expect(toJstLocalInput(new Date('2026-11-20T10:00:00Z'))).toBe('2026-11-20T19:00')
    expect(formatJst('2026-11-20T10:00:00.000Z')).toBe('11/20(金) 19:00')
    expect(formatJst('2026-11-20T16:30:00.000Z')).toBe('11/21(土) 01:30')
  })
})
