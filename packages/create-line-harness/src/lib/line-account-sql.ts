/**
 * SQL builders for the `line_accounts` row the setup CLI registers.
 *
 * Kept out of `commands/setup.ts` so the statements can be asserted in a unit
 * test without driving the whole interactive flow.
 */

/**
 * Quote a value for inline SQL. The setup CLI writes statements to a file and
 * runs them through `wrangler d1 execute --file`, which has no parameter
 * binding, so values are escaped here instead.
 */
export function quoteSqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

export interface LineIdentitySqlOptions {
  /** Messaging API channel ID — identifies the row to update. */
  channelId: string;
  /** LINE Login channel ID (a different channel from the Messaging API one). */
  loginChannelId: string;
  /** LIFF ID in `<login channel id>-<random>` form. */
  liffId: string;
}

/**
 * Non-secret LINE identifiers stored on the account row.
 *
 * `liff_id` is not bookkeeping: the LIFF endpoints resolve the owning account
 * with `WHERE liff_id = ?` (booking, events), and `{{liff_id}}` in an auto-reply
 * is expanded from the receiving account's row — deliberately without falling
 * back to the global `LIFF_URL`, so one account never hands out another
 * account's LIFF link. Leaving the column NULL therefore breaks those paths on
 * a stock install even though the CLI already collected the value.
 *
 * `login_channel_id` and `liff_id` were both added by migration
 * `008_multi_account`, so a single statement is either fully applied or fully
 * skipped on an older schema.
 */
export function buildLineIdentitySql(options: LineIdentitySqlOptions): string {
  return (
    `UPDATE line_accounts SET login_channel_id = ${quoteSqlString(options.loginChannelId)}, ` +
    `liff_id = ${quoteSqlString(options.liffId)} ` +
    `WHERE channel_id = ${quoteSqlString(options.channelId)};`
  );
}
