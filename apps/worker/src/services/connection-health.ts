/**
 * Connection health — PLAN.md 1-1 (onboarding-screening) contract for LINE.
 *
 * GET /api/line-accounts/:id/connection-health and MCP account_summary share
 * this JSON:
 *
 *   { checkedAt, accountId, platform, overall, checks: [{ id, status, summary,
 *     evidence, nextAction: { kind, label, tool?, args?, docs? } }] }
 *
 * status: ok | warn | fail | unknown | manual
 * kind:   auto | approve | handoff | human_console | human_auth
 *
 * Sources: account_settings KVS records written by the webhook route
 * (signature failures/successes), the token-refresh cron (refresh failures),
 * ban-monitor (401s), and the B-10 webhook endpoint/test probes. `refresh`
 * re-runs the live LINE webhook endpoint + test checks on the spot.
 */

import type { LineClient } from '@line-crm/line-sdk';
import type { LineAccount } from '@line-crm/db';
import {
  getSignatureFailureWindow,
  getSignatureSuccessAt,
  getTokenRefreshFailureWindow,
  getTokenUnauthorizedWindow,
  getWebhookEndpointCheck,
  getWebhookTest,
  jstNow,
  UNATTRIBUTED_ACCOUNT_ID,
  type WebhookEndpointCheckRecord,
  type WebhookTestRecord,
} from '@line-crm/db';
import { probeWebhookEndpoint } from './webhook-endpoint.js';

export type CheckStatus = 'ok' | 'warn' | 'fail' | 'unknown' | 'manual';
export type NextActionKind = 'auto' | 'approve' | 'handoff' | 'human_console' | 'human_auth';

export interface ConnectionCheckNextAction {
  kind: NextActionKind;
  label: string;
  tool?: string;
  args?: Record<string, unknown>;
  docs?: string;
}

export interface ConnectionCheck {
  id: string;
  status: CheckStatus;
  summary: string;
  evidence: Record<string, unknown>;
  nextAction?: ConnectionCheckNextAction;
}

export interface ConnectionHealth {
  checkedAt: string;
  accountId: string;
  platform: 'line';
  overall: 'ok' | 'warn' | 'fail';
  checks: ConnectionCheck[];
}

const HOUR_MS = 60 * 60_000;

function isWithinWindow(iso: string | null, windowMs: number, now: number): boolean {
  if (!iso) return false;
  const t = new Date(iso).getTime();
  return Number.isFinite(t) && now - t < windowMs;
}

function isStale(iso: string | null | undefined, staleAfterMs: number, now: number): boolean {
  if (!iso) return true;
  const t = new Date(iso).getTime();
  return !Number.isFinite(t) || now - t > staleAfterMs;
}

const SECRET_DOCS = 'LINE Developers コンソール > Messaging API > チャネル基本設定';

// ── Individual checks ────────────────────────────────────────────────────────

function signatureCheck(
  failures1h: number,
  lastFailureAt: string | null,
  lastSuccessAt: string | null,
  now: number,
): ConnectionCheck {
  const hasRecentSuccess = isWithinWindow(lastSuccessAt, HOUR_MS, now);
  let status: CheckStatus = 'ok';
  let summary = '直近60分の署名検証失敗はありません';
  if (failures1h > 0 && !hasRecentSuccess) {
    status = 'fail';
    summary = `直近60分の署名検証失敗 ${failures1h} 件・成功 0 件。Webhook は 200 で受け止めた後、全イベントを破棄しています`;
  } else if (failures1h > 0) {
    status = 'warn';
    summary = `直近60分の署名検証失敗 ${failures1h} 件（正常な受信もあり）`;
  }
  return {
    id: 'line.webhook.signature',
    status,
    summary,
    evidence: { failures1h, lastFailureAt, lastSuccessAt },
    ...(status === 'ok'
      ? {}
      : {
          nextAction: {
            kind: 'human_console' as const,
            label: 'Channel secret を確認・更新する',
            docs: `${SECRET_DOCS}。「Issue/再発行」で secret を確認し、管理画面のアカウント編集で差し替えてください`,
          },
        }),
  };
}

function tokenRefreshCheck(
  failures24h: number,
  lastFailureAt: string | null,
  lastReason: string | null,
  now: number,
): ConnectionCheck {
  const recent = failures24h > 0 && isWithinWindow(lastFailureAt, 24 * HOUR_MS, now);
  return {
    id: 'line.token.refresh',
    status: recent ? 'fail' : 'ok',
    summary: recent
      ? `直近24時間にアクセストークンの再発行失敗 ${failures24h} 件${lastReason ? `（最終: ${lastReason}）` : ''}。失効すると全送信が止まります`
      : 'トークン再発行の失敗は記録されていません',
    evidence: { failures24h, lastFailureAt, lastReason },
    ...(recent
      ? {
          nextAction: {
            kind: 'human_console' as const,
            label: 'チャネル ID / Channel secret を確認してトークンを貼り直す',
            docs: `${SECRET_DOCS}。チャネル ID と Channel secret が一致しているか確認してください`,
          } satisfies ConnectionCheckNextAction,
        }
      : {}),
  };
}

function botInfoCheck(
  unauthorized1h: number,
  lastUnauthorizedAt: string | null,
  riskLevel: string | null,
  now: number,
): ConnectionCheck {
  const recent = unauthorized1h > 0 && isWithinWindow(lastUnauthorizedAt, HOUR_MS, now);
  return {
    id: 'line.bot_info',
    status: recent ? 'fail' : 'ok',
    summary: recent
      ? 'bot/info が 401 を返しています。アクセストークンが失効・無効化されています'
      : 'bot/info の疎通は正常です（401 は記録されていません）',
    evidence: { unauthorized1h, lastUnauthorizedAt, riskLevel },
    ...(recent
      ? {
          nextAction: {
            kind: 'human_console' as const,
            label: 'トークンを再発行して管理画面に貼り直す',
            docs: `${SECRET_DOCS}。トークンの自動再発行が失敗していないか line.token.refresh も確認してください`,
          } satisfies ConnectionCheckNextAction,
        }
      : {}),
  };
}

function webhookEndpointCheck(
  record: WebhookEndpointCheckRecord | null,
  now: number,
  accountId: string,
): ConnectionCheck {
  const id = 'line.webhook.endpoint';
  if (!record) {
    return {
      id,
      status: 'manual',
      summary: 'Webhook URL の一致・active 状態はまだ確認されていません',
      evidence: {},
      nextAction: {
        kind: 'auto' as const,
        label: 'Webhook endpoint を確認する',
        tool: 'manage_webhook_endpoint',
        args: { action: 'check', accountId },
      },
    };
  }
  const stale = isStale(record.checkedAt, 24 * HOUR_MS, now);
  let status: CheckStatus;
  let summary: string;
  let nextAction: ConnectionCheckNextAction | undefined;
  if (record.matches === null) {
    // null = the probe itself failed. Network exceptions carry no HTTP status,
    // so this branch must not depend on errorStatus being set — a probe that
    // could not run is 'unknown', never silently healthy.
    status = 'unknown';
    summary =
      record.errorStatus !== undefined
        ? `Webhook URL の確認が LINE API エラーで失敗しました（${record.errorStatus}）`
        : 'Webhook URL の確認が通信エラーで失敗しました';
  } else if (record.matches === false) {
    status = 'fail';
    summary = record.endpoint
      ? 'LINE チャネルの Webhook URL がこの Worker と一致しません（イベントが別の場所へ届いています）'
      : 'LINE チャネルに Webhook URL が登録されていません（イベントが届きません）';
    nextAction = {
      kind: 'approve',
      label: 'Webhook URL をこの Worker に向ける（confirm 必須）',
      tool: 'manage_webhook_endpoint',
      args: { action: 'set', accountId },
    };
  } else if (record.active === false) {
    status = 'fail';
    summary = 'Webhook URL は一致していますが「Webhookの利用」がオフです';
    nextAction = {
      kind: 'human_console' as const,
      label: '「Webhookの利用」をオンにする',
      docs: `${SECRET_DOCS} > Messaging API 設定 > Webhook設定`,
    };
  } else if (stale) {
    status = 'warn';
    summary = 'Webhook URL の一致・active は確認済みですが、最終確認が24時間以上前です';
    nextAction = {
      kind: 'auto' as const,
      label: 'Webhook endpoint を再確認する',
      tool: 'manage_webhook_endpoint',
      args: { action: 'check', accountId },
    };
  } else {
    status = 'ok';
    summary = 'Webhook URL はこの Worker と一致し、「Webhookの利用」はオンです';
  }
  return {
    id,
    status,
    summary,
    evidence: {
      endpoint: record.endpoint,
      expectedUrl: record.expectedUrl,
      matches: record.matches,
      active: record.active,
      checkedAt: record.checkedAt,
    },
    ...(nextAction ? { nextAction } : {}),
  };
}

function webhookTestCheck(
  record: WebhookTestRecord | null,
  endpointRecord: WebhookEndpointCheckRecord | null,
  now: number,
  accountId: string,
): ConnectionCheck {
  const id = 'line.webhook.test';
  if (!record) {
    return {
      id,
      status: 'manual',
      summary: 'LINE の疎通テスト（/v2/bot/channel/webhook/test）はまだ実行されていません',
      evidence: {},
      nextAction: {
        kind: 'auto' as const,
        label: 'Webhook の疎通テストを実行する',
        tool: 'manage_webhook_endpoint',
        args: { action: 'check', accountId },
      },
    };
  }
  // The test result is only meaningful when the endpoint check was OK at the
  // same probe; a stale/failed endpoint invalidates an old success.
  const endpointOk = endpointRecord?.matches === true && endpointRecord.active === true;
  const stale = isStale(record.checkedAt, 24 * HOUR_MS, now);
  let status: CheckStatus;
  let summary: string;
  if (record.success === true && endpointOk && !stale) {
    status = 'ok';
    summary = 'LINE の疎通テストに成功しています';
  } else if (record.success === true && stale) {
    status = 'warn';
    summary = '疎通テストに成功していますが、実行から24時間以上経っています';
  } else if (record.success === false) {
    status = 'fail';
    summary = `LINE の疎通テストに失敗しています${record.message ? `（${record.message}）` : ''}`;
  } else {
    // success === null: the test could not be executed (LINE API error or a
    // network exception without a status). An execution failure is unknown,
    // not a failed delivery.
    status = 'unknown';
    summary =
      record.errorStatus !== undefined
        ? `疎通テストが LINE API エラーで失敗しました（${record.errorStatus}）`
        : '疎通テストを実行できませんでした（通信エラー）';
  }
  return {
    id,
    status,
    summary,
    evidence: { success: record.success, message: record.message, checkedAt: record.checkedAt },
    ...(status === 'ok'
      ? {}
      : {
          nextAction: {
            kind: 'auto' as const,
            label: 'Webhook の確認と疎通テストを再実行する',
            tool: 'manage_webhook_endpoint',
            args: { action: 'check', accountId },
          } satisfies ConnectionCheckNextAction,
        }),
  };
}

function unattributedSignatureCheck(
  failures1h: number,
  lastAt: string | null,
  now: number,
): ConnectionCheck {
  return {
    id: 'line.webhook.signature.unattributed',
    status: 'warn',
    summary: `複数アカウント構成で、登録されたどの Channel secret とも一致しない署名の受信が直近60分に ${failures1h} 件あります（どのチャネルか特定できません）。該当チャネルはイベントを全て破棄している可能性があります`,
    evidence: { failures1h, lastAt },
    nextAction: {
      kind: 'human_console' as const,
      label: '各チャネルの Channel secret を確認する',
      docs: `${SECRET_DOCS}。全アカウントの Channel secret と管理画面の設定の一致を確認してください`,
    },
  };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export interface BuildConnectionHealthOptions {
  /** Re-run the live LINE webhook endpoint + test probes before answering. */
  refresh?: boolean;
  /** Client for the live probes (required with refresh). */
  client?: Pick<LineClient, 'getWebhookEndpoint' | 'testWebhookEndpoint'>;
  /** Expected webhook URL (required with refresh). */
  expectedUrl?: string;
  /** Latest risk level from account_health_logs (ban-monitor), if known. */
  riskLevel?: string | null;
}

export async function buildConnectionHealth(
  db: D1Database,
  account: LineAccount,
  opts: BuildConnectionHealthOptions = {},
): Promise<ConnectionHealth> {
  const now = Date.now();
  const checkedAt = jstNow();

  if (opts.refresh && opts.client && opts.expectedUrl) {
    // probeWebhookEndpoint never throws and persists both KVS records.
    await probeWebhookEndpoint(db, opts.client, account.id, opts.expectedUrl);
  }

  const [
    sigFail,
    sigSuccessAt,
    unattributedSigFail,
    refreshFail,
    unauthorized,
    endpointRecord,
    testRecord,
  ] = await Promise.all([
    getSignatureFailureWindow(db, account.id, 1),
    getSignatureSuccessAt(db, account.id),
    // Multi-account installs record signature mismatches that match no
    // registered secret under the unattributed sentinel — surface them so
    // "some channel is discarding everything" is visible somewhere.
    getSignatureFailureWindow(db, UNATTRIBUTED_ACCOUNT_ID, 1),
    getTokenRefreshFailureWindow(db, account.id, 24),
    getTokenUnauthorizedWindow(db, account.id, 1),
    getWebhookEndpointCheck(db, account.id),
    getWebhookTest(db, account.id),
  ]);

  const checks: ConnectionCheck[] = [
    signatureCheck(sigFail.failures, sigFail.lastAt, sigSuccessAt, now),
    tokenRefreshCheck(refreshFail.failures, refreshFail.lastAt, refreshFail.lastReason, now),
    botInfoCheck(unauthorized.failures, unauthorized.lastAt, opts.riskLevel ?? null, now),
    webhookEndpointCheck(endpointRecord, now, account.id),
    webhookTestCheck(testRecord, endpointRecord, now, account.id),
  ];
  if (unattributedSigFail.failures > 0) {
    checks.push(
      unattributedSignatureCheck(unattributedSigFail.failures, unattributedSigFail.lastAt, now),
    );
  }

  const overall = checks.some((c) => c.status === 'fail')
    ? 'fail'
    : checks.some((c) => c.status === 'warn')
      ? 'warn'
      : // 'unknown' = a probe could not run / could not be read. An account
        // with nothing verified yet (manual-only checks) stays ok, but any
        // check that tried and failed to verify must not read as healthy.
        checks.some((c) => c.status === 'unknown')
        ? 'warn'
        : 'ok';

  return { checkedAt, accountId: account.id, platform: 'line', overall, checks };
}
