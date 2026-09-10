import type { CfApiCreds } from '../types.js';
import { authHeader, d1QueryApiUrl, readBodyExcerpt } from './_shared.js';

/**
 * Cloudflare D1 Query API helper.
 *
 * Wraps `POST /accounts/{accountId}/d1/database/{databaseId}/query` so the
 * update engine can run schema migrations (and read back the version table)
 * against a customer's D1 instance using only their CF API token + account
 * id + database id — no `wrangler` binary required at runtime.
 *
 * Ordinary migrations use single statements. The legacy mileage adapter uses
 * one deliberate atomic multi-statement request so claims and its ledger stamp
 * either commit together or roll back together.
 */

/**
 * Execute SQL against a D1 database (including one deliberate atomic unit).
 *
 * Returns the raw Cloudflare API envelope (`{ success, result, ... }`) so
 * callers can inspect `result[0].results` for SELECT rows or `meta` for
 * row-counts on writes.
 *
 * Throws on non-2xx with the HTTP status and a truncated body excerpt so
 * caller logs always include the API's error reason.
 */
export async function executeD1Query(opts: {
  creds: CfApiCreds;
  databaseId: string;
  sql: string;
  params?: any[];
}): Promise<{ success: boolean; result: any[] }> {
  const { creds, databaseId, sql } = opts;
  const params = opts.params ?? [];

  const res = await fetch(d1QueryApiUrl(creds.accountId, databaseId), {
    method: 'POST',
    headers: {
      ...authHeader(creds.apiToken),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ sql, params }),
  });

  if (!res.ok) {
    // Legacy error shape kept on purpose: `HTTP <status>:` comes before the
    // body excerpt, whereas the shared `throwHttpError` puts the colon after
    // the prefix. Callers and logs depend on this exact wording.
    const excerpt = await readBodyExcerpt(res);
    throw new Error(`D1 query failed HTTP ${res.status}: ${excerpt}`);
  }

  const body = (await res.json()) as { success: boolean; result: any[] };
  if (body.success !== true || !Array.isArray(body.result) ||
      body.result.some((result) => result?.success === false)) {
    // An HTTP 200 alone is not proof that the SQL committed. Do not expose
    // provider error payloads here, which may include SQL or customer data.
    throw new Error('D1 query returned an unsuccessful SQL result');
  }
  return body;
}
