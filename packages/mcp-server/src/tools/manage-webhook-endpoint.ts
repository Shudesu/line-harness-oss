import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, toToolResult } from "../api-call.js";

/**
 * manage_webhook_endpoint — B-10.
 *
 * Confirms (and fixes) the webhook URL registered on the LINE channel:
 *   - check: GET the registered endpoint + run LINE's /webhook/test. Read-only
 *     against the channel; safe to run any time.
 *   - set:   PUT the expected URL (${WORKER_URL}/webhook). Requires
 *     confirm=true. When the channel currently points at a different URL,
 *     the check result is returned as a warning and nothing is overwritten
 *     until the operator confirms — other tools' webhook configuration is
 *     never silently replaced.
 */
export function registerManageWebhookEndpoint(server: McpServer): void {
  server.tool(
    "manage_webhook_endpoint",
    "LINEチャネルに登録されたWebhook URLの確認（疎通テスト付き）と、このWorkerへの設定・修正。setはconfirm=true必須。既存のURLが別の宛先のときは勝手に上書きせず警告してconfirmを要求します。",
    {
      action: z.enum(["check", "set"]).describe(
        "check: 現在のWebhook URLと疎通を確認する（読み取りのみ）。set: このWorkerのURLに設定・修正する（confirm必須）",
      ),
      accountId: z.string().optional().describe("LINE account ID。省略時はアカウントが1件だけのとき自動選択"),
      confirm: z.boolean().optional().describe(
        "set実行の承認。trueでない限り何も書き換えません（既存URLが別宛先のときは必須）",
      ),
    },
    async ({ action, accountId, confirm }) => {
      try {
        // Resolve the account. Never guess when several accounts exist —
        // rewriting the wrong channel's webhook is exactly the accident this
        // tool must not cause.
        let targetId = accountId;
        if (!targetId) {
          const list = await apiCall("/api/line-accounts");
          if (!list.ok) return toToolResult(list);
          const items = (list.data as { data?: Array<{ id: string; isActive?: boolean }> } | null)?.data ?? [];
          const active = items.filter((a) => a.isActive !== false);
          if (active.length === 1) {
            targetId = active[0].id;
          } else {
            return {
              content: [
                {
                  type: "text" as const,
                  text: JSON.stringify(
                    {
                      success: false,
                      error: `accountId の指定が必要です（登録アカウントが ${items.length} 件あります）。誤ったチャネルのWebhookを書き換えないため自動選択しません`,
                    },
                    null,
                    2,
                  ),
                },
              ],
              isError: true,
            };
          }
        }
        const id = encodeURIComponent(targetId);

        if (action === "check") {
          const result = await apiCall(`/api/line-accounts/${id}/webhook-endpoint`);
          return toToolResult(result);
        }

        // action === "set"
        if (confirm !== true) {
          // Read-only preview: show what would change and what the current
          // state is, so the operator can confirm on real information.
          const preview = await apiCall(`/api/line-accounts/${id}/webhook-endpoint`);
          const current =
            (preview.data as { data?: { endpoint?: string; expectedUrl?: string; matches?: boolean | null } } | null)
              ?.data ?? {};
          const foreign = Boolean(current.endpoint) && current.endpoint !== current.expectedUrl;
          return {
            content: [
              {
                type: "text" as const,
                text: JSON.stringify(
                  {
                    success: false,
                    requiresConfirm: true,
                    error: foreign
                      ? "既存の Webhook URL が別の URL に向いています。勝手に上書きはしません。内容を確認した上で confirm=true を付けて再実行してください"
                      : "Webhook URL の設定は明示的な確認が必要です。confirm=true を付けて再実行してください",
                    currentEndpoint: current.endpoint ?? "",
                    expectedUrl: current.expectedUrl ?? null,
                    preview: preview.data,
                  },
                  null,
                  2,
                ),
              },
            ],
          };
        }
        const result = await apiCall(`/api/line-accounts/${id}/webhook-endpoint`, "PUT", { confirm: true });
        return toToolResult(result);
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: String(error) }, null, 2),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
