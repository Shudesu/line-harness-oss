/**
 * Webhook endpoint probe/fix (B-10).
 *
 * Ported from lharness-cloud/src/automation/line-setup.ts: read the webhook
 * URL registered on the LINE channel (GET /v2/bot/channel/webhook/endpoint),
 * verify it points at this Worker and is active, and run LINE's own
 * /webhook/test to confirm end-to-end delivery. Setting the URL is an
 * explicit, confirmed mutation — never a silent overwrite (see
 * setWebhookEndpointWithConfirm: an existing foreign URL requires confirm).
 *
 * Results are persisted in the account_settings KVS (`health:webhook_endpoint`
 * / `health:webhook_test`) so the connection-health endpoint can report the
 * last probe without calling LINE again.
 */

import type { LineClient, WebhookEndpointSetting, WebhookTestResult } from '@line-crm/line-sdk';
import {
  jstNow,
  recordWebhookEndpointCheck,
  recordWebhookTest,
  type WebhookEndpointCheckRecord,
  type WebhookTestRecord,
} from '@line-crm/db';

export interface WebhookEndpointProbe {
  checkedAt: string;
  expectedUrl: string;
  endpoint: string;
  active: boolean | null;
  matches: boolean | null;
  test: { success: boolean | null; message: string | null };
  /** 'unknown' = the probe itself failed (LINE API error / no token). */
  status: 'ok' | 'fail' | 'unknown';
  /** LINE API status code when the probe failed. Never a response body. */
  errorStatus?: number;
  /** Short human hint; safe to surface (no secrets, no raw bodies). */
  warning?: string;
}

/** Expected webhook URL for this Worker. */
export function expectedWebhookUrl(workerUrl: string | undefined, requestOrigin?: string): string {
  const base = (workerUrl || requestOrigin || '').trim().replace(/\/+$/, '');
  return `${base}/webhook`;
}

/** Truncate a LINE-returned message to a bounded, secret-free hint. */
function boundedMessage(message: string | undefined | null): string | null {
  if (!message) return null;
  return message.length > 200 ? `${message.slice(0, 200)}…` : message;
}

/**
 * Read + test the channel's webhook configuration and persist the result.
 * Never throws: LINE API failures degrade to status 'unknown' so a temporary
 * outage cannot fail account registration or an admin request.
 */
export async function probeWebhookEndpoint(
  db: D1Database,
  client: Pick<LineClient, 'getWebhookEndpoint' | 'testWebhookEndpoint'>,
  accountId: string,
  expectedUrl: string,
): Promise<WebhookEndpointProbe> {
  const checkedAt = jstNow();
  let setting: WebhookEndpointSetting | null = null;
  let endpointError: number | undefined;
  try {
    setting = await client.getWebhookEndpoint();
  } catch (err) {
    endpointError = (err as { status?: number }).status;
  }

  const endpoint = setting?.endpoint ?? '';
  const active = setting ? setting.active === true : null;
  const matches = setting ? endpoint === expectedUrl : null;

  // Only run the delivery test when the URL looks ours; testing a foreign
  // endpoint would POST a test event at someone else's receiver.
  let test: WebhookEndpointProbe['test'] = { success: null, message: null };
  if (setting && matches && active) {
    let testResult: WebhookTestResult | null = null;
    let testError: number | undefined;
    try {
      testResult = await client.testWebhookEndpoint();
    } catch (err) {
      testError = (err as { status?: number }).status;
    }
    test = testResult
      ? { success: testResult.success === true, message: boundedMessage(testResult.message) }
      : { success: null, message: null };
    try {
      const record: WebhookTestRecord = {
        checkedAt: jstNow(),
        // null = the test could not be executed (network/API failure); the
        // connection-health check maps that to 'unknown', not 'fail'.
        success: test.success,
        message: test.message,
        ...(testError !== undefined ? { errorStatus: testError } : {}),
      };
      await recordWebhookTest(db, accountId, record);
    } catch (err) {
      console.error('[webhook-endpoint] failed to record webhook test result', err);
    }
  }

  let warning: string | undefined;
  if (!setting) {
    warning = 'LINE API から Webhook URL を取得できませんでした（トークンまたは権限を確認してください）';
  } else if (!matches) {
    warning = endpoint
      ? 'LINE チャネルに登録された Webhook URL がこの Worker と一致しません。勝手に上書きはしません'
      : 'LINE チャネルに Webhook URL が登録されていません';
  } else if (!active) {
    warning = 'Webhook URL は一致していますが「Webhookの利用」がオフです';
  } else if (test.success === false) {
    warning = `LINE の疎通テストに失敗しました${test.message ? `: ${test.message}` : ''}`;
  }

  const probe: WebhookEndpointProbe = {
    checkedAt,
    expectedUrl,
    endpoint,
    active,
    matches,
    test,
    // Execution failures (test.success === null) are 'unknown', not 'ok':
    // "couldn't run the test" must never read as "the channel works".
    status: !setting
      ? 'unknown'
      : !matches || !active
        ? 'fail'
        : test.success === true
          ? 'ok'
          : test.success === false
            ? 'fail'
            : 'unknown',
    ...(endpointError !== undefined ? { errorStatus: endpointError } : {}),
    ...(warning ? { warning } : {}),
  };

  try {
    const record: WebhookEndpointCheckRecord = {
      checkedAt,
      endpoint,
      expectedUrl,
      matches,
      active,
      ...(endpointError !== undefined ? { errorStatus: endpointError } : {}),
    };
    await recordWebhookEndpointCheck(db, accountId, record);
  } catch (err) {
    console.error('[webhook-endpoint] failed to record webhook endpoint check', err);
  }

  return probe;
}

export interface SetWebhookEndpointOutcome {
  ok: boolean;
  /** The caller must re-issue with confirm=true to proceed. */
  requiresConfirm?: boolean;
  probe?: WebhookEndpointProbe;
  error?: string;
}

/**
 * Overwrite the channel's webhook URL after explicit confirmation.
 * The existing URL is read first: when it is set and differs from the target,
 * the caller must pass confirm=true (MCP side reports this as a warning and
 * requires the confirm parameter). Empty endpoint also requires confirm —
 * configuring a webhook is a mutation of the channel either way.
 *
 * `expectedUrl` is this Worker's own webhook URL and is kept separate from
 * `endpoint` (the URL being configured) on purpose: the post-set probe and the
 * persisted health record must judge the channel against the Worker's real
 * URL, so pointing the channel at some other service can never be recorded as
 * "matches this Worker".
 */
export async function setWebhookEndpointWithConfirm(
  db: D1Database,
  client: Pick<LineClient, 'getWebhookEndpoint' | 'setWebhookEndpoint' | 'testWebhookEndpoint'>,
  accountId: string,
  endpoint: string,
  confirm: boolean,
  expectedUrl: string,
): Promise<SetWebhookEndpointOutcome> {
  let current: WebhookEndpointSetting | null = null;
  let currentError: number | undefined;
  try {
    current = await client.getWebhookEndpoint();
  } catch (err) {
    currentError = (err as { status?: number }).status;
  }

  const existing = current?.endpoint ?? '';
  const foreign = existing !== '' && existing !== endpoint;
  if (!confirm) {
    return {
      ok: false,
      requiresConfirm: true,
      error: foreign
        ? '既存の Webhook URL が別の URL に向いています。confirm=true を付けないと上書きしません'
        : 'Webhook URL の設定は明示的な確認が必要です。confirm=true を付けて再実行してください',
    };
  }

  try {
    await client.setWebhookEndpoint(endpoint);
  } catch (err) {
    const status = (err as { status?: number }).status;
    return {
      ok: false,
      error: `LINE API による Webhook URL の設定に失敗しました（${status ?? 'unknown'}）`,
    };
  }

  // Probe against the Worker's expected URL, not the configured target: a
  // target that deliberately points elsewhere must surface as matches=false
  // in the health record instead of validating itself.
  const probe = await probeWebhookEndpoint(db, client, accountId, expectedUrl);
  if (currentError !== undefined) {
    // The pre-read failed but the write succeeded — surface it for honesty.
    return { ok: probe.status === 'ok', probe, error: undefined };
  }
  return { ok: probe.status === 'ok', probe };
}
