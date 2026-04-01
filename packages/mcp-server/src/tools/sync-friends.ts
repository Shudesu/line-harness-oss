import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerSyncFriends(server: McpServer): void {
  server.tool(
    "sync_friends",
    "LINE Messaging APIからフォロワーを一括取得してDBに登録する。tagNamesで指定したタグは存在しなければ自動作成される。dryRun=trueで件数のみ確認。",
    {
      lineAccountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
      tagNames: z
        .string()
        .optional()
        .describe("Comma-separated tag names to apply to all imported friends (auto-created if missing). e.g. '登録済み,整備士面談'"),
      dryRun: z
        .boolean()
        .optional()
        .default(false)
        .describe("If true, only returns follower count without importing"),
    },
    async ({ lineAccountId, tagNames, dryRun }) => {
      try {
        const client = getClient();
        const tags = tagNames ? tagNames.split(",").map((t) => t.trim()).filter(Boolean) : [];

        const result = await client.friends.sync({
          lineAccountId,
          tagNames: tags,
          dryRun: dryRun ?? false,
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, ...result }, null, 2),
            },
          ],
        };
      } catch (err) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: false, error: String(err) }),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
