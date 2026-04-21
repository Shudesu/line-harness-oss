// soulflow-proxy-vnew
//
// TruthSphere webhook → (1) Google Apps Script 転送 → (2) Supabase iqb_entries UPSERT
//
// 既存動作（GAS 転送）は 1 行も変えていない。(2) は GAS 転送成功 (resp.ok) 後にだけ
// 実行され、失敗しても GAS 応答をそのままクライアントに返すため後方互換。
//
// Secrets (wrangler secret put で設定):
//   - SUPABASE_URL
//   - SUPABASE_SERVICE_ROLE_KEY
// 両方未設定の環境では Supabase UPSERT をスキップする (本番以外の Worker でも安全に動作させるため)。

// GAS Webアプリの /exec を指定（最新デプロイURL）
const API_URL =
  "https://script.google.com/macros/s/AKfycbz8FCVerL6qb6qI4ASzRqAX1IbmQboCTRZHdG4UcKw8j8V_JqtiL_a0XxqGzar2dHej/exec";
const TOKEN = "soulflow2025";

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "access-control-allow-origin": "*",
      "access-control-allow-methods": "GET,POST,OPTIONS",
      "access-control-allow-headers": "content-type",
    },
  });
}

// 複数候補キーから最初に見つかった非空値を返す
function pick(obj, ...keys) {
  for (const k of keys) {
    const v = obj?.[k];
    if (v !== undefined && v !== null && v !== "") return v;
  }
  return undefined;
}

// Incoming webhook payload → iqb_entries row 形式に整形。
// 必須フィールド不足なら null を返して UPSERT をスキップさせる。
// 呼び出し側の payload 確定までは防御的に複数キー名を受け入れる。
function mapIncomingToIqbEntry(incoming) {
  const tenant_id = pick(incoming, "tenant_id", "tenantId");
  const user_id = pick(incoming, "user_id", "userId");
  const week_number = pick(incoming, "week_number", "weekNumber", "week");
  const week_label = pick(incoming, "week_label", "weekLabel");
  const entry_data =
    pick(incoming, "entry_data", "entryData") ?? incoming.data ?? incoming;
  const version = pick(incoming, "version") ?? 1;

  if (
    !tenant_id ||
    !user_id ||
    week_number === undefined ||
    !week_label ||
    !entry_data
  ) {
    return null;
  }

  return {
    tenant_id,
    user_id,
    week_number:
      typeof week_number === "string" ? parseInt(week_number, 10) : week_number,
    week_label,
    source_gpt_number:
      pick(incoming, "source_gpt_number", "sourceGptNumber") ?? null,
    source_gpt_name: pick(incoming, "source_gpt_name", "sourceGptName") ?? null,
    entry_data,
    version: typeof version === "string" ? parseInt(version, 10) : version,
    is_finalized: pick(incoming, "is_finalized", "isFinalized") ?? false,
    finalized_at: pick(incoming, "finalized_at", "finalizedAt") ?? null,
  };
}

// Supabase PostgREST に対して iqb_entries への UPSERT を実行する。
// 例外を握り潰してはならない (ADR-052 No Silent Fallback) — エラーは呼び出し元で
// GAS 応答と分離して log + response に乗せる。
async function upsertIqbEntry(env, incoming) {
  if (!env?.SUPABASE_URL || !env?.SUPABASE_SERVICE_ROLE_KEY) {
    return { skipped: "supabase_env_missing" };
  }

  const row = mapIncomingToIqbEntry(incoming);
  if (!row) {
    return { skipped: "required_fields_missing" };
  }

  const endpoint = `${env.SUPABASE_URL.replace(/\/$/, "")}/rest/v1/iqb_entries?on_conflict=tenant_id,user_id,week_number,version`;
  const resp = await fetch(endpoint, {
    method: "POST",
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      "content-type": "application/json",
      prefer: "resolution=merge-duplicates,return=minimal",
    },
    body: JSON.stringify(row),
  });

  if (!resp.ok) {
    const body = await resp.text();
    return { ok: false, status: resp.status, error: body.slice(0, 500) };
  }
  return { ok: true, status: resp.status };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (request.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "access-control-allow-origin": "*",
          "access-control-allow-methods": "GET,POST,OPTIONS",
          "access-control-allow-headers": "content-type",
        },
      });
    }

    if (
      request.method === "GET" &&
      (pathname === "/health" || pathname === "/v2/health")
    ) {
      return json({ status: "ok" });
    }

    const isWebhook =
      pathname === "/webhook/soul-diagnosis" ||
      pathname === "/v2/webhook/soul-diagnosis";

    if (request.method === "POST" && isWebhook) {
      let incoming;
      try {
        incoming = await request.json();
      } catch {
        return json({ status: 400, body: { error: "Invalid JSON" } });
      }

      incoming.token = TOKEN;

      // (1) GAS 転送 (既存動作そのまま)
      let gasPayload;
      let gasOk = false;
      try {
        const resp = await fetch(API_URL, {
          method: "POST",
          headers: { "content-type": "application/json" },
          redirect: "follow",
          body: JSON.stringify(incoming),
        });

        gasOk = resp.ok;
        const ct = resp.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          gasPayload = await resp.json();
        } else {
          gasPayload = {
            status: resp.status,
            body: { raw: await resp.text() },
          };
        }

        if (typeof gasPayload?.body !== "object") {
          gasPayload = {
            status: gasPayload?.status ?? resp.status,
            body: { result: gasPayload?.body ?? gasPayload },
          };
        }
      } catch (e) {
        return json({
          status: 500,
          body: { error: "Failed to reach GAS endpoint", message: String(e) },
        });
      }

      // (2) Supabase UPSERT — GAS 成功時のみ実行。失敗は GAS 応答を壊さない。
      if (gasOk) {
        try {
          const supaResult = await upsertIqbEntry(env, incoming);
          gasPayload.body = {
            ...(gasPayload.body ?? {}),
            supabase: supaResult,
          };
        } catch (e) {
          // 観測のため gasPayload に乗せる (silent fallback 禁止)
          gasPayload.body = {
            ...(gasPayload.body ?? {}),
            supabase: { ok: false, error: String(e) },
          };
        }
      }

      return json(gasPayload);
    }

    return new Response("Not Found", { status: 404 });
  },
};
