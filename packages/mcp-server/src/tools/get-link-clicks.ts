import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerGetLinkClicks(server: McpServer): void {
  server.tool(
    "get_link_clicks",
    "Get click analytics for a tracked link including total clicks and per-friend click history.",
    {
      linkId: z.string().describe("The tracked link ID"),
    },
    async ({ linkId }) => {
      try {
        const client = getClient();
        const link = await client.trackedLinks.get(linkId);
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
