import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerManageTrackedLinks(server: McpServer): void {
  server.tool(
    "manage_tracked_links",
    "トラッキングリンクの管理操作。list: 一覧、update: 更新、delete: 削除。作成は create_tracked_link ツールを使用。",
    {
      action: z.enum(["list", "update", "delete"]).describe("Action to perform"),
      linkId: z.string().optional().describe("Tracked link ID (required for update/delete)"),
      name: z.string().optional().describe("New link name (update only)"),
      tagId: z.string().nullable().optional().describe("Tag ID to auto-apply on click, or null to clear (update only)"),
      scenarioId: z.string().nullable().optional().describe("Scenario ID to auto-enroll on click, or null to clear (update only)"),
      introTemplateId: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Message template ID for campaign intro push, or null to clear. " +
            "Use {formUrl} as a placeholder inside the template body to substitute the LIFF form URL at send time. (update only)",
        ),
      rewardTemplateId: z
        .string()
        .nullable()
        .optional()
        .describe(
          "Message template ID to push as the reward message after form submission verification passes, or null to clear. Overrides the form's built-in on_submit_message. Use this when reusing one form across multiple campaigns with different rewards. (update only)",
        ),
      isActive: z.boolean().optional().describe("Whether the link is active (update only)"),
    },
    async ({ action, linkId, name, tagId, scenarioId, introTemplateId, rewardTemplateId, isActive }) => {
      try {
        const client = getClient();
        if (action === "list") {
          const links = await client.trackedLinks.list();
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, trackedLinks: links }, null, 2) }] };
        }
        if (action === "update") {
          if (!linkId) throw new Error("linkId is required for update");
          const link = await client.trackedLinks.update(linkId, {
            name,
            tagId,
            scenarioId,
            introTemplateId,
            rewardTemplateId,
            isActive,
          });
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, link }, null, 2) }] };
        }
        if (action === "delete") {
          if (!linkId) throw new Error("linkId is required for delete");
          await client.trackedLinks.delete(linkId);
          return { content: [{ type: "text" as const, text: JSON.stringify({ success: true, deleted: linkId }, null, 2) }] };
        }
        throw new Error(`Unknown action: ${action}`);
      } catch (err) {
        return { content: [{ type: "text" as const, text: JSON.stringify({ success: false, error: String(err) }) }], isError: true };
      }
    },
  );
}
