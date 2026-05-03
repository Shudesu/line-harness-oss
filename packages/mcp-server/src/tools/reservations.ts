import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { getClient } from "../client.js";

function json(data: unknown) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }],
  };
}

function errorJson(error: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({ success: false, error: String(error) }, null, 2),
      },
    ],
    isError: true,
  };
}

function requireExecute(execute: boolean | undefined, action: string, payload: Record<string, unknown>) {
  if (execute) return null;
  return json({
    success: false,
    dryRun: true,
    action,
    payload,
    note: "This reservation operation changes state. Re-run with execute=true to perform it.",
  });
}

function parseJsonObject(value: string | undefined, fieldName: string): Record<string, unknown> | undefined {
  if (!value) return undefined;
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`${fieldName} must be a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

export function registerReservations(server: McpServer): void {
  server.tool(
    "reservation_resources_list",
    "List reservation resources. Read-only.",
    {},
    async () => {
      try {
        const resources = await getClient().reservations.listResources();
        return json({ success: true, resources });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_menus_list",
    "List reservation menus for a resource. Read-only.",
    {
      resourceId: z.string().describe("Reservation resource ID"),
    },
    async ({ resourceId }) => {
      try {
        const menus = await getClient().reservations.listMenus(resourceId);
        return json({ success: true, menus });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_slots_list",
    "List reservation slots and availability. Read-only.",
    {
      resourceId: z.string().describe("Reservation resource ID"),
      date: z.string().describe("Date in YYYY-MM-DD"),
      people: z.number().int().positive().optional().describe("Requested people count"),
    },
    async ({ resourceId, date, people }) => {
      try {
        const slots = await getClient().reservations.listSlots({ resourceId, date, people });
        return json({ success: true, slots });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservations_list",
    "List reservations by optional filters. Read-only.",
    {
      date: z.string().optional().describe("Reservation date in YYYY-MM-DD"),
      slotId: z.string().optional().describe("Slot ID"),
      userId: z.string().optional().describe("Internal user ID"),
      status: z.enum(["pending", "confirmed", "cancelled", "completed", "no_show"]).optional(),
      source: z.enum(["line", "jalan", "phone", "gmail", "admin", "mcp"]).optional(),
    },
    async (params) => {
      try {
        const reservations = await getClient().reservations.list(params);
        return json({ success: true, reservations });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_get",
    "Get one reservation by ID. Read-only.",
    {
      reservationId: z.string().describe("Reservation ID"),
    },
    async ({ reservationId }) => {
      try {
        const reservation = await getClient().reservations.get(reservationId);
        return json({ success: true, reservation });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_slots_generate",
    "Generate slots from schedules. Write operation. Safe by default: requires execute=true.",
    {
      resourceId: z.string().describe("Reservation resource ID"),
      dateFrom: z.string().describe("Start date in YYYY-MM-DD"),
      dateTo: z.string().describe("End date in YYYY-MM-DD"),
      execute: z.boolean().default(false).describe("Set true to actually generate slots"),
    },
    async ({ resourceId, dateFrom, dateTo, execute }) => {
      try {
        const plan = { resourceId, dateFrom, dateTo };
        const dryRun = requireExecute(execute, "reservation_slots_generate", plan);
        if (dryRun) return dryRun;
        const slots = await getClient().reservations.generateSlots(plan);
        return json({ success: true, generatedCount: slots.length, slots });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_create",
    "Create a reservation through Worker API. Write operation. Safe by default: requires execute=true. Capacity is still secured by the Worker conditional slot UPDATE.",
    {
      resourceId: z.string(),
      menuId: z.string(),
      slotId: z.string(),
      source: z.enum(["line", "jalan", "phone", "gmail", "admin", "mcp"]).default("mcp"),
      capacityChannel: z.enum(["line", "external", "manual"]).default("line"),
      lineAccountId: z.string().nullable().optional(),
      userId: z.string().nullable().optional(),
      friendId: z.string().nullable().optional(),
      adultCount: z.number().int().min(0).default(1),
      childCount: z.number().int().min(0).default(0),
      customerName: z.string().nullable().optional(),
      customerPhone: z.string().nullable().optional(),
      customerEmail: z.string().nullable().optional(),
      formDataJson: z.string().optional().describe("Optional JSON object string"),
      metadataJson: z.string().optional().describe("Optional JSON object string"),
      execute: z.boolean().default(false).describe("Set true to actually create the reservation"),
    },
    async (input) => {
      try {
        const formData = parseJsonObject(input.formDataJson, "formDataJson");
        const metadata = parseJsonObject(input.metadataJson, "metadataJson");
        const payload = {
          resourceId: input.resourceId,
          menuId: input.menuId,
          slotId: input.slotId,
          source: input.source,
          capacityChannel: input.capacityChannel,
          lineAccountId: input.lineAccountId,
          userId: input.userId,
          friendId: input.friendId,
          adultCount: input.adultCount,
          childCount: input.childCount,
          customer: {
            name: input.customerName,
            phone: input.customerPhone,
            email: input.customerEmail,
          },
          formData,
          metadata,
        };
        const dryRun = requireExecute(input.execute, "reservation_create", payload);
        if (dryRun) return dryRun;
        const reservation = await getClient().reservations.create(payload);
        return json({ success: true, reservation });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_cancel",
    "Cancel a reservation through Worker API. Write operation. Safe by default: requires execute=true. Inventory release follows the Worker state transition table.",
    {
      reservationId: z.string(),
      reason: z.string().default("mcp_requested"),
      execute: z.boolean().default(false).describe("Set true to actually cancel the reservation"),
    },
    async ({ reservationId, reason, execute }) => {
      try {
        const payload = { reservationId, status: "cancelled", reason };
        const dryRun = requireExecute(execute, "reservation_cancel", payload);
        if (dryRun) return dryRun;
        const result = await getClient().reservations.updateStatus(reservationId, {
          status: "cancelled",
          reason,
        });
        return json({ success: true, ...result });
      } catch (error) {
        return errorJson(error);
      }
    },
  );

  server.tool(
    "reservation_external_import_jalan",
    "Import Jalan/Gmail parsed reservation event through Worker API. Write operation. Safe by default: requires execute=true. updated events become needs_review; cancelled events use Worker state transitions.",
    {
      eventType: z.enum(["created", "updated", "cancelled", "unknown"]),
      externalId: z.string().nullable().optional(),
      dedupeKey: z.string().nullable().optional(),
      gmailMessageId: z.string().nullable().optional(),
      receivedAt: z.string().nullable().optional(),
      rawText: z.string().nullable().optional(),
      parsedPayload: z.string().optional(),
      resourceId: z.string().optional(),
      menuId: z.string().optional(),
      slotId: z.string().optional(),
      adultCount: z.number().int().min(0).optional(),
      childCount: z.number().int().min(0).optional(),
      customerName: z.string().nullable().optional(),
      customerPhone: z.string().nullable().optional(),
      customerEmail: z.string().nullable().optional(),
      execute: z.boolean().default(false).describe("Set true to actually import the event"),
    },
    async (input) => {
      try {
        const payload = {
          eventType: input.eventType,
          externalId: input.externalId,
          dedupeKey: input.dedupeKey,
          gmailMessageId: input.gmailMessageId,
          receivedAt: input.receivedAt,
          rawText: input.rawText,
          parsedPayload: input.parsedPayload,
          resourceId: input.resourceId,
          menuId: input.menuId,
          slotId: input.slotId,
          adultCount: input.adultCount,
          childCount: input.childCount,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
        };
        const dryRun = requireExecute(input.execute, "reservation_external_import_jalan", payload);
        if (dryRun) return dryRun;
        const result = await getClient().reservations.importJalan(payload);
        return json({ success: true, result });
      } catch (error) {
        return errorJson(error);
      }
    },
  );
}
