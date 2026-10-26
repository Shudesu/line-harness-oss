import type { Env } from "../index.js";
import {
  signHarnessRequest,
  assertHttpsBase,
  RETRY_DELAYS_MS,
} from "./harness-gate-protocol.js";
import type { GateClaimView } from "./x-gate-line-message.js";
export function xGateConfigured(env: Env["Bindings"]) {
  return !!(
    env.X_HARNESS_URL &&
    env.X_HARNESS_GATE_SECRET &&
    env.X_HARNESS_CONNECTION_ID
  );
}
export async function callXGate(
  env: Env["Bindings"],
  path: string,
  event: string,
  payload: unknown,
  deliveryId?: string,
) {
  if (!xGateConfigured(env)) throw new Error("x_gate_not_configured");
  const body = JSON.stringify(payload),
    headers = await signHarnessRequest(
      env.X_HARNESS_GATE_SECRET!,
      "POST",
      path,
      body,
      {
        event,
        connectionId: env.X_HARNESS_CONNECTION_ID!,
        deliveryId,
      },
    );
  const response = await fetch(assertHttpsBase(env.X_HARNESS_URL!) + path, {
    method: "POST",
    headers,
    body,
    redirect: "error",
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error(`x_gate_http_${response.status}`);
  const result = (await response.json()) as {
    success: boolean;
    data: GateClaimView & { participantId?: string };
  };
  if (result.success !== true) throw new Error("x_gate_failed");
  return result;
}
export async function joinXGate(
  env: Env["Bindings"],
  gateId: string,
  friendId: string,
  accountId: string,
  check = false,
) {
  const campaign = await env.DB.prepare(
    "SELECT line_account_id,tier FROM x_gate_campaigns WHERE gate_id=? AND is_active=1",
  )
    .bind(gateId)
    .first<{ line_account_id: string; tier: string }>();
  const friend = await env.DB.prepare(
    "SELECT id,line_user_id FROM friends WHERE id=?",
  )
    .bind(friendId)
    .first<{ id: string; line_user_id: string }>();
  if (!campaign || !friend || campaign.line_account_id !== accountId)
    throw new Error("friend_scope_mismatch");
  if (campaign.tier === "strict") {
    const proof = await env.DB.prepare(
      "SELECT participant_id,challenge_at FROM x_gate_entries WHERE gate_id=? AND friend_id=?",
    )
      .bind(gateId, friendId)
      .first<{ participant_id: string | null; challenge_at: number | null }>();
    if (
      !proof?.participant_id &&
      (!proof?.challenge_at || proof.challenge_at < Date.now() - 300000)
    )
      throw new Error("challenge_required");
  }
  const now = Date.now();
  await env.DB.prepare(
    "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,created_at,last_seen_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(gate_id,friend_id) DO UPDATE SET last_seen_at=excluded.last_seen_at",
  )
    .bind(
      gateId,
      friendId,
      campaign.line_account_id,
      friend.line_user_id,
      now,
      now,
    )
    .run();
  const result = await callXGate(
    env,
    "/api/integrations/line-harness/claims" + (check ? "/check" : ""),
    check ? "line.gate.check" : "line.gate.claim",
    { gateId, lineFriendId: friendId },
  );
  if (!result.success) throw new Error("x_gate_failed");
  await env.DB.prepare(
    "UPDATE x_gate_entries SET participant_id=COALESCE(participant_id,?),state=CASE WHEN state IN ('won','lost','rewarded') AND ? NOT IN ('won','lost','rewarded') THEN state ELSE ? END,result=CASE WHEN state IN ('won','lost','rewarded') AND ? NOT IN ('won','lost','rewarded') THEN result ELSE ? END WHERE gate_id=? AND friend_id=?",
  )
    .bind(
      result.data.participantId ?? null,
      result.data.status,
      result.data.status,
      result.data.status,
      JSON.stringify(result.data),
      gateId,
      friendId,
    )
    .run();
  return result.data;
}
export async function queueXGateEvent(
  env: Env["Bindings"],
  gateId: string,
  friendId: string,
  type: string,
  sourceId: string,
) {
  const payload = { gateId, lineFriendId: friendId, type, sourceId };
  await env.DB.prepare(
    "INSERT OR IGNORE INTO x_gate_outbox(id,gate_id,friend_id,type,source_id,payload,next_at) VALUES (?,?,?,?,?,?,?)",
  )
    .bind(
      crypto.randomUUID(),
      gateId,
      friendId,
      type,
      sourceId,
      JSON.stringify(payload),
      Date.now(),
    )
    .run();
}
export async function flushXGateEvents(env: Env["Bindings"]) {
  if (!xGateConfigured(env)) return;
  const now = Date.now(),
    rows = (
      await env.DB.prepare(
        "SELECT * FROM x_gate_outbox WHERE status='pending' AND next_at<=? AND (lease_until IS NULL OR lease_until<?) LIMIT 20",
      )
        .bind(now, now)
        .all<{ id: string; payload: string; attempts: number }>()
    ).results;
  for (const row of rows) {
    const owner = crypto.randomUUID();
    const claimed = await env.DB.prepare(
      "UPDATE x_gate_outbox SET owner=?,lease_until=? WHERE id=? AND status='pending' AND (lease_until IS NULL OR lease_until<?) RETURNING id",
    )
      .bind(owner, now + 60000, row.id, now)
      .first();
    if (!claimed) continue;
    try {
      await callXGate(
        env,
        "/api/integrations/line-harness/events",
        "line.gate.event",
        JSON.parse(row.payload),
        row.id,
      );
      await env.DB.prepare(
        "UPDATE x_gate_outbox SET status='done',owner=NULL,lease_until=NULL WHERE id=? AND owner=?",
      )
        .bind(row.id, owner)
        .run();
    } catch (error) {
      const delay = RETRY_DELAYS_MS[row.attempts];
      await env.DB.prepare(
        "UPDATE x_gate_outbox SET status=?,attempts=attempts+1,next_at=?,last_error=?,owner=NULL,lease_until=NULL WHERE id=? AND owner=?",
      )
        .bind(
          delay === undefined ? "dead" : "pending",
          now + (delay ?? 0),
          error instanceof Error ? error.message : "failed",
          row.id,
          owner,
        )
        .run();
    }
  }
}
