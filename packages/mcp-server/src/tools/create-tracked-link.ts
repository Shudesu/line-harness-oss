import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerCreateTrackedLink(server: McpServer): void {
  server.tool(
    "create_tracked_link",
    "Create a click-tracking link. When clicked, can auto-tag the user, enroll them in a scenario, or send a custom intro message via push.",
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
      introTemplateId: z
        .string()
        .optional()
        .describe(
          "Message template ID to push as the campaign intro message right after friend-add. " +
            "Use {formUrl} as a placeholder inside the template body to substitute the LIFF form URL at send time.",
        ),
      rewardTemplateId: z
        .string()
        .optional()
        .describe(
          "Message template ID to push as the reward message after form submission verification passes. Overrides the form's built-in on_submit_message. Use this when reusing one form across multiple campaigns with different rewards.",
        ),
    },
    async ({ name, originalUrl, tagId, scenarioId, introTemplateId, rewardTemplateId }) => {
      try {
        const client = getClient();
        const link = await client.trackedLinks.create({
          name,
          originalUrl,
          tagId,
          scenarioId,
          introTemplateId,
          rewardTemplateId,
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
