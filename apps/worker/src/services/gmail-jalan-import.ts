import {
  createGmailImportRun,
  finishGmailImportRun,
  getGmailImportRuleById,
  getReservationMenuById,
  getReservationResourceById,
  importExternalReservation,
  listGmailImportRules,
  listReservationSlots,
  markGmailImportRuleRunAt,
  type GmailImportRule,
  type ImportExternalReservationResult,
} from '@line-crm/db';
import { getUsableGoogleCalendarConnection, type GoogleOAuthEnv } from './google-oauth.js';
import type { SecretLike } from './bindings.js';
import { GoogleGmailClient, type GmailLabel, type GmailMessageText } from './google-gmail.js';
import { parseJalanMail } from './jalan-mail-parser.js';
import {
  syncReservationCancelledToGoogleCalendar,
  syncReservationCreatedToGoogleCalendar,
} from './reservation-google-calendar.js';
import {
  notifyExternalReviewToDiscord,
  notifyReservationToDiscord,
} from './discord-notifications.js';

export interface GmailJalanImportEnv extends GoogleOAuthEnv {
  WORKER_URL?: SecretLike;
  WEB_URL?: SecretLike;
  NEXT_PUBLIC_WEB_URL?: SecretLike;
}

export interface RunGmailImportOptions {
  dryRun?: boolean;
  maxResults?: number;
}

export interface GmailImportItemResult {
  gmailMessageId: string;
  eventType: string;
  parseStatus: 'imported' | 'duplicate' | 'cancelled' | 'needs_review' | 'failed' | 'dry_run';
  reservationId?: string | null;
  externalId?: string | null;
  error?: string | null;
}

export interface GmailImportRunResult {
  runId: string | null;
  ruleId: string;
  dryRun: boolean;
  fetchedCount: number;
  importedCount: number;
  reviewCount: number;
  failedCount: number;
  items: GmailImportItemResult[];
}

export async function listGmailLabelsForConnection(
  db: D1Database,
  connectionId: string,
  env: GoogleOAuthEnv,
): Promise<GmailLabel[]> {
  const client = await gmailClientForConnection(db, connectionId, env);
  return client.listLabels();
}

export async function processActiveGmailImportRules(
  db: D1Database,
  env: GmailJalanImportEnv,
): Promise<GmailImportRunResult[]> {
  const rules = await listGmailImportRules(db, { activeOnly: true });
  const results: GmailImportRunResult[] = [];
  for (const rule of rules) {
    try {
      results.push(await runGmailImportRule(db, rule.id, env));
    } catch (err) {
      console.error('Gmail import rule failed:', rule.id, err);
    }
  }
  return results;
}

export async function runGmailImportRule(
  db: D1Database,
  ruleId: string,
  env: GmailJalanImportEnv,
  options: RunGmailImportOptions = {},
): Promise<GmailImportRunResult> {
  const rule = await getGmailImportRuleById(db, ruleId);
  if (!rule || rule.is_active !== 1) throw new Error('Gmail import rule not found or inactive');

  const dryRun = options.dryRun === true;
  const run = dryRun ? null : await createGmailImportRun(db, rule.id);
  const items: GmailImportItemResult[] = [];
  let messages: { id: string }[] = [];

  try {
    const client = await gmailClientForConnection(db, rule.connection_id, env);
    messages = await client.listMessages({
      labelIds: [rule.unprocessed_label_id],
      q: buildGmailQuery(rule),
      maxResults: options.maxResults ?? rule.max_results,
    });

    for (const message of messages) {
      let detail: GmailMessageText | null = null;
      try {
        detail = await client.getMessageText(message.id);
        const result = dryRun
          ? await dryRunMessage(rule, detail)
          : await importMessage(db, rule, detail, env);
        items.push(result);
        if (!dryRun) {
          await moveMessageLabel(client, rule, detail.id, labelForResult(result.parseStatus));
        }
      } catch (err) {
        const messageId = detail?.id ?? message.id;
        const error = err instanceof Error ? err.message : String(err);
        items.push({
          gmailMessageId: messageId,
          eventType: 'unknown',
          parseStatus: 'failed',
          error,
        });
        if (!dryRun) {
          await client.modifyLabels(messageId, {
            removeLabelIds: [rule.unprocessed_label_id],
            addLabelIds: [rule.failed_label_id],
          }).catch((labelErr) => {
            console.error('Failed to move Gmail message to failed label:', messageId, labelErr);
          });
        }
      }
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    items.push({
      gmailMessageId: 'rule',
      eventType: 'unknown',
      parseStatus: 'failed',
      error,
    });
    const failedResult = summarize(rule.id, run?.id ?? null, dryRun, messages.length, items);
    if (!dryRun && run) {
      await finishGmailImportRun(db, run.id, {
        status: 'failed',
        fetchedCount: failedResult.fetchedCount,
        importedCount: failedResult.importedCount,
        reviewCount: failedResult.reviewCount,
        failedCount: failedResult.failedCount,
        lastError: error,
      });
      await markGmailImportRuleRunAt(db, rule.id);
    }
    return failedResult;
  }

  const result = summarize(rule.id, run?.id ?? null, dryRun, messages.length, items);
  if (!dryRun && run) {
    await finishGmailImportRun(db, run.id, {
      status: result.failedCount > 0 ? (result.importedCount > 0 || result.reviewCount > 0 ? 'partial_failed' : 'failed') : 'success',
      fetchedCount: result.fetchedCount,
      importedCount: result.importedCount,
      reviewCount: result.reviewCount,
      failedCount: result.failedCount,
      lastError: items.find((item) => item.error)?.error ?? null,
    });
    await markGmailImportRuleRunAt(db, rule.id);
  }
  return result;
}

async function gmailClientForConnection(
  db: D1Database,
  connectionId: string,
  env: GoogleOAuthEnv,
): Promise<GoogleGmailClient> {
  const conn = await getUsableGoogleCalendarConnection(db, connectionId, env);
  if (!conn?.access_token) throw new Error('Google connection is not usable');
  return new GoogleGmailClient({ accessToken: conn.access_token });
}

async function dryRunMessage(rule: GmailImportRule, detail: GmailMessageText): Promise<GmailImportItemResult> {
  const parsed = parseJalanMail(detail.text);
  const routeError = parsed.eventType === 'created' ? routeMissing(rule) : '';
  return {
    gmailMessageId: detail.id,
    eventType: parsed.eventType,
    parseStatus: 'dry_run',
    externalId: parsed.externalId,
    error: routeError || null,
  };
}

async function importMessage(
  db: D1Database,
  rule: GmailImportRule,
  detail: GmailMessageText,
  env: GmailJalanImportEnv,
): Promise<GmailImportItemResult> {
  const parsed = parseJalanMail(detail.text);
  const slotId = await resolveSlotId(db, {
    resourceId: rule.resource_id ?? undefined,
    date: parsed.reservationDate,
    startTime: parsed.startTime,
  });
  const route = await validateRoute(db, {
    resourceId: rule.resource_id ?? undefined,
    menuId: rule.menu_id ?? undefined,
    slotId,
  });
  const shouldCreateReservation = parsed.eventType === 'created';
  const parsedPayload = JSON.stringify({
    parser: 'jalan_gmail_cron_v1',
    ...parsed,
    gmail: {
      messageId: detail.id,
      threadId: detail.threadId ?? null,
      labelIds: detail.labelIds,
      internalDate: detail.internalDate ?? null,
    },
    rule: {
      id: rule.id,
      name: rule.name,
      resourceId: rule.resource_id,
      menuId: rule.menu_id,
      reviewReason: route.reviewReason ?? null,
    },
  });

  const imported = await importExternalReservation(db, {
    source: 'jalan',
    eventType: parsed.eventType,
    externalId: parsed.externalId,
    gmailMessageId: detail.id,
    receivedAt: receivedAtFromGmail(detail),
    rawText: detail.text,
    parsedPayload,
    reviewReason: shouldCreateReservation ? route.reviewReason : undefined,
    resourceId: shouldCreateReservation ? route.resourceId : rule.resource_id ?? undefined,
    menuId: shouldCreateReservation ? route.menuId : rule.menu_id ?? undefined,
    slotId: shouldCreateReservation ? route.slotId : slotId,
    adultCount: parsed.adultCount ?? undefined,
    childCount: parsed.childCount ?? undefined,
    infantCount: parsed.infantCount ?? undefined,
    underThreeCount: parsed.underThreeCount ?? undefined,
    customerName: parsed.customerName,
    customerPhone: parsed.customerPhone,
    customerEmail: parsed.customerEmail,
  });

  await syncCalendarIfNeeded(db, imported, env);
  await notifyDiscordIfNeeded(db, imported, env);
  return itemResult(detail.id, parsed.eventType, parsed.externalId, imported);
}

async function validateRoute(
  db: D1Database,
  params: { resourceId?: string; menuId?: string; slotId?: string },
): Promise<{ resourceId?: string; menuId?: string; slotId?: string; reviewReason?: string }> {
  if (!params.resourceId || !params.menuId || !params.slotId) {
    return { reviewReason: routeMissing(params) };
  }
  const resource = await getReservationResourceById(db, params.resourceId);
  if (!resource || resource.is_active !== 1) return { reviewReason: 'configured resource is missing or inactive' };
  const menu = await getReservationMenuById(db, params.menuId);
  if (!menu || menu.is_active !== 1 || menu.resource_id !== resource.id) {
    return { reviewReason: 'configured menu is missing, inactive, or belongs to another resource' };
  }
  const slot = await db.prepare(`SELECT id, resource_id FROM reservation_slots WHERE id = ?`).bind(params.slotId).first<{ id: string; resource_id: string }>();
  if (!slot || slot.resource_id !== resource.id) return { reviewReason: 'matching slot is missing for configured resource' };
  return { resourceId: resource.id, menuId: menu.id, slotId: slot.id };
}

async function resolveSlotId(
  db: D1Database,
  params: { resourceId?: string; date: string | null; startTime: string | null },
): Promise<string | undefined> {
  if (!params.resourceId || !params.date || !params.startTime) return undefined;
  const slots = await listReservationSlots(db, { resourceId: params.resourceId, date: params.date });
  return slots.find((slot) => slot.start_at.includes(`T${params.startTime}:`))?.id;
}

function routeMissing(params: { resourceId?: string | null; menuId?: string | null; slotId?: string | null }): string {
  const missing = [
    params.resourceId ? null : 'resourceId',
    params.menuId ? null : 'menuId',
    params.slotId ? null : 'slotId',
  ].filter(Boolean);
  return missing.length ? `created event is missing ${missing.join('/')}` : '';
}

export function buildGmailQuery(rule: Pick<GmailImportRule, 'query' | 'from_email'>): string {
  const parts = [rule.query?.trim()].filter(Boolean) as string[];
  if (rule.from_email?.trim() && !parts.some((part) => /\bfrom:/.test(part))) {
    parts.unshift(buildFromQuery(rule.from_email));
  }
  if (!parts.some((part) => /\bnewer_than:|\bafter:/.test(part))) {
    parts.push('newer_than:30d');
  }
  return parts.join(' ');
}

function buildFromQuery(value: string): string {
  const emails = value
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);
  if (emails.length <= 1) return `from:${emails[0] ?? value.trim()}`;
  return `{${emails.map((email) => `from:${email}`).join(' ')}}`;
}

function labelForResult(status: GmailImportItemResult['parseStatus']): 'processed' | 'review' | 'failed' {
  if (status === 'needs_review') return 'review';
  if (status === 'failed') return 'failed';
  return 'processed';
}

async function moveMessageLabel(
  client: GoogleGmailClient,
  rule: GmailImportRule,
  messageId: string,
  target: 'processed' | 'review' | 'failed',
): Promise<void> {
  const addLabelIds = target === 'processed'
    ? [rule.processed_label_id]
    : target === 'review'
      ? [rule.review_label_id]
      : [rule.failed_label_id];
  await client.modifyLabels(messageId, {
    removeLabelIds: [rule.unprocessed_label_id],
    addLabelIds,
  });
}

function itemResult(
  gmailMessageId: string,
  eventType: string,
  externalId: string | null,
  result: ImportExternalReservationResult,
): GmailImportItemResult {
  if (!result.ok) {
    const reviewable = result.reason === 'slot_not_available';
    return {
      gmailMessageId,
      eventType,
      externalId,
      parseStatus: reviewable ? 'needs_review' : 'failed',
      error: result.reason,
    };
  }
  if (result.status === 'needs_review') {
    return {
      gmailMessageId,
      eventType,
      externalId,
      parseStatus: 'needs_review',
      reservationId: result.source.reservation_id,
      error: result.source.last_error,
    };
  }
  return {
    gmailMessageId,
    eventType,
    externalId,
    parseStatus: result.status,
    reservationId: result.reservation.id,
  };
}

async function syncCalendarIfNeeded(
  db: D1Database,
  result: ImportExternalReservationResult,
  env: GmailJalanImportEnv,
): Promise<void> {
  if (!result.ok || result.status === 'needs_review') return;
  if (result.status === 'imported') {
    await syncReservationCreatedToGoogleCalendar(db, result.reservation, env);
  } else if (result.status === 'cancelled') {
    await syncReservationCancelledToGoogleCalendar(db, result.reservation, env);
  }
}

async function notifyDiscordIfNeeded(
  db: D1Database,
  result: ImportExternalReservationResult,
  env: GmailJalanImportEnv,
): Promise<void> {
  if (!result.ok) return;
  if (result.status === 'needs_review') {
    await notifyExternalReviewToDiscord(env, result.source);
    return;
  }
  if (result.status === 'duplicate') return;
  await notifyReservationToDiscord(
    db,
    result.reservation,
    env,
    result.status === 'cancelled' ? 'cancelled' : 'created',
  );
}

function receivedAtFromGmail(detail: GmailMessageText): string | null {
  const ms = Number(detail.internalDate);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function summarize(
  ruleId: string,
  runId: string | null,
  dryRun: boolean,
  fetchedCount: number,
  items: GmailImportItemResult[],
): GmailImportRunResult {
  return {
    runId,
    ruleId,
    dryRun,
    fetchedCount,
    importedCount: items.filter((item) => item.parseStatus === 'imported' || item.parseStatus === 'duplicate' || item.parseStatus === 'cancelled').length,
    reviewCount: items.filter((item) => item.parseStatus === 'needs_review').length,
    failedCount: items.filter((item) => item.parseStatus === 'failed').length,
    items,
  };
}
