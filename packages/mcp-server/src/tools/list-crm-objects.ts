import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerListCrmObjects(server: McpServer): void {
  server.tool(
    "list_crm_objects",
    "List all CRM objects of a specific type: scenarios, forms, tags, rich menus, tracked links, or broadcasts.",
    {
      objectType: z
        .enum([
          "scenarios",
          "forms",
          "tags",
          "rich_menus",
          "tracked_links",
          "broadcasts",
        ])
        .describe("Type of CRM object to list"),
      accountId: z
        .string()
        .optional()
        .describe("LINE account ID (uses default if omitted)"),
    },
    async ({ objectType, accountId }) => {
      try {
        const client = getClient();
        let items: unknown;

        switch (objectType) {
          case "scenarios":
            items = await client.scenarios.list({ accountId });
            break;
          case "forms":
            items = await client.forms.list();
            break;
          case "tags":
            items = await client.tags.list();
            break;
          case "rich_menus":
            items = await client.richMenus.list();
            break;
          case "tracked_links":
            items = await client.trackedLinks.list();
            break;
          case "broadcasts":
            items = await client.broadcasts.list({ accountId });
            break;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, objectType, items },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: false, error: String(error) },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    },
  );
}
