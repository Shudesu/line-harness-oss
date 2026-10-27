import { describe, it, expect, vi, afterEach } from "vitest";
import { Hono } from "hono";
import Database from "better-sqlite3";
import { readFileSync } from "node:fs";
import { joinXGate } from "../services/x-gate-client.js";
import { handleXGateWebhook } from "../services/x-gate-webhook.js";
import { xGates } from "./x-gates.js";
import { signHarnessRequest } from "../services/harness-gate-protocol.js";
import type { Env } from "../index.js";
const proxyMock = vi.hoisted(() => ({ dispatch: vi.fn() }));
vi.mock("../services/local-line-proxy.js", () => ({
  dispatchLineProxyLocally: (request: Request) => proxyMock.dispatch(request),
}));
const secret = "synthetic-partner-secret-long-enough-for-tests";
function fixture() {
  proxyMock.dispatch.mockReset();
  proxyMock.dispatch.mockImplementation((request: Request) => fetch(request));
  const sql = new Database(":memory:");
  sql.exec(
    `CREATE TABLE line_accounts(id TEXT PRIMARY KEY,channel_id TEXT,channel_access_token TEXT,login_channel_id TEXT,liff_id TEXT,is_active INTEGER,created_at TEXT);CREATE TABLE tags(id TEXT PRIMARY KEY,name TEXT,color TEXT,created_at TEXT);CREATE TABLE tracked_links(id TEXT PRIMARY KEY,name TEXT,original_url TEXT,line_account_id TEXT,is_active INTEGER,click_count INTEGER,created_at TEXT,updated_at TEXT);CREATE TABLE friends(id TEXT PRIMARY KEY,line_user_id TEXT UNIQUE,line_account_id TEXT,display_name TEXT,is_following INTEGER,metadata TEXT DEFAULT '{}',created_at TEXT,updated_at TEXT);CREATE TABLE friend_tags(friend_id TEXT,tag_id TEXT,assigned_at TEXT,PRIMARY KEY(friend_id,tag_id));CREATE TABLE scenarios(id TEXT PRIMARY KEY,line_account_id TEXT,is_active INTEGER,delivery_mode TEXT);CREATE TABLE scenario_steps(id TEXT PRIMARY KEY,scenario_id TEXT,step_order INTEGER,delay_minutes INTEGER,offset_days INTEGER,offset_minutes INTEGER,delivery_time TEXT);CREATE TABLE friend_scenarios(id TEXT PRIMARY KEY,friend_id TEXT,scenario_id TEXT,current_step_order INTEGER,status TEXT,started_at TEXT,next_delivery_at TEXT,updated_at TEXT,UNIQUE(friend_id,scenario_id));CREATE TABLE messages_log(id TEXT PRIMARY KEY,friend_id TEXT,line_account_id TEXT,direction TEXT,message_type TEXT,content TEXT,broadcast_id TEXT,scenario_step_id TEXT,source TEXT,created_at TEXT);INSERT INTO line_accounts VALUES ('a','channel-a','synthetic-token','login-a','111-fixture',1,'2020');INSERT INTO friends VALUES ('f','Ufixture','a','Fixture',1,'{}','2020','2020');`,
  );
  sql.exec(
    readFileSync(
      "../../packages/db/migrations/073_x_line_first_gates.sql",
      "utf8",
    ),
  );
  const stmt = (query: string, binds: unknown[] = []) => ({
    bind: (...v: unknown[]) => stmt(query, v),
    first: async () => sql.prepare(query).get(...binds) ?? null,
    all: async () => ({ results: sql.prepare(query).all(...binds) }),
    run: async () => ({
      meta: { changes: sql.prepare(query).run(...binds).changes },
    }),
    _run: () => ({
      meta: { changes: sql.prepare(query).run(...binds).changes },
    }),
  });
  const db = {
    prepare: (q: string) => stmt(q),
    batch: async (list: any[]) =>
      sql.transaction(() => list.map((s) => s._run()))(),
  } as any;
  const env = {
    DB: db,
    WORKER_URL: "https://line.example",
    X_HARNESS_URL: "https://x.example",
    X_HARNESS_CONNECTION_ID: "connection",
    X_HARNESS_GATE_SECRET: secret,
  } as Env["Bindings"];
  const app = new Hono<Env>();
  app.use("*", async (c, next) => {
    c.set("staff", { id: "owner", name: "Owner", role: "owner" });
    await next();
  });
  app.route("/", xGates);
  const signed = async (
    path: string,
    event: string,
    payload: unknown,
    deliveryId = crypto.randomUUID(),
  ) => {
    const body = JSON.stringify(payload),
      headers = await signHarnessRequest(secret, "POST", path, body, {
        connectionId: "connection",
        event,
        deliveryId,
      });
    return app.request(
      new Request("https://line.example" + path, {
        method: "POST",
        headers,
        body,
      }),
      undefined,
      env,
      { waitUntil: () => {}, passThroughOnException: () => {} } as any,
    );
  };
  const setup = () =>
    signed("/api/integrations/x-harness/campaigns", "x.gate.configure", {
      gateId: "g",
      slug: "spring",
      name: "Spring",
      tier: "standard",
      lineAccountId: "a",
    });
  return { sql, db, env, app, signed, setup };
}
afterEach(() => vi.unstubAllGlobals());
describe("X gate LINE integration", () => {
  it("creates campaign assets atomically and retries with the same refs", async () => {
    const f = fixture();
    const a = await f.setup(),
      b = await f.setup();
    expect(a.status).toBe(201);
    expect(b.status).toBe(200);
    expect(((await a.json()) as any).data.trackedLinkRef).toBe(
      ((await b.json()) as any).data.trackedLinkRef,
    );
    expect((f.sql.prepare("SELECT COUNT(*) n FROM tags").get() as any).n).toBe(
      3,
    );
    expect(
      (f.sql.prepare("SELECT COUNT(*) n FROM tracked_links").get() as any).n,
    ).toBe(1);
  });
  it("rejects an unsigned event before assigning tags or sending messages", async () => {
    const f = fixture(),
      fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    const result = await f.app.request(
      "https://line.example/api/integrations/x-harness/events",
      { method: "POST", body: "{}" },
      f.env,
    );
    expect(result.status).toBe(401);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it("deduplicates rewards, keeps account scope, and does not downgrade a result on a later verified event", async () => {
    const f = fixture();
    await f.setup();
    f.sql
      .prepare(
        "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,created_at,last_seen_at) VALUES ('g','f','a','Ufixture',1,?,?)",
      )
      .run(Date.now(), Date.now());
    const fetcher = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        new Response("{}", { status: 200 }),
    );
    vi.stubGlobal("fetch", fetcher);
    const id = crypto.randomUUID(),
      payload = {
        schema: "xh.gate.v1",
        gateId: "g",
        participantId: "participant",
        lineFriendId: "f",
        xUserId: "123",
        xUsername: "fixture",
        outcome: "won",
        rank: 1,
        reward: { label: "Gift", type: "coupon_code", value: "SYNTHETIC" },
      };
    expect(
      (
        await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.reward_unlocked",
          payload,
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.reward_unlocked",
          payload,
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      (
        await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.verified",
          payload,
        )
      ).status,
    ).toBe(200);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect((fetcher.mock.calls[0][0] as Request).url).toBe(
      "https://line.example/line-api/v2/bot/message/push",
    );
    expect(
      (fetcher.mock.calls[0][0] as Request).headers.get("X-Line-Retry-Key"),
    ).toBe(id);
    expect(
      (
        f.sql
          .prepare("SELECT state FROM x_gate_entries WHERE gate_id='g'")
          .get() as any
      ).state,
    ).toBe("won");
    expect(
      (f.sql.prepare("SELECT COUNT(*) n FROM friend_external_ids").get() as any)
        .n,
    ).toBe(1);
    expect(
      (
        await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.reward_unlocked",
          { ...payload, lineFriendId: "other" },
          id,
        )
      ).status,
    ).toBe(409);
  });
  it("retries a failed push with the same provider key and recognizes an accepted duplicate", async () => {
    const f = fixture();
    await f.setup();
    f.sql.exec(
      "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,created_at,last_seen_at) VALUES ('g','f','a','Ufixture',1,1,1)",
    );
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(new Response("{}", { status: 429 }))
      .mockResolvedValueOnce(
        new Response("{}", {
          status: 409,
          headers: { "x-line-accepted-request-id": "accepted" },
        }),
      );
    vi.stubGlobal("fetch", fetcher);
    const id = crypto.randomUUID(),
      payload = {
        gateId: "g",
        participantId: "p",
        lineFriendId: "f",
        outcome: "won",
        reward: { label: "Gift", type: "line_message", value: "Thanks" },
      };
    expect(
      (
        await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.reward_unlocked",
          payload,
          id,
        )
      ).status,
    ).toBe(503);
    expect(
      (
        await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.reward_unlocked",
          payload,
          id,
        )
      ).status,
    ).toBe(200);
    expect(
      fetcher.mock.calls.map((c) =>
        (c[0] as Request).headers.get("X-Line-Retry-Key"),
      ),
    ).toEqual([id, id]);
  });
  it("rejects a LINE access token for a different Login channel", async () => {
    const f = fixture();
    await f.setup();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json({ sub: "Ufixture" }))
      .mockResolvedValueOnce(
        Response.json({ client_id: "other-login", expires_in: 3600 }),
      );
    vi.stubGlobal("fetch", fetcher);
    const response = await f.app.request(
      "https://line.example/api/liff/x-gates/g/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: "synthetic",
          accessToken: "synthetic",
          friendId: "forged",
        }),
      },
      f.env,
    );
    expect(response.status).toBe(401);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
  it("derives the friend from verified LINE identity and does not push a code to an existing friend", async () => {
    const f = fixture();
    await f.setup();
    const requests: Array<{ url: string; body: any }> = [];
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        const u = String(url);
        requests.push({ url: u, body: init?.body });
        if (u.endsWith("/oauth2/v2.1/verify"))
          return Response.json({ sub: "Ufixture", name: "Fixture" });
        if (u.includes("/oauth2/v2.1/verify?"))
          return Response.json({ client_id: "login-a", expires_in: 3600 });
        if (u.endsWith("/v2/profile"))
          return Response.json({ userId: "Ufixture" });
        if (u.includes("/friendship/"))
          return Response.json({ friendFlag: true });
        return Response.json({
          success: true,
          data: {
            participantId: "p",
            status: "awaiting_reply",
            displayCode: "春プレ-AAAAA",
            goUrl: "https://x.example/c/spring/go?c=AAAAA",
          },
        });
      },
    );
    vi.stubGlobal("fetch", fetcher);
    const response = await f.app.request(
      "https://line.example/api/liff/x-gates/g/join",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          idToken: "synthetic",
          accessToken: "synthetic",
          lineFriendId: "forged",
        }),
      },
      f.env,
    );
    expect(response.status).toBe(200);
    const claim = requests.find((r) => r.url.startsWith("https://x.example"))!;
    expect(JSON.parse(claim.body).lineFriendId).toBe("f");
    expect(requests.some((r) => r.url.includes("/message/push"))).toBe(false);
  });
});

it("enrolls the configured scenario once even when verified and reward events are both retried", async () => {
  const f = fixture();
  f.sql.exec(
    "INSERT INTO scenarios VALUES ('scenario','a',1,'relative');INSERT INTO scenario_steps VALUES ('step','scenario',0,0,NULL,NULL,NULL)",
  );
  await f.signed("/api/integrations/x-harness/campaigns", "x.gate.configure", {
    gateId: "g",
    slug: "spring",
    name: "Spring",
    tier: "standard",
    lineAccountId: "a",
    scenarios: { claimed: "scenario", won: "scenario" },
  });
  f.sql.exec(
    "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,created_at,last_seen_at) VALUES ('g','f','a','Ufixture',1,1,1)",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => Response.json({})),
  );
  const payload = {
    gateId: "g",
    participantId: "p",
    lineFriendId: "f",
    outcome: "won",
    reward: { label: "Gift", type: "line_message", value: "Thanks" },
  };
  await f.signed(
    "/api/integrations/x-harness/events",
    "x.gate.verified",
    payload,
  );
  await f.signed(
    "/api/integrations/x-harness/events",
    "x.gate.reward_unlocked",
    payload,
  );
  expect(
    (f.sql.prepare("SELECT COUNT(*) n FROM friend_scenarios").get() as any).n,
  ).toBe(1);
  expect(
    f.sql
      .prepare("SELECT current_step_order,status FROM friend_scenarios")
      .get(),
  ).toMatchObject({ current_step_order: -1, status: "active" });
});

it("refuses to create strict campaigns until the LINE-side challenge is configured", async () => {
  const f = fixture();
  const response = await f.signed(
    "/api/integrations/x-harness/campaigns",
    "x.gate.configure",
    {
      gateId: "g",
      slug: "spring",
      name: "Spring",
      tier: "strict",
      lineAccountId: "a",
    },
  );
  expect(response.status).toBe(400);
  expect(
    (f.sql.prepare("SELECT COUNT(*) n FROM x_gate_campaigns").get() as any).n,
  ).toBe(0);
});

describe("result reply and automatic push arbitration", () => {
  const payload = {
    gateId: "g",
    participantId: "p",
    lineFriendId: "f",
    outcome: "won",
    reward: { label: "Gift", type: "line_message", value: "Thanks" },
  };
  for (const ambiguous of [false, true])
    it(
      ambiguous
        ? "holds an ambiguous reward reply without a second push"
        : "logs a reward reply as automated and suppresses the later push",
      async () => {
        const f = fixture();
        await f.setup();
        vi.stubGlobal(
          "fetch",
          vi.fn(async () =>
            Response.json({
              success: true,
              data: { ...payload, status: "won" },
            }),
          ),
        );
        const dispatch = vi.fn(async () => {
          if (ambiguous) throw new Error("synthetic timeout");
          return Response.json({});
        });
        const input = {
          type: "postback" as const,
          friendId: "f",
          lineAccountId: "a",
          lineUserId: "Ufixture",
          replyToken: "synthetic-reply-token",
          sourceId: "synthetic-event",
          data: "action=xgate_check&gate=g",
          proxyDispatch: dispatch,
        };
        expect(await handleXGateWebhook(f.env, input)).toBe(true);
        expect(await handleXGateWebhook(f.env, input)).toBe(true);
        expect(dispatch).toHaveBeenCalledTimes(1);
        const response = await f.signed(
          "/api/integrations/x-harness/events",
          "x.gate.reward_unlocked",
          payload,
        );
        expect(response.status).toBe(ambiguous ? 503 : 200);
        expect(proxyMock.dispatch).not.toHaveBeenCalled();
        const logs = f.sql.prepare("SELECT source FROM messages_log").all();
        expect(logs).toEqual(ambiguous ? [] : [{ source: "auto_reply" }]);
      },
    );
  it("does not send the reward twice when the push wins the race with a check reply", async () => {
    const f = fixture();
    await f.setup();
    let release!: () => void;
    const hold = new Promise<void>((resolve) => {
      release = resolve;
    });
    let entered!: () => void;
    const started = new Promise<void>((resolve) => {
      entered = resolve;
    });
    f.sql.exec(
      "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,created_at,last_seen_at) VALUES ('g','f','a','Ufixture',1,1,1)",
    );
    proxyMock.dispatch.mockImplementation(async () => {
      entered();
      await hold;
      return Response.json({});
    });
    const sending = f.signed(
      "/api/integrations/x-harness/events",
      "x.gate.reward_unlocked",
      payload,
    );
    await started;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        Response.json({ success: true, data: { ...payload, status: "won" } }),
      ),
    );
    const dispatch = vi.fn(async (_request: Request) => Response.json({}));
    await handleXGateWebhook(f.env, {
      type: "postback",
      friendId: "f",
      lineAccountId: "a",
      lineUserId: "Ufixture",
      replyToken: "synthetic-token",
      sourceId: "concurrent-check",
      data: "action=xgate_check&gate=g",
      proxyDispatch: dispatch,
    });
    const reply = (await (dispatch.mock.calls[0][0] as Request).json()) as {
      messages: Array<{ type: string }>;
    };
    expect(reply.messages[0].type).toBe("text");
    expect(JSON.stringify(reply)).not.toContain("Thanks");
    release();
    expect((await sending).status).toBe(200);
    expect(proxyMock.dispatch).toHaveBeenCalledTimes(1);
  });
});

it("does not downgrade a delivered result when an older claim request finishes later", async () => {
  const f = fixture();
  await f.setup();
  f.sql.exec(
    "INSERT INTO x_gate_entries(gate_id,friend_id,line_account_id,line_user_id,following,state,result,created_at,last_seen_at) VALUES ('g','f','a','Ufixture',1,'won','{\"status\":\"won\"}',1,1)",
  );
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      Response.json({
        success: true,
        data: { status: "awaiting_reply", participantId: "p" },
      }),
    ),
  );
  await joinXGate(f.env, "g", "f", "a");
  expect(
    f.sql.prepare("SELECT state,result FROM x_gate_entries").get(),
  ).toMatchObject({ state: "won", result: '{"status":"won"}' });
});
