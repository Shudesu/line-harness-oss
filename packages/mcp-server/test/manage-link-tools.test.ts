import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { afterEach, expect, it, vi } from "vitest";
import { registerManageEntryRoutes } from "../src/tools/manage-entry-routes.js";
import { registerManageTrackedLinks } from "../src/tools/manage-tracked-links.js";

// The root test suite runs before workspace packages are built.
vi.mock("../src/client.js", async () => {
  const { LineHarness } = await import("../../sdk/src/index.js");
  const { getApiConfig } = await import("../src/config.js");
  return { getClient: () => new LineHarness(getApiConfig()) };
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

it("guides callers from an empty tracked-link list to the entry-route tool", async () => {
  vi.stubEnv("LINE_HARNESS_API_URL", "https://worker.invalid");
  vi.stubEnv("LINE_HARNESS_API_KEY", "test-key");
  const route = { id: "route-1", refCode: "sample", name: "Sample route" };
  const link = { id: "link-1", name: "Sample link" };
  const trackedLinks: Array<typeof link> = [];
  const fetchMock = vi.fn(async (url: string) => {
    const path = new URL(url).pathname;
    if (path === "/api/tracked-links") {
      return Response.json({ success: true, data: trackedLinks });
    }
    if (path === "/api/entry-routes") {
      return Response.json({ success: true, data: [route] });
    }
    return Response.json({ success: false }, { status: 404 });
  });
  vi.stubGlobal("fetch", fetchMock);

  const server = new McpServer({ name: "link-tools", version: "1.0.0" });
  registerManageTrackedLinks(server);
  registerManageEntryRoutes(server);
  const client = new Client({ name: "test-client", version: "1.0.0" });
  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();

  try {
    await server.connect(serverTransport);
    await client.connect(clientTransport);
    const list = async (name: string) => {
      const result = await client.callTool({ name, arguments: { action: "list" } });
      expect(result.isError).toBeUndefined();
      expect(result.content).toEqual([{ type: "text", text: expect.any(String) }]);
      return JSON.parse((result.content as [{ text: string }])[0].text);
    };

    expect(await list("manage_tracked_links")).toEqual({
      success: true,
      trackedLinks: [],
      _hint: expect.stringContaining("manage_entry_routes"),
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    expect(await list("manage_entry_routes")).toEqual({ success: true, data: [route] });

    trackedLinks.push(link);
    expect(await list("manage_tracked_links")).toEqual({ success: true, trackedLinks: [link] });
  } finally {
    await client.close();
    await server.close();
  }
});
