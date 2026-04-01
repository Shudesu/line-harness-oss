import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

const SCHEDULER_URL = process.env.FIXX_SCHEDULER_URL || "https://fixx-scheduler.vercel.app";

export function registerListBookings(server: McpServer): void {
  server.tool(
    "list_bookings",
    "List upcoming confirmed bookings from Fixx Scheduler. Shows guest name, phone, date/time, Google Meet URL, and assigned staff. Optionally filter by LINE user ID.",
    {
      lineUserId: z
        .string()
        .optional()
        .describe("Filter by LINE user ID (e.g. U1234...)"),
    },
    async ({ lineUserId }) => {
      try {
        const apiKey = process.env.LINE_HARNESS_API_KEY;
        if (!apiKey) throw new Error("LINE_HARNESS_API_KEY not configured");

        const url = new URL("/api/bookings/list", SCHEDULER_URL);
        if (lineUserId) url.searchParams.set("line_user_id", lineUserId);

        const res = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${apiKey}` },
          signal: AbortSignal.timeout(15_000),
        });

        if (!res.ok) {
          const text = await res.text();
          throw new Error(`Scheduler API error: ${res.status} ${text}`);
        }

        const data = await res.json() as { success: boolean; data: Array<Record<string, unknown>> };

        if (!data.data?.length) {
          return { content: [{ type: "text" as const, text: "予約なし（今後の確定済み予約はありません）" }] };
        }

        const lines = data.data.map((b: Record<string, unknown>) => {
          const start = new Date(b.start_time as string);
          const dateStr = start.toLocaleDateString("ja-JP", {
            month: "long", day: "numeric", weekday: "short", timeZone: "Asia/Tokyo",
          });
          const timeStr = start.toLocaleTimeString("ja-JP", {
            hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tokyo",
          });
          const meet = b.google_meet_url ? ` | Meet: ${b.google_meet_url}` : "";
          return `- ${dateStr} ${timeStr} | ${b.guest_name} | ${b.guest_phone} | 担当: ${b.staff_name ?? "未定"}${meet}`;
        });

        return {
          content: [{
            type: "text" as const,
            text: `面談予約一覧（${data.data.length}件）\n\n${lines.join("\n")}`,
          }],
        };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text" as const, text: `Error: ${msg}` }], isError: true };
      }
    },
  );
}
