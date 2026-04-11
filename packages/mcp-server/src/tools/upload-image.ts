import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

export function registerUploadImage(server: McpServer): void {
  server.tool(
    "upload_image",
    "Upload an image to get a public URL for use in LINE messages (Flex Message hero images, image messages, etc.). Accepts base64-encoded image data. Returns public URL.",
    {
      data: z.string().describe("Base64-encoded image data (with or without data:image/...;base64, prefix)"),
      mimeType: z
        .enum(["image/png", "image/jpeg", "image/gif", "image/webp"])
        .default("image/png")
        .describe("Image MIME type"),
      filename: z.string().optional().describe("Optional original filename for reference"),
    },
    async ({ data, mimeType, filename }) => {
      try {
        const client = getClient();
        const result = await client.images.upload({ data, mimeType, filename });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  success: true,
                  url: result.url,
                  key: result.key,
                  mimeType: result.mimeType,
                  size: result.size,
                },
                null,
                2,
              ),
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
        };
      }
    },
  );
}
