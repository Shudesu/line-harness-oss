/**
 * account_settings table helpers.
 *
 * The table stores arbitrary key/value pairs keyed by (line_account_id, key).
 * Each setting is a JSON-encoded string so the column type never changes.
 */

/**
 * Retrieve a raw setting value (JSON string) for an account.
 * Returns null when the key is not set.
 */
export async function getAccountSetting(
  db: D1Database,
  accountId: string,
  key: string,
): Promise<string | null> {
  const row = await db
    .prepare(`SELECT value FROM account_settings WHERE line_account_id = ? AND key = ?`)
    .bind(accountId, key)
    .first<{ value: string }>();
  return row?.value ?? null;
}

/**
 * Upsert a raw setting value (JSON string) for an account.
 */
export async function setAccountSetting(
  db: D1Database,
  accountId: string,
  key: string,
  value: string,
): Promise<void> {
  const id = crypto.randomUUID();
  const now = new Date(Date.now() + 9 * 60 * 60_000)
    .toISOString()
    .replace('Z', '+09:00');

  await db
    .prepare(
      `INSERT INTO account_settings (id, line_account_id, key, value, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (line_account_id, key) DO UPDATE SET value = ?, updated_at = ?`,
    )
    .bind(id, accountId, key, value, now, now, value, now)
    .run();
}

// ── URL settings (link_base_url / tracked_link_base_url) ─────────────────────

const LINK_BASE_URL_KEY = 'link_base_url';
const TRACKED_LINK_BASE_URL_KEY = 'tracked_link_base_url';

async function getUrlSetting(
  db: D1Database,
  accountId: string,
  key: string,
): Promise<string | null> {
  const raw = await getAccountSetting(db, accountId, key);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as string;
  } catch {
    return null;
  }
}

/**
 * Validate and persist an https URL setting.
 *
 * Rules:
 *  - Empty string clears the setting (returns without storing).
 *  - Must start with "https://".
 *  - Trailing slash is stripped before saving.
 *
 * Throws a descriptive Error on validation failure.
 */
async function setUrlSetting(
  db: D1Database,
  accountId: string,
  key: string,
  value: string,
): Promise<void> {
  const trimmed = value.trim();

  if (trimmed === '') {
    // Clear the setting.
    await db
      .prepare(
        `DELETE FROM account_settings WHERE line_account_id = ? AND key = ?`,
      )
      .bind(accountId, key)
      .run();
    return;
  }

  if (!trimmed.startsWith('https://')) {
    throw new Error(`${key} must start with https://`);
  }

  const normalized = trimmed.replace(/\/$/, '');
  await setAccountSetting(db, accountId, key, JSON.stringify(normalized));
}

/**
 * Get the configured short-link base URL for an account (affiliate links).
 * Returns null when not set (caller should fall back to WORKER_URL/r).
 * The stored value has no trailing slash.
 */
export async function getLinkBaseUrl(
  db: D1Database,
  accountId: string,
): Promise<string | null> {
  return getUrlSetting(db, accountId, LINK_BASE_URL_KEY);
}

export async function setLinkBaseUrl(
  db: D1Database,
  accountId: string,
  value: string,
): Promise<void> {
  return setUrlSetting(db, accountId, LINK_BASE_URL_KEY, value);
}

/**
 * Get the configured base URL for message tracked links (/t/...).
 * When set, auto-tracked message URLs are built as `${base}/t/<code>` instead
 * of `${WORKER_URL}/t/<code>`. The domain must route /t/* to the Worker
 * (Redirect Rule or Custom Domain). Returns null when not set.
 *
 * Kept separate from link_base_url on purpose: existing deployments map that
 * domain's root paths to /r/ (affiliate), so silently reusing it for /t/
 * would emit broken URLs on upgrade.
 */
export async function getTrackedLinkBaseUrl(
  db: D1Database,
  accountId: string,
): Promise<string | null> {
  return getUrlSetting(db, accountId, TRACKED_LINK_BASE_URL_KEY);
}

export async function setTrackedLinkBaseUrl(
  db: D1Database,
  accountId: string,
  value: string,
): Promise<void> {
  return setUrlSetting(db, accountId, TRACKED_LINK_BASE_URL_KEY, value);
}
