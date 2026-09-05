/**
 * MCP ツールから直接 API を叩くときの共有クライアント。
 *
 * 以前は各ツールが同じ `apiCall` を複製していて、**どれも `res.ok` を見ずに
 * `res.json()` をそのまま返していた**。そのため、テナントの bundle にその口が
 * まだ無い場合（＝機能が古くて存在しない）と、指定した ID が見つからない場合の
 * 両方が、AI からは同じ `{"success":false,"error":"Not found"}` に見えていた。
 *
 * MCP サーバーは `npx -y @line-harness/mcp-server` で常に最新が入る一方、
 * テナントは固定バージョンの bundle で動く。新しいツールを足すほどこの乖離は
 * 広がるので、**「この環境には無い」を明示できないと AI は ID を変えて
 * 何度も試す**（実戦報告の「20以上のエンドポイントを推測で叩いた」と同じ構造）。
 */

export interface ApiCallResult {
  ok: boolean;
  status: number;
  data: unknown;
  /** AI 向けの補足。バージョン差の可能性など、生のエラー本文から読めないこと。 */
  hint?: string;
}

function getApiConfig() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY required");
  return { apiUrl, apiKey };
}

/**
 * ルート未存在（= この bundle には機能が無い）かどうかの判定。
 *
 * Hono の notFound ハンドラは**マッチしなかったルート**に対してだけ
 * `{"success":false,"error":"Not found"}` を返す。各ハンドラ自身が返す 404 は
 * `'Scenario not found'` のように対象名が入るので、本文が厳密に `Not found`
 * のときだけ「ルートが無い」と判定できる。
 */
function looksLikeMissingRoute(status: number, data: unknown): boolean {
  if (status !== 404) return false;
  const err = (data as { error?: unknown } | null)?.error;
  return typeof err === "string" && err.trim() === "Not found";
}

export async function apiCall(path: string, method = "GET", body?: unknown): Promise<ApiCallResult> {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });

  let data: unknown;
  try {
    data = await res.json();
  } catch {
    data = { raw: await res.text().catch(() => "") };
  }

  const result: ApiCallResult = { ok: res.ok, status: res.status, data };

  if (looksLikeMissingRoute(res.status, data)) {
    result.hint =
      `${method} ${path} はこの環境に存在しません。ID の問題ではなく、テナントの bundle が` +
      `この機能を含むバージョンより古い可能性が高いです。ID を変えて再試行しても解決しません。` +
      `GET /admin/version で稼働中のバージョンを確認できます。`;
  } else if (res.status === 401 || res.status === 403) {
    result.hint = `認証に失敗しました（${res.status}）。LINE_HARNESS_API_KEY を確認してください。`;
  }

  return result;
}

/** MCP ツールの戻り値へ整形する。失敗時は isError を立て、hint を添える。 */
export function toToolResult(r: ApiCallResult) {
  const payload = r.hint ? { ...(r.data as object), _hint: r.hint } : r.data;
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    ...(r.ok ? {} : { isError: true as const }),
  };
}
