import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

function getApiConfig() {
  const apiUrl = process.env.LINE_HARNESS_API_URL;
  const apiKey = process.env.LINE_HARNESS_API_KEY;
  if (!apiUrl || !apiKey) throw new Error("LINE_HARNESS_API_URL and LINE_HARNESS_API_KEY required");
  return { apiUrl, apiKey };
}

async function apiCall(path: string, method = "GET", body?: unknown) {
  const { apiUrl, apiKey } = getApiConfig();
  const res = await fetch(`${apiUrl}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  return res.json();
}

export function registerManageOrganizations(server: McpServer): void {
  server.tool(
    "manage_organizations",
    "Organization（複数LINE公式アカウントを束ねる顧客台帳の単位）の管理。list: 一覧、get: 詳細、create: 作成、rename: 名称変更、delete: 削除、assign_account: LINEアカウントを組織に割り当て、unassign_account: 割り当て解除、ltv: 組織別LTVロールアップ（承認済みコンバージョン + Stripe決済の合算）取得。",
    {
      action: z.enum(["list", "get", "create", "rename", "delete", "assign_account", "unassign_account", "ltv"]).describe("Action to perform"),
      organizationId: z.string().optional().describe("Organization ID (required for get, rename, delete, assign_account, unassign_account)"),
      name: z.string().optional().describe("Organization name (for create, rename)"),
      lineAccountId: z.string().optional().describe("LINE account ID (for assign_account, unassign_account)"),
      startDate: z.string().optional().describe("ISO date lower bound for ltv rollup (for ltv)"),
      endDate: z.string().optional().describe("ISO date upper bound for ltv rollup (for ltv)"),
    },
    async ({ action, organizationId, name, lineAccountId, startDate, endDate }) => {
      try {
        if (action === "list") {
          const data = await apiCall("/api/organizations");
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "get") {
          if (!organizationId) throw new Error("organizationId is required for get");
          const data = await apiCall(`/api/organizations/${organizationId}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "create") {
          if (!name) throw new Error("name is required for create");
          const data = await apiCall("/api/organizations", "POST", { name });
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "rename") {
          if (!organizationId || !name) throw new Error("organizationId and name are required for rename");
          const data = await apiCall(`/api/organizations/${organizationId}`, "PATCH", { name });
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "delete") {
          if (!organizationId) throw new Error("organizationId is required for delete");
          const data = await apiCall(`/api/organizations/${organizationId}`, "DELETE");
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "assign_account") {
          if (!organizationId || !lineAccountId) throw new Error("organizationId and lineAccountId are required for assign_account");
          const data = await apiCall(`/api/organizations/${organizationId}/accounts/${lineAccountId}`, "PUT");
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "unassign_account") {
          if (!organizationId || !lineAccountId) throw new Error("organizationId and lineAccountId are required for unassign_account");
          const data = await apiCall(`/api/organizations/${organizationId}/accounts/${lineAccountId}`, "DELETE");
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "ltv") {
          const params = new URLSearchParams();
          if (startDate) params.set("startDate", startDate);
          if (endDate) params.set("endDate", endDate);
          const qs = params.toString();
          const data = await apiCall(`/api/organizations/ltv${qs ? `?${qs}` : ""}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
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
