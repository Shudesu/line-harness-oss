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
  const data = await res.json();
  if (!res.ok) throw new Error(`API ${res.status}: ${JSON.stringify(data)}`);
  return data;
}

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
          const data = await apiCall("/api/message-templates");
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "get") {
          if (!templateId) throw new Error("templateId is required for get");
          const data = await apiCall(`/api/message-templates/${templateId}`);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "create") {
          if (!name || !messageType || !messageContent) {
            throw new Error("name, messageType, and messageContent are required for create");
          }
          const data = await apiCall("/api/message-templates", "POST", { name, messageType, messageContent });
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "update") {
          if (!templateId) throw new Error("templateId is required for update");
          const body: Record<string, unknown> = {};
          if (name !== undefined) body.name = name;
          if (messageType !== undefined) body.messageType = messageType;
          if (messageContent !== undefined) body.messageContent = messageContent;
          const data = await apiCall(`/api/message-templates/${templateId}`, "PUT", body);
          return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
        }

        if (action === "delete") {
          if (!templateId) throw new Error("templateId is required for delete");
          const data = await apiCall(`/api/message-templates/${templateId}`, "DELETE");
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
