import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerCreateTrackedLink(server: McpServer): void {
  server.tool(
    "create_tracked_link",
    "Create a click-tracking link. When clicked, can auto-tag the user and enroll them in a scenario.",
    {
      name: z.string().describe("Link name (internal label)"),
      originalUrl: z
        .string()
        .describe("The destination URL to redirect to"),
      tagId: z
        .string()
        .optional()
        .describe("Tag ID to auto-apply on click"),
      scenarioId: z
        .string()
        .optional()
        .describe("Scenario ID to auto-enroll on click"),
    },
    async ({ name, originalUrl, tagId, scenarioId }) => {
      try {
        const client = getClient();
        const link = await client.trackedLinks.create({
          name,
          originalUrl,
          tagId,
          scenarioId,
        });
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ success: true, link }, null, 2),
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
