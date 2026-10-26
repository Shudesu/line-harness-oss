import type { HarnessProxyDispatch } from "./line-proxy-send.js";
import { bodyDigest } from "./harness-gate-protocol.js";
import type { Env } from "../index.js";
import { getLineAccountById, jstNow } from "@line-crm/db";
import {
  joinXGate,
  queueXGateEvent,
  xGateConfigured,
} from "./x-gate-client.js";
import { sendGateLineMessage, gateFlex } from "./x-gate-line-message.js";
export async function handleXGateWebhook(
  env: Env["Bindings"],
  input: {
    type: "follow" | "postback" | "message";
    friendId: string;
    lineAccountId: string | null;
    lineUserId: string;
    replyToken?: string;
    sourceId: string;
    data?: string;
    proxyDispatch?: HarnessProxyDispatch;
  },
): Promise<boolean> {
  if (!xGateConfigured(env) || !input.lineAccountId || !input.proxyDispatch)
    return false;
  const proxy = { proxyBaseUrl: env.WORKER_URL, dispatch: input.proxyDispatch };
  const db = env.DB,
    params = new URLSearchParams(input.data ?? "");
  const requested = params.get("gate"),
    action = params.get("action");
  if (
    input.type === "postback" &&
    !["xgate_join", "xgate_check"].includes(action ?? "")
  )
    return false;
  if (input.type === "message" && input.data?.trim() !== "参加") {
    const entries = (
      await db
        .prepare(
          "SELECT gate_id,created_at FROM x_gate_entries WHERE friend_id=? AND line_account_id=? AND created_at>?",
        )
        .bind(input.friendId, input.lineAccountId, Date.now() - 7 * 86400000)
        .all<{ gate_id: string; created_at: number }>()
    ).results;
    for (const entry of entries) {
      const count = await db
        .prepare(
          "SELECT COUNT(*) AS total FROM messages_log WHERE friend_id=? AND direction='incoming' AND line_account_id=? AND julianday(created_at)>=julianday(?/1000,'unixepoch')",
        )
        .bind(input.friendId, input.lineAccountId, entry.created_at)
        .first<{ total: number }>();
      if ((count?.total ?? 0) >= 2)
        await queueXGateEvent(
          env,
          entry.gate_id,
          input.friendId,
          "line_engaged",
          `${input.friendId}:7days`,
        );
    }
    return false;
  }
  let gateId = requested;
  if (input.type === "follow" || !gateId) {
    const rows = (
      await db
        .prepare(
          "SELECT e.gate_id,e.following FROM x_gate_entries e JOIN x_gate_campaigns c ON c.gate_id=e.gate_id WHERE e.friend_id=? AND e.line_account_id=? AND c.is_active=1 ORDER BY e.last_seen_at DESC LIMIT 2",
        )
        .bind(input.friendId, input.lineAccountId)
        .all<{ gate_id: string; following: number }>()
    ).results;
    if (input.type === "follow") {
      if (!rows.length) return false;
      gateId = rows[0].gate_id;
      if (!rows[0].following)
        await queueXGateEvent(
          env,
          gateId,
          input.friendId,
          "line_added",
          `${input.friendId}:first-follow`,
        );
      await db
        .prepare(
          "UPDATE x_gate_entries SET following=1 WHERE friend_id=? AND line_account_id=?",
        )
        .bind(input.friendId, input.lineAccountId)
        .run();
    } else if (rows.length === 1) gateId = rows[0].gate_id;
    else if (rows.length > 1) {
      const account = await getLineAccountById(db, input.lineAccountId);
      if (account && input.replyToken)
        await sendGateLineMessage(
          account.channel_access_token,
          input.lineUserId,
          {
            type: "text",
            text: "参加するキャンペーンのリンク、またはキャンペーンの「結果を見る」ボタンからお進みください。",
          },
          { ...proxy, replyToken: input.replyToken },
        );
      if (account && input.replyToken)
        await logGateReply(
          db,
          input.friendId,
          input.lineAccountId,
          await bodyDigest(input.sourceId),
          {
            type: "text",
            text: "参加するキャンペーンのリンク、またはキャンペーンの「結果を見る」ボタンからお進みください。",
          },
        );
      return true;
    } else return false;
  }
  if (!gateId) return false;
  const campaign = await db
    .prepare(
      "SELECT gate_id,tier FROM x_gate_campaigns WHERE gate_id=? AND line_account_id=? AND is_active=1",
    )
    .bind(gateId, input.lineAccountId)
    .first<{ gate_id: string; tier: string }>();
  if (!campaign) return false;
  const sourceId = await bodyDigest(input.sourceId),
    previous = await db
      .prepare("SELECT status FROM x_gate_reply_receipts WHERE source_id=?")
      .bind(sourceId)
      .first<{ status: string }>();
  if (previous) return true; // Includes ambiguous reply outcomes: never auto-push a second message.
  await db
    .prepare(
      "INSERT INTO x_gate_reply_receipts(source_id,friend_id,gate_id,status,created_at) VALUES (?,?,?,'pending',?)",
    )
    .bind(sourceId, input.friendId, gateId, Date.now())
    .run();
  try {
    if (campaign.tier === "strict") {
      const proof = await db
        .prepare(
          "SELECT participant_id,challenge_at FROM x_gate_entries WHERE gate_id=? AND friend_id=?",
        )
        .bind(gateId, input.friendId)
        .first<{
          participant_id: string | null;
          challenge_at: number | null;
        }>();
      if (
        !proof?.participant_id &&
        (!proof?.challenge_at || proof.challenge_at < Date.now() - 300000)
      ) {
        const account = await getLineAccountById(db, input.lineAccountId);
        if (!account?.liff_id) throw new Error("liff_unavailable");
        const url = new URL(`https://liff.line.me/${account.liff_id}`);
        url.search = new URLSearchParams({
          page: "xgate",
          gate: gateId,
          liffId: account.liff_id,
        }).toString();
        await sendGateLineMessage(
          account.channel_access_token,
          input.lineUserId,
          {
            type: "text",
            text: `不正防止のため、参加画面で確認してください。\n${url}`,
          },
          {
            ...proxy,
            replyToken: input.replyToken,
            deliveryId: crypto.randomUUID(),
          },
        );
        if (input.replyToken)
          await logGateReply(
            db,
            input.friendId,
            input.lineAccountId,
            sourceId,
            {
              type: "text",
              text: `不正防止のため、参加画面で確認してください。\n${url}`,
            },
          );
        await db
          .prepare(
            "UPDATE x_gate_reply_receipts SET status='done' WHERE source_id=?",
          )
          .bind(sourceId)
          .run();
        return true;
      }
    }
    const result = await joinXGate(
      env,
      gateId,
      input.friendId,
      input.lineAccountId,
      action === "xgate_check",
    );
    const account = await getLineAccountById(db, input.lineAccountId);
    if (!account?.is_active) throw new Error("account_unavailable");
    let message: unknown = gateFlex(gateId, result);
    const isFinal = ["won", "lost", "rewarded"].includes(result.status);
    if (isFinal && !input.replyToken) {
      // The signed result outbox owns the fallback push and its retry key.
      await db
        .prepare(
          "UPDATE x_gate_reply_receipts SET status='done' WHERE source_id=?",
        )
        .bind(sourceId)
        .run();
      return true;
    }
    if (input.replyToken && isFinal)
      await db
        .prepare(
          "INSERT OR IGNORE INTO x_gate_notifications(gate_id,friend_id,method,delivery_id,created_at) VALUES (?,?,'reply',?,?)",
        )
        .bind(gateId, input.friendId, sourceId, Date.now())
        .run();
    const notification =
      input.replyToken && isFinal
        ? await db
            .prepare(
              "SELECT method,status FROM x_gate_notifications WHERE gate_id=? AND friend_id=?",
            )
            .bind(gateId, input.friendId)
            .first<{ method: string; status: string }>()
        : null;
    const deliverFinalReply =
      !!input.replyToken && isFinal && notification?.method === "reply";
    if (notification?.method === "push")
      message = {
        type: "text",
        text:
          notification.status === "done"
            ? "結果はLINEトークの特典通知をご確認ください。"
            : "結果は確定しています。通知の送信待ちです。参加画面からも結果を確認できます。",
      };
    if (deliverFinalReply)
      await db
        .prepare(
          "UPDATE x_gate_reply_receipts SET reward_response=1 WHERE source_id=?",
        )
        .bind(sourceId)
        .run();
    await sendGateLineMessage(
      account.channel_access_token,
      input.lineUserId,
      message,
      input.replyToken
        ? { ...proxy, replyToken: input.replyToken }
        : { ...proxy, deliveryId: crypto.randomUUID() },
    );
    if (input.replyToken)
      await logGateReply(
        db,
        input.friendId,
        input.lineAccountId,
        sourceId,
        message,
      );
    if (deliverFinalReply)
      await db
        .prepare(
          "UPDATE x_gate_notifications SET status='done' WHERE gate_id=? AND friend_id=? AND method='reply'",
        )
        .bind(gateId, input.friendId)
        .run();
    if (deliverFinalReply)
      await db
        .prepare(
          "UPDATE x_gate_entries SET reward_reply_at=? WHERE gate_id=? AND friend_id=?",
        )
        .bind(Date.now(), gateId, input.friendId)
        .run();
    await db
      .prepare(
        "UPDATE x_gate_reply_receipts SET status='done' WHERE source_id=?",
      )
      .bind(sourceId)
      .run();
  } catch {
    await db
      .prepare(
        "UPDATE x_gate_reply_receipts SET status='needs_review' WHERE source_id=?",
      )
      .bind(sourceId)
      .run();
  }
  return true;
}

async function logGateReply(
  db: D1Database,
  friendId: string,
  accountId: string,
  sourceId: string,
  message: unknown,
) {
  const value = message as { type: string; text?: string; contents?: unknown };
  await db
    .prepare(
      "INSERT OR IGNORE INTO messages_log(id,friend_id,direction,message_type,content,broadcast_id,scenario_step_id,source,line_account_id,created_at) VALUES (?,?,'outgoing',?,?,NULL,NULL,'auto_reply',?,?)",
    )
    .bind(
      "xgate-reply:" + sourceId,
      friendId,
      value.type,
      value.type === "text"
        ? (value.text ?? "")
        : JSON.stringify(value.contents ?? message),
      accountId,
      jstNow(),
    )
    .run();
}
