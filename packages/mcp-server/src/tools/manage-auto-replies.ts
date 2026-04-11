import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageAutoReplies(server: McpServer): void {
  server.tool(
    "manage_auto_replies",
    "自動応答の管理操作。list: 一覧、get: 詳細、create: 作成、update: 更新、delete: 削除。キーワードに一致するメッセージに自動返信する。",
    {
      action: z.enum(["list", "get", "create", "update", "delete"]).describe("Action to perform"),
      autoReplyId: z.string().optional().describe("Auto-reply ID (required for get, update, delete)"),
      keyword: z.string().optional().describe("Keyword to match (for create, update)"),
      matchType: z.enum(["exact", "contains"]).optional().describe("Match type: exact or contains (for create, update)"),
      responseType: z.enum(["text", "image", "flex"]).optional().describe("Response message type (for create, update)"),
      responseContent: z.string().optional().describe("Response message content (for create, update)"),
      lineAccountId: z.string().nullable().optional().describe("LINE account ID filter (for list, create, update)"),
      isActive: z.boolean().optional().describe("Active status (for update)"),
    },
    async ({ action, autoReplyId, keyword, matchType, responseType, responseContent, lineAccountId, isActive }) => {
      try {
        const client = getClient();
        if (action === "list") {
          const items = await client.autoReplies.list(lineAccountId ?? undefined);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, autoReplies: items }, null, 2) }] };
        }
        if (action === "create") {
          if (!keyword) throw new Error("keyword is required for create");
          if (!responseContent) throw new Error("responseContent is required for create");
          const createInput: Record<string, unknown> = {
            keyword,
            responseContent,
          };
          if (matchType !== undefined) createInput.matchType = matchType;
          if (responseType !== undefined) createInput.responseType = responseType;
          if (lineAccountId !== undefined) createInput.lineAccountId = lineAccountId;
          const item = await client.autoReplies.create(createInput as Parameters<typeof client.autoReplies.create>[0]);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, autoReply: item }, null, 2) }] };
        }
        if (!autoReplyId) throw new Error("autoReplyId is required for this action");
        if (action === "get") {
          const item = await client.autoReplies.get(autoReplyId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, autoReply: item }, null, 2) }] };
        }
        if (action === "update") {
          const input: Record<string, unknown> = {};
          if (keyword !== undefined) input.keyword = keyword;
          if (matchType !== undefined) input.matchType = matchType;
          if (responseType !== undefined) input.responseType = responseType;
          if (responseContent !== undefined) input.responseContent = responseContent;
          if (lineAccountId !== undefined) input.lineAccountId = lineAccountId;
          if (isActive !== undefined) input.isActive = isActive;
          const item = await client.autoReplies.update(autoReplyId, input);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, autoReply: item }, null, 2) }] };
        }
        if (action === "delete") {
          await client.autoReplies.delete(autoReplyId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: autoReplyId }, null, 2) }] };
        }
        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }], isError: true };
      }
    },
  );
}
