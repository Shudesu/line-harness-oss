import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageFriends(server: McpServer): void {
  server.tool(
    "manage_friends",
    "友だちの管理操作。count: 友だち数取得、set_metadata: メタデータ更新、set_rich_menu: リッチメニュー割当、remove_rich_menu: リッチメニュー解除。",
    {
      action: z
        .enum(["count", "set_metadata", "set_rich_menu", "remove_rich_menu"])
        .describe("Action to perform"),
      friendId: z
        .string()
        .optional()
        .describe("Friend ID (required for set_metadata, set_rich_menu, remove_rich_menu)"),
      metadata: z
        .string()
        .optional()
        .describe("JSON string of metadata fields to set (for 'set_metadata')"),
      richMenuId: z
        .string()
        .optional()
        .describe("Rich menu ID to assign (for 'set_rich_menu')"),
    },
    async ({ action, friendId, metadata, richMenuId }) => {
      try {
        const client = getClient();

        if (action === "count") {
          const count = await client.friends.count();
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, count }, null, 2) }],
          };
        }

        if (!friendId) throw new Error("friendId is required for this action");

        if (action === "set_metadata") {
          if (!metadata) throw new Error("metadata (JSON string) is required for set_metadata");
          const fields = JSON.parse(metadata) as Record<string, unknown>;
          const friend = await client.friends.setMetadata(friendId, fields);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, friend }, null, 2) }],
          };
        }

        if (action === "set_rich_menu") {
          if (!richMenuId) throw new Error("richMenuId is required for set_rich_menu");
          await client.friends.setRichMenu(friendId, richMenuId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, friendId, richMenuId }, null, 2) }],
          };
        }

        if (action === "remove_rich_menu") {
          await client.friends.removeRichMenu(friendId);
          return {
            content: [{ type: "text" as const, text: JSON.stringify({ success: true, friendId, removed: true }, null, 2) }],
          };
        }

        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return {
          content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }],
          isError: true,
        };
      }
    },
  );
}
