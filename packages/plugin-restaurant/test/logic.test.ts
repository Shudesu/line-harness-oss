import { describe, expect, it } from 'vitest'
import {
  addStampToCard,
  buildOrderLines,
  dueReminders,
  formatJst,
  isBirthday,
  isWinbackTarget,
  isoToSqlite,
  jstParts,
  jstToUtcIso,
  randomCode,
  formatMemberNo,
  sqliteToIso,
  validatePickupTime,
} from '../src/lib/logic.js'
import { storeConfig } from '../src/env.js'

describe('jstParts / jstToUtcIso', () => {
  it('converts UTC to JST date parts', () => {
    // 2026-07-06 20:30 UTC = 2026-07-07 05:30 JST
    const parts = jstParts(new Date('2026-07-06T20:30:00Z'))
    expect(parts.date).toBe('2026-07-07')
    expect(parts.time).toBe('05:30')
    expect(parts.monthDay).toBe('07-07')
    expect(parts.year).toBe(2026)
  })

  it('converts JST wall clock to UTC ISO', () => {
    expect(jstToUtcIso('2026-07-08', '19:00')).toBe('2026-07-08T10:00:00.000Z')
  })

  it('roundtrips sqlite format', () => {
    const iso = '2026-07-08T10:00:00.000Z'
    expect(sqliteToIso(isoToSqlite(iso))).toBe('2026-07-08T10:00:00Z')
  })
})

describe('formatJst', () => {
  it('formats UTC ISO as JST Japanese string', () => {
    expect(formatJst('2026-07-08T10:00:00Z')).toBe('7月8日(水) 19:00')
  })
})

describe('addStampToCard', () => {
  it('increments below the goal', () => {
    expect(addStampToCard(3, 10)).toEqual({ newCount: 4, rewardEarned: false })
  })
  it('earns a reward and resets at the goal', () => {
    expect(addStampToCard(9, 10)).toEqual({ newCount: 0, rewardEarned: true })
  })
  it('handles goal of 1 (every visit is a reward)', () => {
    expect(addStampToCard(0, 1)).toEqual({ newCount: 0, rewardEarned: true })
  })
})

describe('isBirthday', () => {
  it('matches MM-DD', () => {
    expect(isBirthday('07-07', '07-07')).toBe(true)
    expect(isBirthday('07-08', '07-07')).toBe(false)
  })
  it('matches YYYY-MM-DD by month-day', () => {
    expect(isBirthday('1990-07-07', '07-07')).toBe(true)
  })
  it('treats Feb 29 birthdays as Feb 28 on non-leap years', () => {
    expect(isBirthday('02-29', '02-28')).toBe(true)
    expect(isBirthday('02-29', '02-29')).toBe(true)
  })
  it('rejects null and malformed values', () => {
    expect(isBirthday(null, '07-07')).toBe(false)
    expect(isBirthday('7月7日', '07-07')).toBe(false)
  })
})

describe('dueReminders', () => {
  // Reservation: 2026-07-08 19:00 JST = 2026-07-08T10:00:00Z
  const reservedAt = '2026-07-08T10:00:00.000Z'

  it('nothing due well before the day-before window', () => {
    // 2026-07-07 17:59 JST
    expect(dueReminders(reservedAt, new Date('2026-07-07T08:59:00Z'))).toEqual([])
  })

  it('day_before due from 18:00 JST the previous day', () => {
    // 2026-07-07 18:00 JST
    expect(dueReminders(reservedAt, new Date('2026-07-07T09:00:00Z'))).toEqual(['day_before'])
  })

  it('same_day due from 2 hours before', () => {
    // 2026-07-08 17:00 JST (2h before 19:00)
    expect(dueReminders(reservedAt, new Date('2026-07-08T08:00:00Z'))).toEqual(['day_before', 'same_day'])
  })

  it('nothing due once the reservation time has passed', () => {
    expect(dueReminders(reservedAt, new Date('2026-07-08T10:00:00Z'))).toEqual([])
    expect(dueReminders(reservedAt, new Date('2026-07-09T00:00:00Z'))).toEqual([])
  })
})

describe('isWinbackTarget', () => {
  const now = new Date('2026-07-06T00:00:00Z')
  it('true when the last visit is old enough', () => {
    expect(isWinbackTarget('2026-06-01T00:00:00Z', 30, now)).toBe(true)
  })
  it('false for recent visitors', () => {
    expect(isWinbackTarget('2026-06-20T00:00:00Z', 30, now)).toBe(false)
  })
  it('false when never visited', () => {
    expect(isWinbackTarget(null, 30, now)).toBe(false)
  })
})

describe('buildOrderLines', () => {
  const menu = [
    { id: 'a', name: '唐揚げ弁当', price: 800, is_available: 1 },
    { id: 'b', name: '焼き魚弁当', price: 900, is_available: 1 },
    { id: 'c', name: '売切弁当', price: 500, is_available: 0 },
  ]

  it('computes totals from server-side prices', () => {
    const r = buildOrderLines(menu, [{ id: 'a', qty: 2 }, { id: 'b', qty: 1 }])
    expect(r).toEqual({
      ok: true,
      lines: [
        { id: 'a', name: '唐揚げ弁当', price: 800, qty: 2 },
        { id: 'b', name: '焼き魚弁当', price: 900, qty: 1 },
      ],
      total: 2500,
    })
  })

  it('ignores zero-qty lines but rejects an all-zero order', () => {
    const r = buildOrderLines(menu, [{ id: 'a', qty: 2 }, { id: 'b', qty: 0 }])
    expect(r.ok && r.total).toBe(1600)
    expect(buildOrderLines(menu, [{ id: 'a', qty: 0 }]).ok).toBe(false)
  })

  it('rejects unavailable or unknown items and bad quantities', () => {
    expect(buildOrderLines(menu, [{ id: 'c', qty: 1 }]).ok).toBe(false)
    expect(buildOrderLines(menu, [{ id: 'zzz', qty: 1 }]).ok).toBe(false)
    expect(buildOrderLines(menu, [{ id: 'a', qty: 21 }]).ok).toBe(false)
    expect(buildOrderLines(menu, [{ id: 'a', qty: -1 }]).ok).toBe(false)
    expect(buildOrderLines(menu, []).ok).toBe(false)
  })
})

describe('validatePickupTime', () => {
  // now = 2026-07-06 18:00 JST
  const now = new Date('2026-07-06T09:00:00Z')

  it('accepts a time at least 15 minutes ahead (JST today)', () => {
    const r = validatePickupTime('19:00', now)
    expect(r).toEqual({ ok: true, iso: '2026-07-06T10:00:00.000Z' })
  })

  it('rejects times in the past or too soon', () => {
    expect(validatePickupTime('17:00', now).ok).toBe(false)
    expect(validatePickupTime('18:10', now).ok).toBe(false)
  })

  it('rejects malformed input', () => {
    expect(validatePickupTime('7pm', now).ok).toBe(false)
    expect(validatePickupTime('', now).ok).toBe(false)
  })
})

describe('codes', () => {
  it('randomCode uses only unambiguous characters', () => {
    const bytes = new Uint8Array(64)
    for (let i = 0; i < bytes.length; i++) bytes[i] = i * 7
    const code = randomCode(64, bytes)
    expect(code).toHaveLength(64)
    expect(code).not.toMatch(/[01OIL]/)
  })
  it('formats member numbers with zero padding', () => {
    expect(formatMemberNo(123)).toBe('R-000123')
  })
})

describe('storeConfig phone notification gating', () => {
  const base = {
    DB: {} as never,
    LINE_HARNESS_API_URL: 'https://example.com',
    LINE_HARNESS_API_KEY: 'k',
    LIFF_ID: 'liff',
    STORE_NAME: 'テスト食堂',
    STAMP_GOAL: '10',
    REWARD_NAME: '特典',
    WINBACK_DAYS: '30',
    STAFF_PIN: '0000',
    PLUGIN_API_KEY: 'pk',
  }

  it('disables all phone channels by default', () => {
    const config = storeConfig({ ...base })
    expect(config.callmebotUser).toBeNull()
    expect(config.callmebotPhone).toBeNull()
    expect(config.clicksend).toBeNull()
    expect(config.twilio).toBeNull()
  })

  it('enables callmebot phone only when number and apikey are both set', () => {
    expect(storeConfig({ ...base, CALLMEBOT_PHONE_NUMBER: '+819000000000' }).callmebotPhone).toBeNull()
    expect(storeConfig({ ...base, CALLMEBOT_PHONE_APIKEY: 'key' }).callmebotPhone).toBeNull()
    const config = storeConfig({ ...base, CALLMEBOT_PHONE_NUMBER: ' +819000000000 ', CALLMEBOT_PHONE_APIKEY: ' key ' })
    expect(config.callmebotPhone).toEqual({ number: '+819000000000', apiKey: 'key' })
  })

  it('enables clicksend only when username, apikey and store phone are all set', () => {
    expect(storeConfig({ ...base, CLICKSEND_USERNAME: 'u', CLICKSEND_API_KEY: 'k2' }).clicksend).toBeNull()
    const config = storeConfig({
      ...base,
      CLICKSEND_USERNAME: 'u',
      CLICKSEND_API_KEY: 'k2',
      STORE_PHONE_NUMBER: '+815000000000',
    })
    expect(config.clicksend).toEqual({ username: 'u', apiKey: 'k2', to: '+815000000000' })
  })

  it('enables twilio only when all four variables are set', () => {
    expect(
      storeConfig({ ...base, TWILIO_ACCOUNT_SID: 'AC1', TWILIO_AUTH_TOKEN: 't', TWILIO_FROM_NUMBER: '+815011111111' })
        .twilio,
    ).toBeNull()
    const config = storeConfig({
      ...base,
      TWILIO_ACCOUNT_SID: 'AC1',
      TWILIO_AUTH_TOKEN: 't',
      TWILIO_FROM_NUMBER: '+815011111111',
      STORE_PHONE_NUMBER: '+815000000000',
    })
    expect(config.twilio).toEqual({ accountSid: 'AC1', authToken: 't', from: '+815011111111', to: '+815000000000' })
  })
})
