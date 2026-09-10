import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as p from "@clack/prompts";
import { promptLineCredentials } from "../src/steps/prompt.js";

vi.mock("@clack/prompts", () => ({
  text: vi.fn(),
  password: vi.fn(),
  isCancel: (value: unknown) => typeof value === "symbol",
  cancel: vi.fn(),
  log: { step: vi.fn(), message: vi.fn() },
}));

beforeEach(() => { vi.resetAllMocks(); });
afterEach(() => { vi.restoreAllMocks(); });

describe("LINE credential prompts", () => {
  it("uses masked prompts for both secrets, keeps IDs visible, and trims values", async () => {
    vi.mocked(p.text).mockResolvedValueOnce(" 12345 ").mockResolvedValueOnce(" 67890 ");
    vi.mocked(p.password).mockResolvedValueOnce(" test-secret-value ").mockResolvedValueOnce(" test-access-token ");

    expect(await promptLineCredentials()).toEqual({
      lineChannelId: "12345",
      lineLoginChannelId: "67890",
      lineChannelSecret: "test-secret-value",
      lineChannelAccessToken: "test-access-token",
    });
    expect(p.text).toHaveBeenCalledTimes(2);
    expect(p.password).toHaveBeenCalledTimes(2);
    expect(vi.mocked(p.password).mock.calls.map(([options]) => options.message)).toEqual([
      "チャネルシークレット（英数字）", "チャネルアクセストークン（長期）",
    ]);
    const rendered = JSON.stringify([
      vi.mocked(p.log.step).mock.calls, vi.mocked(p.log.message).mock.calls,
      vi.mocked(p.text).mock.calls, vi.mocked(p.password).mock.calls,
    ]);
    expect(rendered).not.toContain("test-secret-value");
    expect(rendered).not.toContain("test-access-token");

    for (const [options] of vi.mocked(p.password).mock.calls) {
      expect(options.validate?.("")).toBeTruthy();
      expect(options.validate?.(" short ")).toBeTruthy();
      expect(options.validate?.(" test-long-enough ")).toBeUndefined();
    }
  });

  it.each([0, 1])("preserves cancellation at secret prompt %i", async (index) => {
    vi.mocked(p.text).mockResolvedValue("12345");
    if (index === 1) vi.mocked(p.password).mockResolvedValueOnce("test-secret-value");
    vi.mocked(p.password).mockResolvedValueOnce(Symbol("cancel"));
    vi.spyOn(process, "exit").mockImplementation(() => { throw new Error("exited"); });

    await expect(promptLineCredentials()).rejects.toThrow("exited");
    expect(process.exit).toHaveBeenCalledWith(0);
    expect(p.cancel).toHaveBeenCalledOnce();
    expect(p.text).toHaveBeenCalledOnce();
    expect(p.password).toHaveBeenCalledTimes(index + 1);
  });
});
