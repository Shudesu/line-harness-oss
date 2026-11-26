import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { apiCall, toToolResult } from "../api-call.js";

export function registerManageMessageTemplates(server: McpServer): void {
  server.tool(
    "manage_message_templates",
    "メッセージテンプレートの管理。list: 一覧、get: 詳細取得、create: 作成、update: 更新、delete: 削除。キャンペーン特典メッセージのテンプレートを管理する。",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      templateId: z.string().optional().describe("Template ID (required for get, update, delete)"),
      name: z.string().optional().describe("Template name (for create, update)"),
      messageType: z.enum(["text", "flex"]).optional().describe("Message type: text or flex (for create, update)"),
      messageContent: z.string().optional().describe("Message content — plain text or Flex JSON string (for create, update)"),
    },
    async ({ action, templateId, name, messageType, messageContent }) => {
      try {
        if (action === "list") {
          return toToolResult(await apiCall("/api/message-templates"));
        }

        if (action === "get") {
          if (!templateId) throw new Error("templateId is required for get");
          return toToolResult(await apiCall(`/api/message-templates/${templateId}`));
        }

        if (action === "create") {
          if (!name || !messageType || !messageContent) {
            throw new Error("name, messageType, and messageContent are required for create");
          }
          return toToolResult(await apiCall("/api/message-templates", "POST", { name, messageType, messageContent }));
        }

        if (action === "update") {
          if (!templateId) throw new Error("templateId is required for update");
          const body: Record<string, unknown> = {};
          if (name !== undefined) body.name = name;
          if (messageType !== undefined) body.messageType = messageType;
          if (messageContent !== undefined) body.messageContent = messageContent;
          return toToolResult(await apiCall(`/api/message-templates/${templateId}`, "PUT", body));
        }

        if (action === "delete") {
          if (!templateId) throw new Error("templateId is required for delete");
          return toToolResult(await apiCall(`/api/message-templates/${templateId}`, "DELETE"));
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
