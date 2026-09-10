import { describe, it, expect } from 'vitest';
import { buildLineIdentitySql, quoteSqlString } from '../src/lib/line-account-sql.js';

const CHANNEL_ID = '2011000001';
const LOGIN_CHANNEL_ID = '2011000002';
const LIFF_ID = '2011000002-ab12CD34';

describe('quoteSqlString', () => {
  it('wraps the value in single quotes', () => {
    expect(quoteSqlString('2011000001')).toBe("'2011000001'");
  });

  it('doubles embedded single quotes', () => {
    expect(quoteSqlString("O'Brien")).toBe("'O''Brien'");
  });
});

describe('buildLineIdentitySql', () => {
  it('sets both login_channel_id and liff_id', () => {
    const sql = buildLineIdentitySql({
      channelId: CHANNEL_ID,
      loginChannelId: LOGIN_CHANNEL_ID,
      liffId: LIFF_ID,
    });

    // liff_id is what the LIFF booking/event endpoints look the account up by
    // (`WHERE liff_id = ?`), so a setup run that skips it leaves those screens
    // answering `unknown_liff`.
    expect(sql).toContain(`login_channel_id = '${LOGIN_CHANNEL_ID}'`);
    expect(sql).toContain(`liff_id = '${LIFF_ID}'`);
  });

  it('scopes the update to the Messaging API channel that was just registered', () => {
    const sql = buildLineIdentitySql({
      channelId: CHANNEL_ID,
      loginChannelId: LOGIN_CHANNEL_ID,
      liffId: LIFF_ID,
    });

    expect(sql).toContain(`WHERE channel_id = '${CHANNEL_ID}'`);
    expect(sql.endsWith(';')).toBe(true);
  });

  it('escapes values instead of interpolating them raw', () => {
    const sql = buildLineIdentitySql({
      channelId: CHANNEL_ID,
      loginChannelId: LOGIN_CHANNEL_ID,
      liffId: "2011000002-ab'12",
    });

    expect(sql).toContain("liff_id = '2011000002-ab''12'");
  });
});
