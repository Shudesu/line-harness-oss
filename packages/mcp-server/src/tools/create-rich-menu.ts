import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerCreateRichMenu(server: McpServer): void {
  server.tool(
    "create_rich_menu",
    "Create a LINE rich menu with optional image upload. Provide imageData (base64) to attach the menu image in one step.",
    {
      name: z.string().describe("Rich menu name"),
      chatBarText: z
        .string()
        .default("\u30E1\u30CB\u30E5\u30FC")
        .describe("Text shown on the chat bar button"),
      size: z
        .object({
          width: z
            .number()
            .default(2500)
            .describe("Menu width in pixels (2500 for full-width)"),
          height: z
            .number()
            .default(1686)
            .describe("Menu height: 1686 for full, 843 for half"),
        })
        .default({ width: 2500, height: 1686 })
        .describe("Menu size in pixels"),
      selected: z
        .boolean()
        .default(false)
        .describe("Whether the rich menu is displayed by default"),
      areas: z
        .string()
        .describe(
          "JSON string of menu button areas. Format: [{ bounds: { x, y, width, height }, action: { type: 'uri'|'message'|'postback', uri?, text?, data? } }]",
        ),
      imageData: z
        .string()
        .optional()
        .describe("Base64-encoded image data for the rich menu (PNG or JPEG, 2500x1686 or 2500x843)"),
      imageContentType: z
        .enum(["image/png", "image/jpeg"])
        .default("image/jpeg")
        .describe("Image MIME type"),
      setAsDefault: z
        .boolean()
        .default(false)
        .describe("Set this as the default rich menu for all friends"),
    },
    async ({ name, chatBarText, size, selected, areas, imageData, imageContentType, setAsDefault }) => {
      try {
        const client = getClient();
        const menu = await client.richMenus.create({
          name,
          chatBarText,
          size,
          selected,
          areas: JSON.parse(areas),
        });

        if (imageData) {
          await client.richMenus.uploadImage(menu.richMenuId, imageData, imageContentType);
        }

        if (setAsDefault) {
          await client.richMenus.setDefault(menu.richMenuId);
        }

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  richMenuId: menu.richMenuId,
                  imageUploaded: !!imageData,
                  isDefault: setAsDefault,
                },
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
