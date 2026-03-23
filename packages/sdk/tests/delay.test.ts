import { describe, it, expect } from 'vitest'
import { parseDelay } from '../src/delay.js'

describe('parseDelay', () => {
  it.each([
    ['0m', 0],
    ['30m', 30],
    ['1h', 60],
    ['2h', 120],
    ['1d', 1440],
    ['3d', 4320],
    ['1w', 10080],
  ])('parses "%s" to %d minutes', (input, expected) => {
    expect(parseDelay(input)).toBe(expected)
  })

  it('throws on invalid format', () => {
    expect(() => parseDelay('abc')).toThrow('Invalid delay format')
    expect(() => parseDelay('')).toThrow('Invalid delay format')
    expect(() => parseDelay('5x')).toThrow('Invalid delay format')
  })
})
