import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { configureAdminAuth, findMissingRequiredSecrets } from "../src/steps/admin-auth.js";
import { wrangler } from "../src/lib/wrangler.js";

const spinner = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));
vi.mock("@clack/prompts", () => ({ spinner: () => spinner, log: { warn: vi.fn() } }));
vi.mock("../src/lib/wrangler.js", () => ({ wrangler: vi.fn() }));

const listed = JSON.stringify([{ name: "ADMIN_ORIGIN" }, { name: "ADMIN_ALLOW_CROSS_SITE" }]);
const options = { workerName: "offline", workerUrl: "https://private-worker.invalid", adminUrl: "https://private-admin.invalid" };

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(wrangler).mockReset();
  for (const name of ["log", "warn", "error", "info"] as const) vi.spyOn(console, name).mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

describe("required admin auth verification", () => {
  it("accepts required names, extra names and a leading CLI banner", () => {
    expect(findMissingRequiredSecrets(`Wrangler banner\n${listed}`)).toEqual([]);
    expect(findMissingRequiredSecrets('[{"name":"OTHER"},{"name":"ADMIN_ORIGIN"}]')).toEqual(["ADMIN_ALLOW_CROSS_SITE"]);
    expect(findMissingRequiredSecrets("[]")).toEqual(["ADMIN_ORIGIN", "ADMIN_ALLOW_CROSS_SITE"]);
  });

  it.each(["", "private-token", "{}", "[", "[null]", "[{}]", '[{"name":42}]', '[{"name":""}]'])
    ("rejects unavailable or malformed verification instead of assuming success: %s", raw => {
      expect(() => findMissingRequiredSecrets(raw)).toThrow("確認できませんでした");
      try { findMissingRequiredSecrets(raw); } catch (error) {
        expect(String(error)).not.toContain("private-token");
      }
    });

  it("reports completion only after a successful deployed-secret list", async () => {
    vi.mocked(wrangler).mockResolvedValueOnce("").mockResolvedValueOnce(listed);
    await expect(configureAdminAuth(options)).resolves.toBeUndefined();
    expect(wrangler).toHaveBeenNthCalledWith(1, ["secret", "bulk", "--name", "offline"], {
      input: JSON.stringify({ ADMIN_ORIGIN: options.adminUrl, ADMIN_ALLOW_CROSS_SITE: "true", WORKER_URL: options.workerUrl }),
    });
    expect(wrangler).toHaveBeenNthCalledWith(2, ["secret", "list", "--name", "offline", "--format", "json"]);
    expect(spinner.stop).toHaveBeenCalledWith("管理画面の認証設定完了");
  });

  it("throws when a successful bulk command did not install a required secret", async () => {
    vi.mocked(wrangler).mockResolvedValueOnce("").mockResolvedValueOnce('[{"name":"ADMIN_ORIGIN"}]');
    await expect(configureAdminAuth(options)).rejects.toThrow("ADMIN_ALLOW_CROSS_SITE");
    expect(spinner.stop).toHaveBeenCalledWith("管理画面の認証設定は未完了です");
    expect(spinner.stop).not.toHaveBeenCalledWith("管理画面の認証設定完了");
  });

  it.each(["read failure", "bad output"])("keeps %s unverified and does not expose secret values", async failure => {
    const sensitive = "private-api-token private-channel-secret";
    vi.mocked(wrangler).mockResolvedValueOnce("");
    if (failure === "read failure") vi.mocked(wrangler).mockRejectedValueOnce(new Error(sensitive));
    else vi.mocked(wrangler).mockResolvedValueOnce(sensitive);
    let caught: unknown;
    try { await configureAdminAuth(options); } catch (error) { caught = error; }
    expect(caught).toBeInstanceOf(Error);
    expect(String(caught)).toContain("同じオプション");
    expect(String(caught)).not.toMatch(/private-api-token|private-channel-secret|private-admin|private-worker/);
    expect((caught as Error).cause).toBeUndefined();
    expect(spinner.stop).not.toHaveBeenCalledWith("管理画面の認証設定完了");
    expect(JSON.stringify([spinner.start.mock.calls, spinner.stop.mock.calls])).not.toContain("private-");
    for (const name of ["log", "warn", "error", "info"] as const) expect(console[name]).not.toHaveBeenCalled();
  });

  it("keeps the versions fallback and verifies after deployment", async () => {
    vi.mocked(wrangler).mockRejectedValueOnce(new Error("bulk unsupported"))
      .mockResolvedValueOnce("").mockResolvedValueOnce("").mockResolvedValueOnce("")
      .mockResolvedValueOnce("").mockResolvedValueOnce(listed);
    await configureAdminAuth(options);
    expect(wrangler).toHaveBeenNthCalledWith(5, ["versions", "deploy", "--name", "offline", "--yes"]);
    expect(wrangler).toHaveBeenNthCalledWith(6, ["secret", "list", "--name", "offline", "--format", "json"]);
    expect(spinner.stop).toHaveBeenCalledWith("管理画面の認証設定完了");
  });

  it("sanitizes fallback write failures and leaves completion unset", async () => {
    vi.mocked(wrangler).mockRejectedValueOnce(new Error("private-bulk-secret"))
      .mockRejectedValueOnce(new Error("private-put-secret"));
    let caught: unknown;
    try { await configureAdminAuth(options); } catch (error) { caught = error; }
    expect(String(caught)).toContain("認証設定に失敗");
    expect(String(caught)).not.toContain("private-");
    expect((caught as Error).cause).toBeUndefined();
    expect(spinner.stop).not.toHaveBeenCalledWith("管理画面の認証設定完了");
    expect(wrangler).toHaveBeenCalledTimes(2);
  });
});
