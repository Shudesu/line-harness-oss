import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, toToolResult } from "../api-call.js";

export function registerManageTrafficPools(server: McpServer): void {
  server.tool(
    "manage_traffic_pools",
    "Traffic Pool の管理。list: 一覧、create: 作成、update: 更新、delete: 削除、list_accounts: Pool内アカウント一覧、add_account: アカウント追加、remove_account: アカウント削除、toggle_account: 有効/無効切替。複数アカウントで均等分散する。",
    {
      action: z.enum(["list", "create", "update", "delete", "list_accounts", "add_account", "remove_account", "toggle_account"]).describe("Action to perform"),
      poolId: z.string().optional().describe("Pool ID (required for update, delete)"),
      slug: z.string().optional().describe("URL slug e.g. 'main' (required for create)"),
      name: z.string().optional().describe("Pool name (required for create; optional for update)"),
      activeAccountId: z.string().optional().describe("LINE account ID to route traffic to (required for create; optional for update)"),
      isActive: z.boolean().optional().describe("Enable/disable the pool (for update)"),
      lineAccountId: z.string().optional().describe("LINE account ID (for add_account)"),
      poolAccountId: z.string().optional().describe("Pool account ID (for remove_account, toggle_account)"),
    },
    async ({ action, poolId, slug, name, activeAccountId, isActive, lineAccountId, poolAccountId }) => {
      try {
        if (action === "list") {
          return toToolResult(await apiCall("/api/traffic-pools"));
        }

        if (action === "create") {
          if (!slug || !name || !activeAccountId) {
            throw new Error("slug, name, and activeAccountId are required for create");
          }
          return toToolResult(await apiCall("/api/traffic-pools", "POST", { slug, name, activeAccountId }));
        }

        if (action === "update") {
          if (!poolId) throw new Error("poolId is required for update");
          const body: Record<string, unknown> = {};
          if (name !== undefined) body.name = name;
          if (activeAccountId !== undefined) body.activeAccountId = activeAccountId;
          if (isActive !== undefined) body.isActive = isActive;
          return toToolResult(await apiCall(`/api/traffic-pools/${poolId}`, "PUT", body));
        }

        if (action === "delete") {
          if (!poolId) throw new Error("poolId is required for delete");
          return toToolResult(await apiCall(`/api/traffic-pools/${poolId}`, "DELETE"));
        }

        if (action === "list_accounts") {
          if (!poolId) throw new Error("poolId is required for list_accounts");
          return toToolResult(await apiCall(`/api/traffic-pools/${poolId}/accounts`));
        }

        if (action === "add_account") {
          if (!poolId || !lineAccountId) throw new Error("poolId and lineAccountId are required for add_account");
          return toToolResult(await apiCall(`/api/traffic-pools/${poolId}/accounts`, "POST", { lineAccountId }));
        }

        if (action === "remove_account") {
          if (!poolId || !poolAccountId) throw new Error("poolId and poolAccountId are required for remove_account");
          return toToolResult(await apiCall(`/api/traffic-pools/${poolId}/accounts/${poolAccountId}`, "DELETE"));
        }

        if (action === "toggle_account") {
          if (!poolId || !poolAccountId || isActive === undefined) throw new Error("poolId, poolAccountId, and isActive are required for toggle_account");
          return toToolResult(await apiCall(`/api/traffic-pools/${poolId}/accounts/${poolAccountId}`, "PUT", { isActive }));
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (error) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(error) }, null, 2) }],
          isError: true,
        };
      }
    },
  );
}
