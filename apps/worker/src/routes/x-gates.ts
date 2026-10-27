import { handleCampaignEvent } from "../services/x-campaign-events.js";
import { acceptXGateFollowup } from "../services/x-gate-followup.js";
import { verifyGateChallenge } from "../services/x-gate-challenge.js";
import { dispatchLineProxyLocally } from "../services/local-line-proxy.js";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import {
  getLineAccountById,
  getLineAccounts,
  getFriendById,
  upsertFriend,
  enrollFriendInScenario,
  jstNow,
} from "@line-crm/db";
import type { Env } from "../index.js";
import {
  verifyHarnessRequest,
  bodyDigest,
  assertHttpsBase,
} from "../services/harness-gate-protocol.js";
import {
  joinXGate,
  queueXGateEvent,
  xGateConfigured,
} from "../services/x-gate-client.js";
import {
  sendGateLineMessage,
  gateFlex,
} from "../services/x-gate-line-message.js";
const xGates = new Hono<Env>();
xGates.use(
  "/api/integrations/x-harness/*",
  bodyLimit({
    maxSize: 131072,
    onError: (c) => c.json({ success: false, error: "Request too large" }, 413),
  }),
);
xGates.use(
  "/api/liff/x-gates/*",
  bodyLimit({
    maxSize: 32768,
    onError: (c) =>
      c.json({ success: false, error: "リクエストが大きすぎます" }, 413),
  }),
);
async function partner(c: Context<Env>) {
  if (
    !xGateConfigured(c.env) ||
    Number(c.req.header("Content-Length")) > 131072
  )
    return null;
  const raw = await c.req.text(),
    signature = await verifyHarnessRequest(
      c.env.X_HARNESS_GATE_SECRET!,
      c.req.raw,
      raw,
      c.env.X_HARNESS_CONNECTION_ID!,
    );
  if (!signature) return null;
  try {
    return {
      raw,
      signature,
      body: (raw ? JSON.parse(raw) : {}) as Record<string, any>,
    };
  } catch {
    return null;
  }
}
interface Campaign {
  gate_id: string;
  connection_id: string;
  line_account_id: string;
  slug: string;
  title: string;
  tier: string;
  tracked_link_id: string;
  tags: string;
  scenarios: string;
  request_hash: string;
  is_active: number;
}
xGates.post("/api/integrations/x-harness/campaigns", async (c) => {
  if (!["owner", "admin"].includes(c.get("staff")?.role ?? ""))
    return c.json({ success: false, error: "Admin required" }, 403);
  const signed = await partner(c);
  if (!signed || signed.signature.event !== "x.gate.configure")
    return c.json({ success: false, error: "Unauthorized" }, 401);
  const b = signed.body;
  if (
    !b ||
    typeof b.gateId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/.test(b.gateId) ||
    typeof b.slug !== "string" ||
    !/^[a-z0-9-]{2,64}$/.test(b.slug) ||
    typeof b.name !== "string" ||
    b.name.length > 100 ||
    !["simple", "standard", "strict"].includes(b.tier)
  )
    return c.json({ success: false, error: "Invalid campaign" }, 400);
  if (
    b.tier === "strict" &&
    (!c.env.X_GATE_TURNSTILE_SITE_KEY || !c.env.X_GATE_TURNSTILE_SECRET_KEY)
  )
    return c.json(
      {
        success: false,
        error: "Strict tier requires Turnstile on the LINE deployment",
      },
      400,
    );
  const hash = await bodyDigest(signed.raw),
    existing = await c.env.DB.prepare(
      "SELECT * FROM x_gate_campaigns WHERE gate_id=?",
    )
      .bind(b.gateId)
      .first<Campaign>();
  if (existing) {
    if (existing.request_hash !== hash)
      return c.json({ success: false, error: "Idempotency conflict" }, 409);
    return c.json({
      success: true,
      data: {
        trackedLinkRef: existing.tracked_link_id,
        liffUrl: `${c.env.WORKER_URL}/r/${existing.tracked_link_id}?gate=${encodeURIComponent(b.gateId)}`,
        tagIds: JSON.parse(existing.tags),
      },
    });
  }
  const accounts = b.lineAccountId ? [] : await getLineAccounts(c.env.DB),
    account = b.lineAccountId
      ? await getLineAccountById(c.env.DB, b.lineAccountId)
      : accounts.length === 1
        ? accounts[0]
        : null;
  if (!account?.is_active || !account.liff_id || !account.login_channel_id)
    return c.json(
      {
        success: false,
        error: "Select an active LINE account with LIFF/Login configured",
      },
      400,
    );
  const scenarios: Record<string, string> = {};
  for (const kind of ["claimed", "won", "lost"])
    if (b.scenarios?.[kind]) {
      const scenario = await c.env.DB.prepare(
        "SELECT id,line_account_id,is_active FROM scenarios WHERE id=?",
      )
        .bind(b.scenarios[kind])
        .first<{
          id: string;
          line_account_id: string | null;
          is_active: number;
        }>();
      if (
        !scenario?.is_active ||
        (scenario.line_account_id && scenario.line_account_id !== account.id)
      )
        return c.json(
          { success: false, error: "Scenario account mismatch" },
          400,
        );
      scenarios[kind] = scenario.id;
    }
  const now = jstNow(),
    ref = crypto.randomUUID(),
    tags: Record<string, string> = {};
  const statements: D1PreparedStatement[] = [];
  for (const kind of ["claimed", "won", "lost"]) {
    const id = crypto.randomUUID();
    tags[kind] = id;
    statements.push(
      c.env.DB.prepare(
        "INSERT INTO tags(id,name,color,created_at) VALUES (?,?,?,?)",
      ).bind(
        id,
        `x-gate:${b.slug}${kind === "claimed" ? "" : ":" + kind}`,
        "#2563eb",
        now,
      ),
    );
  }
  statements.unshift(
    c.env.DB.prepare(
      "INSERT INTO x_gate_campaigns(gate_id,connection_id,line_account_id,slug,title,tier,tracked_link_id,tags,scenarios,request_hash,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)",
    ).bind(
      b.gateId,
      c.env.X_HARNESS_CONNECTION_ID,
      account.id,
      b.slug,
      b.name,
      b.tier,
      ref,
      JSON.stringify(tags),
      JSON.stringify(scenarios),
      hash,
      Date.now(),
    ),
  );
  const destination = new URL("/", assertHttpsBase(c.env.WORKER_URL));
  destination.search = new URLSearchParams({
    page: "xgate",
    gate: b.gateId,
    liffId: account.liff_id,
  }).toString();
  statements.push(
    c.env.DB.prepare(
      "INSERT INTO tracked_links(id,name,original_url,line_account_id,is_active,click_count,created_at,updated_at) VALUES (?,?,?,?,1,0,?,?)",
    ).bind(ref, b.name, destination.toString(), account.id, now, now),
  );
  try {
    await c.env.DB.batch(statements);
  } catch (error) {
    const concurrent = await c.env.DB.prepare(
      "SELECT * FROM x_gate_campaigns WHERE gate_id=?",
    )
      .bind(b.gateId)
      .first<Campaign>();
    if (concurrent?.request_hash === hash)
      return c.json({
        success: true,
        data: {
          trackedLinkRef: concurrent.tracked_link_id,
          liffUrl: `${c.env.WORKER_URL}/r/${concurrent.tracked_link_id}`,
          tagIds: JSON.parse(concurrent.tags),
        },
      });
    throw error;
  }
  return c.json(
    {
      success: true,
      data: {
        trackedLinkRef: ref,
        liffUrl: `${c.env.WORKER_URL}/r/${ref}?gate=${encodeURIComponent(b.gateId)}`,
        tagIds: tags,
      },
    },
    201,
  );
});
xGates.post("/api/integrations/x-harness/campaigns/:id/cancel", async (c) => {
  const signed = await partner(c);
  if (!signed || signed.signature.event !== "x.gate.cancel")
    return c.json({ success: false, error: "Unauthorized" }, 401);
  await c.env.DB.batch([
    c.env.DB.prepare(
      "UPDATE x_gate_campaigns SET is_active=0 WHERE gate_id=?",
    ).bind(c.req.param("id")),
    c.env.DB.prepare(
      "UPDATE tracked_links SET is_active=0 WHERE id=(SELECT tracked_link_id FROM x_gate_campaigns WHERE gate_id=?)",
    ).bind(c.req.param("id")),
  ]);
  return c.json({ success: true });
});
xGates.get("/api/integrations/x-harness/capabilities", async (c) => {
  const signed = await partner(c);
  if (!signed || signed.signature.event !== "x.campaign.capabilities")
    return c.json({ success: false, error: "Unauthorized" }, 401);
  return c.json({
    success: true,
    data: {
      schema: "xh.gate.v1",
      events: ["x.campaign.digest", "x.campaign.early_notice"],
      followup: true,
      display: true,
    },
  });
});
xGates.put("/api/x-campaign-notifications/:accountId", async (c) => {
  if (!["owner", "admin"].includes(c.get("staff")?.role ?? ""))
    return c.json({ success: false, error: "Admin required" }, 403);
  if (!(await getLineAccountById(c.env.DB, c.req.param("accountId"))))
    return c.json({ success: false, error: "Account not found" }, 404);
  const body = await c.req.json<{ friendIds?: string[] }>(),
    ids = body?.friendIds;
  if (
    !Array.isArray(ids) ||
    ids.length > 5 ||
    ids.some((x) => typeof x !== "string") ||
    new Set(ids).size !== ids.length
  )
    return c.json(
      { success: false, error: "Select up to five administrators" },
      400,
    );
  for (const id of ids)
    if (
      !(await c.env.DB.prepare(
        "SELECT id FROM friends WHERE id=? AND line_account_id=?",
      )
        .bind(id, c.req.param("accountId"))
        .first())
    )
      return c.json({ success: false, error: "Friend account mismatch" }, 400);
  await c.env.DB.prepare(
    "INSERT INTO account_settings(id,line_account_id,key,value) VALUES (?,?,'x_campaign_digest_friend_ids',?) ON CONFLICT(line_account_id,key) DO UPDATE SET value=excluded.value,updated_at=?",
  )
    .bind(
      crypto.randomUUID(),
      c.req.param("accountId"),
      JSON.stringify(ids),
      jstNow(),
    )
    .run();
  return c.json({ success: true });
});
xGates.post("/api/integrations/x-harness/events", async (c) => {
  const signed = await partner(c);
  if (
    signed &&
    ["x.campaign.digest", "x.campaign.early_notice"].includes(
      signed.signature.event,
    )
  )
    return handleCampaignEvent(
      c,
      signed.signature.event,
      signed.signature.deliveryId,
      signed.raw,
      signed.body,
    );
  if (
    !signed ||
    ![
      "x.gate.reply_matched",
      "x.gate.verified",
      "x.gate.reward_unlocked",
    ].includes(signed.signature.event)
  )
    return c.json({ success: false, error: "Unauthorized" }, 401);
  const b = signed.body,
    db = c.env.DB;
  if (!b || typeof b.gateId !== "string" || typeof b.participantId !== "string")
    return c.json({ success: false, error: "Invalid event" }, 400);
  const campaign = await db
    .prepare(
      "SELECT * FROM x_gate_campaigns WHERE gate_id=? AND connection_id=?",
    )
    .bind(b.gateId, signed.signature.connectionId)
    .first<Campaign>();
  if (!campaign)
    return c.json({ success: false, error: "Campaign not found" }, 404);
  const hash = await bodyDigest(signed.raw),
    id = signed.signature.deliveryId;
  const receipt = await db
    .prepare("SELECT body_hash,status FROM x_gate_inbox WHERE delivery_id=?")
    .bind(id)
    .first<{ body_hash: string; status: string }>();
  if (receipt?.body_hash !== undefined && receipt.body_hash !== hash)
    return c.json({ success: false, error: "Delivery conflict" }, 409);
  if (receipt?.status === "done")
    return c.json({ success: true, duplicate: true });
  await db
    .prepare(
      "INSERT OR IGNORE INTO x_gate_inbox(delivery_id,body_hash,event,payload,created_at) VALUES (?,?,?,?,?)",
    )
    .bind(id, hash, signed.signature.event, signed.raw, Date.now())
    .run();
  const owner = crypto.randomUUID(),
    claimed = await db
      .prepare(
        "UPDATE x_gate_inbox SET owner=?,lease_until=? WHERE delivery_id=? AND status='pending' AND (lease_until IS NULL OR lease_until<?) RETURNING delivery_id",
      )
      .bind(owner, Date.now() + 90000, id, Date.now())
      .first();
  if (!claimed) return c.json({ success: false, error: "Delivery busy" }, 503);
  try {
    if (signed.signature.event !== "x.gate.reply_matched") {
      const entry = await db
        .prepare(
          "SELECT * FROM x_gate_entries WHERE gate_id=? AND friend_id=? AND line_account_id=?",
        )
        .bind(b.gateId, b.lineFriendId, campaign.line_account_id)
        .first<{
          participant_id: string | null;
          line_user_id: string;
          following: number;
          reward_reply_at: number | null;
          result?: string;
        }>();
      if (
        !entry ||
        (entry.participant_id && entry.participant_id !== b.participantId)
      )
        throw new Error("participant_scope_mismatch");
      const friend = await getFriendById(db, b.lineFriendId);
      if (!friend || friend.line_user_id !== entry.line_user_id)
        throw new Error("friend_scope_mismatch");
      const tags = JSON.parse(campaign.tags) as Record<string, string>,
        scenarios = JSON.parse(campaign.scenarios) as Record<string, string>;
      const kind =
        signed.signature.event === "x.gate.reward_unlocked"
          ? b.outcome === "won"
            ? "won"
            : "lost"
          : "claimed";
      const batch: D1PreparedStatement[] = [
        db
          .prepare(
            "UPDATE x_gate_entries SET participant_id=?,state=CASE WHEN state IN ('won','lost','rewarded') AND ?='claimed' THEN state ELSE ? END,result=CASE WHEN state IN ('won','lost','rewarded') AND ?='claimed' THEN result ELSE ? END WHERE gate_id=? AND friend_id=?",
          )
          .bind(
            b.participantId,
            kind,
            kind,
            kind,
            JSON.stringify({
              ...b,
              status: kind,
              ...(JSON.parse(entry.result ?? "{}").followupAccepted
                ? {
                    followupAccepted: true,
                    followupCoupon:
                      JSON.parse(entry.result ?? "{}").followupCoupon ?? null,
                  }
                : {}),
            }),
            b.gateId,
            b.lineFriendId,
          ),
      ];
      for (const tag of [tags.claimed, tags[kind]])
        if (tag)
          batch.push(
            db
              .prepare(
                "INSERT OR IGNORE INTO friend_tags(friend_id,tag_id,assigned_at) VALUES (?,?,?)",
              )
              .bind(b.lineFriendId, tag, new Date().toISOString()),
          );
      if (b.xUserId) {
        if (
          typeof b.xUserId !== "string" ||
          !/^\d+$/.test(b.xUserId) ||
          typeof b.xUsername !== "string" ||
          !/^[A-Za-z0-9_]{1,15}$/.test(b.xUsername)
        )
          throw new Error("invalid_external_identity");
        batch.push(
          db
            .prepare(
              "INSERT INTO friend_external_ids(id,friend_id,line_account_id,provider,external_id,username,linked_at,source_gate_id,method) VALUES (?,?,?,'x',?,?,?,?,'reply_code') ON CONFLICT(friend_id,provider,source_gate_id) DO UPDATE SET username=excluded.username",
            )
            .bind(
              crypto.randomUUID(),
              friend.id,
              campaign.line_account_id,
              b.xUserId,
              b.xUsername,
              Date.now(),
              b.gateId,
            ),
        );
        let metadata: Record<string, unknown>;
        try {
          metadata = JSON.parse(friend.metadata || "{}");
          if (
            !metadata ||
            typeof metadata !== "object" ||
            Array.isArray(metadata)
          )
            metadata = { legacyMetadata: friend.metadata };
        } catch {
          metadata = { legacyMetadata: friend.metadata };
        }
        metadata.x = {
          ...(typeof metadata.x === "object" && metadata.x ? metadata.x : {}),
          user_id: b.xUserId,
          username: b.xUsername,
          source_gate_id: b.gateId,
        };
        batch.push(
          db
            .prepare("UPDATE friends SET metadata=? WHERE id=?")
            .bind(JSON.stringify(metadata), friend.id),
        );
      }
      if (kind === "lost") {
        const lostTag = `gate_lost:${b.gateId}`;
        batch.push(
          db
            .prepare(
              "INSERT OR IGNORE INTO tags(id,name,color,created_at) VALUES (?,?,'#2563eb',?)",
            )
            .bind(lostTag, lostTag, jstNow()),
          db
            .prepare(
              "INSERT OR IGNORE INTO friend_tags(friend_id,tag_id,assigned_at) VALUES (?,?,?)",
            )
            .bind(b.lineFriendId, lostTag, jstNow()),
        );
      }
      await db.batch(batch);
      for (const scenarioId of new Set(
        [scenarios.claimed, scenarios[kind]].filter(Boolean),
      ))
        await enrollFriendInScenario(db, friend.id, scenarioId);
      if (
        signed.signature.event === "x.gate.reward_unlocked" &&
        !entry.reward_reply_at
      ) {
        const uncertain = await db
          .prepare(
            "SELECT source_id FROM x_gate_reply_receipts WHERE gate_id=? AND friend_id=? AND reward_response=1 AND status!='done' LIMIT 1",
          )
          .bind(b.gateId, b.lineFriendId)
          .first();
        if (uncertain) throw new Error("reply_delivery_needs_review");
        await db
          .prepare(
            "INSERT OR IGNORE INTO x_gate_notifications(gate_id,friend_id,method,delivery_id,created_at) VALUES (?,?,'push',?,?)",
          )
          .bind(b.gateId, b.lineFriendId, id, Date.now())
          .run();
        const notification = await db
          .prepare(
            "SELECT method,delivery_id,status FROM x_gate_notifications WHERE gate_id=? AND friend_id=?",
          )
          .bind(b.gateId, b.lineFriendId)
          .first<{ method: string; delivery_id: string; status: string }>();
        if (!notification) throw new Error("notification_unavailable");
        if (notification.method === "reply" && notification.status !== "done")
          throw new Error("reply_delivery_needs_review");
        if (notification.status !== "done" && notification.method === "push") {
          if (notification.delivery_id !== id)
            throw new Error("notification_owned_by_another_delivery");
          if (!entry.following) throw new Error("friend_unfollowed");
          const account = await getLineAccountById(
            db,
            campaign.line_account_id,
          );
          if (!account?.is_active) throw new Error("account_unavailable");
          await sendGateLineMessage(
            account.channel_access_token,
            entry.line_user_id,
            gateFlex(b.gateId, {
              ...b,
              status: b.outcome,
              title: campaign.title,
            }),
            {
              deliveryId: id,
              proxyBaseUrl: c.env.WORKER_URL,
              dispatch: (request) =>
                dispatchLineProxyLocally(request, c.env, c.executionCtx),
            },
          );
          await db
            .prepare(
              "UPDATE x_gate_notifications SET status='done' WHERE gate_id=? AND friend_id=? AND delivery_id=?",
            )
            .bind(b.gateId, b.lineFriendId, id)
            .run();
        }
      }
    }
    await db
      .prepare(
        "UPDATE x_gate_inbox SET status='done',completed_at=?,owner=NULL,lease_until=NULL WHERE delivery_id=? AND owner=?",
      )
      .bind(Date.now(), id, owner)
      .run();
    return c.json({ success: true });
  } catch (error) {
    await db
      .prepare(
        "UPDATE x_gate_inbox SET last_error=?,owner=NULL,lease_until=NULL WHERE delivery_id=? AND owner=?",
      )
      .bind(error instanceof Error ? error.message : "failed", id, owner)
      .run();
    return c.json(
      {
        success: false,
        error: "Delivery pending; retry with the same delivery ID",
      },
      503,
    );
  }
});
async function verifiedGateFriend(
  c: Context<Env>,
  campaign: Campaign,
  body: { idToken?: string; accessToken?: string },
) {
  if (
    typeof body.idToken !== "string" ||
    typeof body.accessToken !== "string" ||
    body.idToken.length > 10000 ||
    body.accessToken.length > 10000
  )
    return null;
  const account = await getLineAccountById(c.env.DB, campaign.line_account_id);
  if (!account?.is_active || !account.login_channel_id) return null;
  const verified = await fetch("https://api.line.me/oauth2/v2.1/verify", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      id_token: body.idToken,
      client_id: account.login_channel_id,
    }),
    signal: AbortSignal.timeout(10000),
  });
  if (!verified.ok) return null;
  const identity = (await verified.json()) as { sub?: string; name?: string };
  if (!identity.sub) return null;
  const tokenCheck = await fetch(
    "https://api.line.me/oauth2/v2.1/verify?" +
      new URLSearchParams({ access_token: body.accessToken }),
    { signal: AbortSignal.timeout(10000) },
  );
  if (!tokenCheck.ok) return null;
  const tokenInfo = (await tokenCheck.json()) as {
    client_id?: string;
    expires_in?: number;
  };
  if (
    tokenInfo.client_id !== account.login_channel_id ||
    !tokenInfo.expires_in ||
    tokenInfo.expires_in <= 0
  )
    return null;
  const profile = await fetch("https://api.line.me/v2/profile", {
    headers: { Authorization: `Bearer ${body.accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (
    !profile.ok ||
    ((await profile.json()) as { userId?: string }).userId !== identity.sub
  )
    return null;
  const friendship = await fetch("https://api.line.me/friendship/v1/status", {
    headers: { Authorization: `Bearer ${body.accessToken}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!friendship.ok) return null;
  const following =
    ((await friendship.json()) as { friendFlag?: boolean }).friendFlag === true;
  const bound = await c.env.DB.prepare(
    "SELECT friend_id FROM x_gate_entries WHERE gate_id=? AND line_user_id=?",
  )
    .bind(campaign.gate_id, identity.sub)
    .first<{ friend_id: string }>();
  let friend = bound
    ? await getFriendById(c.env.DB, bound.friend_id)
    : await c.env.DB.prepare(
        "SELECT * FROM friends WHERE line_user_id=? ORDER BY created_at,id LIMIT 1",
      )
        .bind(identity.sub)
        .first<import("@line-crm/db").Friend>();
  if (!friend) {
    const id = crypto.randomUUID(),
      at = jstNow();
    await c.env.DB.prepare(
      "INSERT OR IGNORE INTO friends(id,line_user_id,display_name,is_following,line_account_id,created_at,updated_at) VALUES (?,?,?,?,?,?,?)",
    )
      .bind(
        id,
        identity.sub,
        identity.name ?? null,
        following ? 1 : 0,
        account.id,
        at,
        at,
      )
      .run();
    friend = await c.env.DB.prepare(
      "SELECT * FROM friends WHERE line_user_id=? ORDER BY created_at,id LIMIT 1",
    )
      .bind(identity.sub)
      .first<import("@line-crm/db").Friend>();
  }
  if (!friend || friend.line_user_id !== identity.sub) return null;
  await c.env.DB.prepare(
    "UPDATE friends SET line_account_id=COALESCE(line_account_id,?) WHERE id=?",
  )
    .bind(account.id, friend.id)
    .run();
  await c.env.DB.prepare(
    "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,created_at,last_seen_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(gate_id,friend_id) DO UPDATE SET following=excluded.following,last_seen_at=excluded.last_seen_at",
  )
    .bind(
      campaign.gate_id,
      friend.id,
      account.id,
      identity.sub,
      following ? 1 : 0,
      Date.now(),
      Date.now(),
    )
    .run();
  return { friend, account, following };
}
async function handleLiffGate(c: Context<Env>): Promise<Response> {
  if (!xGateConfigured(c.env))
    return c.json(
      { success: false, error: "Campaign integration unavailable" },
      503,
    );
  const campaign = await c.env.DB.prepare(
    "SELECT * FROM x_gate_campaigns WHERE gate_id=? AND is_active=1",
  )
    .bind(c.req.param("gateId"))
    .first<Campaign>();
  if (!campaign)
    return c.json({ success: false, error: "Campaign not found" }, 404);
  let body: { idToken?: string; accessToken?: string; turnstileToken?: string };
  try {
    body = await c.req.json();
  } catch {
    return c.json({ success: false, error: "Invalid JSON" }, 400);
  }
  let caller: Awaited<ReturnType<typeof verifiedGateFriend>>;
  try {
    caller = await verifiedGateFriend(c, campaign, body ?? {});
  } catch {
    return c.json(
      {
        success: false,
        error: "LINEの認証情報を確認できません。時間をおいてお試しください。",
      },
      503,
    );
  }
  if (!caller)
    return c.json(
      { success: false, error: "LINE authentication required" },
      401,
    );
  c.header("Cache-Control", "no-store");
  if (!caller.following) {
    const info = await dispatchLineProxyLocally(
      new Request(`${c.env.WORKER_URL}/line-api/v2/bot/info`, {
        headers: {
          Authorization: `Bearer ${caller.account.channel_access_token}`,
        },
      }),
      c.env,
      c.executionCtx,
    );
    const bot = info.ok ? ((await info.json()) as { basicId?: string }) : {};
    return c.json({
      success: true,
      data: {
        status: "friend_required",
        title: campaign.title,
        addFriendUrl: bot.basicId
          ? `https://line.me/R/ti/p/${encodeURIComponent(bot.basicId)}`
          : null,
      },
    });
  }
  if (campaign.tier === "strict") {
    const entry = await c.env.DB.prepare(
      "SELECT participant_id,challenge_at FROM x_gate_entries WHERE gate_id=? AND friend_id=?",
    )
      .bind(campaign.gate_id, caller.friend.id)
      .first<{ participant_id: string | null; challenge_at: number | null }>();
    if (
      !entry?.participant_id &&
      (!entry?.challenge_at || entry.challenge_at < Date.now() - 300000)
    ) {
      if (
        !(await verifyGateChallenge(
          c.env,
          campaign.gate_id,
          body.turnstileToken,
          c.req.header("CF-Connecting-IP"),
        ))
      )
        return c.json({
          success: true,
          data: {
            status: "challenge_required",
            title: campaign.title,
            siteKey: c.env.X_GATE_TURNSTILE_SITE_KEY,
          },
        });
      await c.env.DB.prepare(
        "UPDATE x_gate_entries SET challenge_at=? WHERE gate_id=? AND friend_id=?",
      )
        .bind(Date.now(), campaign.gate_id, caller.friend.id)
        .run();
    }
  }
  try {
    if (c.req.path.endsWith("/followup"))
      return c.json({
        success: true,
        data: await acceptXGateFollowup(
          c.env,
          campaign.gate_id,
          caller.friend.id,
          campaign.line_account_id,
        ),
      });
    const result = await joinXGate(
      c.env,
      campaign.gate_id,
      caller.friend.id,
      campaign.line_account_id,
      c.req.path.endsWith("/check"),
    );
    return c.json({ success: true, data: result });
  } catch (error) {
    console.error("X gate participant check failed");
    return c.json(
      {
        success: false,
        error: "現在確認できません。時間をおいてもう一度お試しください。",
      },
      503,
    );
  }
}
xGates.post("/api/liff/x-gates/:gateId/join", handleLiffGate);
xGates.post("/api/liff/x-gates/:gateId/check", handleLiffGate);
xGates.post("/api/liff/x-gates/:gateId/followup", handleLiffGate);
xGates.on(
  ["GET", "POST"],
  "/api/integrations/x-harness/engagement",
  async (c) => {
    const signed = await partner(c);
    if (!signed || signed.signature.event !== "x.gate.analytics")
      return c.json({ success: false, error: "Unauthorized" }, 401);
    const gateId =
      c.req.method === "GET" ? c.req.query("gateId") : signed.body?.gateId;
    if (typeof gateId !== "string")
      return c.json({ success: false, error: "Invalid gate" }, 400);
    const campaign = await c.env.DB.prepare(
      "SELECT line_account_id FROM x_gate_campaigns WHERE gate_id=?",
    )
      .bind(gateId)
      .first<{ line_account_id: string }>();
    if (!campaign) return c.json({ success: false, error: "Not found" }, 404);
    const row = await c.env.DB.prepare(
      "SELECT COUNT(*) AS engaged,COALESCE(SUM(n),0) AS interactions FROM (SELECT e.friend_id,COUNT(*) AS n FROM x_gate_entries e JOIN messages_log m ON m.friend_id=e.friend_id AND m.line_account_id=e.line_account_id WHERE e.gate_id=? AND m.direction='incoming' AND julianday(m.created_at)>=julianday(e.created_at/1000,'unixepoch') AND julianday(m.created_at)<julianday(e.created_at/1000,'unixepoch','+7 days') GROUP BY e.friend_id HAVING COUNT(*)>=2)",
    )
      .bind(gateId)
      .first();
    return c.json({
      success: true,
      data: {
        ...row,
        windowDays: 7,
        metric:
          "observed incoming messages/postbacks; read receipts not assumed",
      },
    });
  },
);
export { xGates };
