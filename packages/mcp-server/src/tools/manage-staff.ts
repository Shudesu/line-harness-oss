import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageStaff(server: McpServer): void {
  server.tool(
    "manage_staff",
    "スタッフアカウントの追加・一覧・更新・削除・APIキー再生成。オーナー権限が必要です。",
    {
      action: z
        .enum(["create", "list", "get", "update", "delete", "regenerate_key", "me"])
        .describe("Action to perform"),
      name: z.string().optional().describe("Staff name (for 'create' action)"),
      email: z.string().nullable().optional().describe("Staff email (optional, null to clear)"),
      role: z.enum(["admin", "staff"]).optional().describe("Staff role (for 'create'/'update')"),
      staffId: z.string().optional().describe("Staff ID (for 'get','update','delete','regenerate_key')"),
      isActive: z.boolean().optional().describe("Activate/deactivate (for 'update')"),
    },
    async ({ action, name, email, role, staffId, isActive }) => {
      try {
        const client = getClient();

        if (action === "me") {
          const profile = await client.staff.me();
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, profile }, null, 2) }],
          };
        }

        if (action === "list") {
          const members = await client.staff.list();
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, members }, null, 2) }],
          };
        }

        if (action === "create") {
          if (!name) throw new Error("name is required for create action");
          if (!role) throw new Error("role is required for create action");
          const member = await client.staff.create({ name, email, role });
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true, member,
                note: "APIキーは一度だけ表示されます。安全に保管してください。",
              }, null, 2),
            }],
          };
        }

        if (action === "get") {
          if (!staffId) throw new Error("staffId is required for get action");
          const member = await client.staff.get(staffId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, member }, null, 2) }],
          };
        }

        if (action === "update") {
          if (!staffId) throw new Error("staffId is required for update action");
          const updates: Record<string, unknown> = {};
          if (name !== undefined) updates.name = name;
          if (email !== undefined) updates.email = email;
          if (role !== undefined) updates.role = role;
          if (isActive !== undefined) updates.isActive = isActive;
          const member = await client.staff.update(staffId, updates);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, member }, null, 2) }],
          };
        }

        if (action === "delete") {
          if (!staffId) throw new Error("staffId is required for delete action");
          await client.staff.delete(staffId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: staffId }, null, 2) }],
          };
        }

        if (action === "regenerate_key") {
          if (!staffId) throw new Error("staffId is required for regenerate_key action");
          const result = await client.staff.regenerateKey(staffId);
          return {
            content: [{
              type: "text" as const,
              text: JSON.stringify({
                success: true, staffId, newApiKey: result.apiKey,
                note: "新しいAPIキーは一度だけ表示されます。安全に保管してください。",
              }, null, 2),
            }],
          };
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
