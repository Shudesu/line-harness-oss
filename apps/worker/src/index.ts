import { Hono } from "hono";
import { cors } from "hono/cors";
import { LineClient } from "@line-crm/line-sdk";
import {
  getLineAccounts,
  getTrafficPoolBySlug,
  getRandomPoolAccount,
  getPoolAccounts,
} from "@line-crm/db";
import { processStepDeliveries } from "./services/step-delivery.js";
import { processScheduledBroadcasts } from "./services/broadcast.js";
import { processReminderDeliveries } from "./services/reminder-delivery.js";
import { checkAccountHealth } from "./services/ban-monitor.js";
import { refreshLineAccessTokens } from "./services/token-refresh.js";
import { processInsightFetch } from "./services/insight-fetcher.js";
import { authMiddleware } from "./middleware/auth.js";
import { rateLimitMiddleware } from "./middleware/rate-limit.js";
import { webhook } from "./routes/webhook.js";
import { friends } from "./routes/friends.js";
import { tags } from "./routes/tags.js";
import { scenarios } from "./routes/scenarios.js";
import { broadcasts } from "./routes/broadcasts.js";
import { users } from "./routes/users.js";
import { lineAccounts } from "./routes/line-accounts.js";
import { conversions } from "./routes/conversions.js";
import { affiliates } from "./routes/affiliates.js";
import { openapi } from "./routes/openapi.js";
import { liffRoutes } from "./routes/liff.js";
// Round 3 ルート
import { webhooks } from "./routes/webhooks.js";
import { calendar } from "./routes/calendar.js";
import { reminders } from "./routes/reminders.js";
import { scoring } from "./routes/scoring.js";
import { templates } from "./routes/templates.js";
import { chats } from "./routes/chats.js";
import { notifications } from "./routes/notifications.js";
import { stripe } from "./routes/stripe.js";
import { health } from "./routes/health.js";
import { automations } from "./routes/automations.js";
import { richMenus } from "./routes/rich-menus.js";
import { trackedLinks } from "./routes/tracked-links.js";
import { forms } from "./routes/forms.js";
import { adPlatforms } from "./routes/ad-platforms.js";
import { staff } from "./routes/staff.js";
import { images } from "./routes/images.js";
import { setup } from "./routes/setup.js";
import { autoReplies } from "./routes/auto-replies.js";
import { trafficPools } from "./routes/traffic-pools.js";
import { meetCallback } from "./routes/meet-callback.js";
import { messageTemplates } from "./routes/message-templates.js";

export type Env = {
  Bindings: {
    DB: D1Database;
    IMAGES: R2Bucket;
    ASSETS: Fetcher;
    LINE_CHANNEL_SECRET: string;
    LINE_CHANNEL_ACCESS_TOKEN: string;
    API_KEY: string;
    LIFF_URL: string;
    LINE_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_ID: string;
    LINE_LOGIN_CHANNEL_SECRET: string;
    WORKER_URL: string;
    MIZUKAGAMI_WORKER_URL: string;
    MIZUKAGAMI_API_KEY: string;
    X_HARNESS_URL?: string;
    IG_HARNESS_URL?: string;
    IG_HARNESS_LINK_SECRET?: string;
  };
  Variables: {
    staff: { id: string; name: string; role: "owner" | "admin" | "staff" };
  };
};

const app = new Hono<Env>();

// CORS — allow all origins for MVP
app.use("*", cors({ origin: "*" }));

// Rate limiting — runs before auth to block abuse early
app.use("*", rateLimitMiddleware);

// Auth middleware — skips /webhook and /docs automatically
app.use("*", authMiddleware);

// Mount route groups — MVP & Round 2
app.route("/", webhook);
app.route("/", friends);
app.route("/", tags);
app.route("/", scenarios);
app.route("/", broadcasts);
app.route("/", users);
app.route("/", lineAccounts);
app.route("/", conversions);
app.route("/", affiliates);
app.route("/", openapi);
app.route("/", liffRoutes);

// Mount route groups — Round 3
app.route("/", webhooks);
app.route("/", calendar);
app.route("/", reminders);
app.route("/", scoring);
app.route("/", templates);
app.route("/", chats);
app.route("/", notifications);
app.route("/", stripe);
app.route("/", health);
app.route("/", automations);
app.route("/", richMenus);
app.route("/", trackedLinks);
app.route("/", forms);
app.route("/", adPlatforms);
app.route("/", staff);
app.route("/", images);
app.route("/", setup);
app.route("/", autoReplies);
app.route("/", trafficPools);
app.route("/", meetCallback);
app.route("/", messageTemplates);

// Self-hosted QR code proxy
app.get("/api/qr", async (c) => {
  const data = c.req.query("data");
  if (!data) return c.text("Missing data param", 400);
  const size = c.req.query("size") || "240x240";
  const upstream = `https://api.qrserver.com/v1/create-qr-code/?size=${encodeURIComponent(size)}&data=${encodeURIComponent(data)}`;
  const res = await fetch(upstream);
  if (!res.ok) return c.text("QR generation failed", 502);
  return new Response(res.body, {
    headers: {
      "Content-Type": res.headers.get("Content-Type") || "image/png",
      "Cache-Control": "public, max-age=86400",
    },
  });
});

// Short link: /r/:ref → landing page with LINE open button
app.get("/r/:ref", async (c) => {
  const ref = c.req.param("ref");
  const formId = c.req.query("form") || "";
  const baseUrl = new URL(c.req.url).origin;

  let liffUrl = c.env.LIFF_URL;
  const poolSlug = c.req.query("pool") || "main";
  const pool = await getTrafficPoolBySlug(c.env.DB, poolSlug);
  if (pool) {
    const account = await getRandomPoolAccount(c.env.DB, pool.id);
    if (account) {
      if (account.liff_id) liffUrl = `https://liff.line.me/${account.liff_id}`;
    } else {
      const allAccounts = await getPoolAccounts(c.env.DB, pool.id);
      if (allAccounts.length === 0) {
        if (pool.liff_id) liffUrl = `https://liff.line.me/${pool.liff_id}`;
      }
    }
  }

  const liffIdMatch = liffUrl.match(/liff\.line\.me\/([0-9]+-[A-Za-z0-9]+)/);
  const liffParams = new URLSearchParams();
  if (liffIdMatch) liffParams.set("liffId", liffIdMatch[1]);
  if (ref) liffParams.set("ref", ref);
  if (formId) liffParams.set("form", formId);
  const gate = c.req.query("gate");
  if (gate) liffParams.set("gate", gate);
  const xh = c.req.query("xh");
  if (xh) liffParams.set("xh", xh);
  const ig = c.req.query("ig");
  if (ig) liffParams.set("ig", ig);
  const liffTarget = liffParams.toString()
    ? `${liffUrl}?${liffParams.toString()}`
    : liffUrl;

  const authParams = new URLSearchParams();
  authParams.set("ref", ref);
  if (formId) authParams.set("form", formId);
  const poolParam = c.req.query("pool");
  if (poolParam) authParams.set("pool", poolParam);
  if (gate) authParams.set("gate", gate);
  if (xh) authParams.set("xh", xh);
  if (ig) authParams.set("ig", ig);
  const authFallback = `${baseUrl}/auth/oauth?${authParams.toString()}`;

  const ua = (c.req.header("user-agent") || "").toLowerCase();
  const isMobile = /iphone|ipad|android|mobile/.test(ua);
  const isXInAppBrowser = /twitter|twitterandroid/i.test(
    c.req.header("user-agent") || "",
  );
  const isOtherInApp = /\b(fbav|fban|instagram|line\/|micromessenger)\b/i.test(
    c.req.header("user-agent") || "",
  );

  if (isMobile && (isXInAppBrowser || isOtherInApp)) {
    const inAppName = isXInAppBrowser ? "X" : "アプリ内";
    return c.html(
      `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LINE で開く</title></head><body><p>${inAppName}内ブラウザでは LINE が開けません。Safari などの外部ブラウザで開いてください。</p><a href="${liffTarget}">LINE で開く</a></body></html>`,
    );
  }

  if (isMobile) {
    return c.html(
      `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LINE で開く</title></head><body><a href="${liffTarget}">LINE で開く</a><br><a href="${authFallback}">開かない場合はこちら</a></body></html>`,
    );
  }

  return c.html(
    `<!DOCTYPE html><html lang="ja"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>LINE で開く</title></head><body><p>スマートフォンで QR コードを読み取ってください</p><img src="/api/qr?size=240x240&data=${encodeURIComponent(liffTarget)}" alt="QR Code"></body></html>`,
  );
});

// Convenience redirect for /book path
app.get("/book", (c) => c.redirect("/?page=book"));

// 404 fallback — API paths return JSON 404, everything else serves from static assets
app.notFound(async (c) => {
  const path = new URL(c.req.url).pathname;
  if (
    path.startsWith("/api/") ||
    path === "/webhook" ||
    path === "/docs" ||
    path === "/openapi.json"
  ) {
    return c.json({ success: false, error: "Not found" }, 404);
  }
  return c.env.ASSETS.fetch(c.req.raw);
});

// Scheduled handler for cron triggers
async function scheduled(
  _event: ScheduledEvent,
  env: Env["Bindings"],
  _ctx: ExecutionContext,
): Promise<void> {
  const dbAccounts = await getLineAccounts(env.DB);
  const activeTokens = new Set<string>();
  activeTokens.add(env.LINE_CHANNEL_ACCESS_TOKEN);
  for (const account of dbAccounts) {
    if (account.is_active) {
      activeTokens.add(account.channel_access_token);
    }
  }

  const lineClients = new Map<string, LineClient>();
  for (const account of dbAccounts) {
    if (account.is_active) {
      lineClients.set(account.id, new LineClient(account.channel_access_token));
    }
  }
  const defaultLineClient = new LineClient(env.LINE_CHANNEL_ACCESS_TOKEN);

  const jobs = [];
  for (const token of activeTokens) {
    const lineClient = new LineClient(token);
    jobs.push(
      processStepDeliveries(env.DB, lineClient, env.WORKER_URL),
      processScheduledBroadcasts(env.DB, lineClient, env.WORKER_URL),
      processReminderDeliveries(env.DB, lineClient),
    );
  }
  jobs.push(checkAccountHealth(env.DB));
  jobs.push(refreshLineAccessTokens(env.DB));

  await Promise.allSettled(jobs);

  try {
    await processInsightFetch(env.DB, lineClients, defaultLineClient);
  } catch (e) {
    console.error("Insight fetch error:", e);
  }
}

export default {
  fetch: app.fetch,
  scheduled,
};
