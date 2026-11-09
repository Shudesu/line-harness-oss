import { describe, expect, it, vi } from "vitest";
import { issueShortLivedChannelToken } from "../src/lib/line-token.js";

describe("issueShortLivedChannelToken", () => {
  it("posts client_credentials with the channel id and secret", async () => {
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ access_token: "issued-token", expires_in: 2592000 }), { status: 200 }),
    );
    expect(await issueShortLivedChannelToken("1234", "secret-value", fetchImpl as unknown as typeof fetch)).toBe(
      "issued-token",
    );
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.line.me/v2/oauth/accessToken");
    const body = new URLSearchParams(String(init.body));
    expect(body.get("grant_type")).toBe("client_credentials");
    expect(body.get("client_id")).toBe("1234");
    expect(body.get("client_secret")).toBe("secret-value");
  });

  it("does not echo the secret or LINE's body when issuance fails", async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"invalid_client"}', { status: 400 }));
    const err = await issueShortLivedChannelToken("1234", "secret-value", fetchImpl as unknown as typeof fetch).catch(
      (e: Error) => e,
    );
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toContain("HTTP 400");
    expect((err as Error).message).not.toContain("secret-value");
  });
});
