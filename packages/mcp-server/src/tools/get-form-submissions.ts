import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerGetFormSubmissions(server: McpServer): void {
  server.tool(
    "get_form_submissions",
    "Get all submissions for a specific form. Returns response data with timestamps and friend IDs.",
    {
      formId: z.string().describe("The form ID to get submissions for"),
    },
    async ({ formId }) => {
      try {
        const client = getClient();
        const submissions = await client.forms.getSubmissions(formId);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                { success: true, submissions },
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
