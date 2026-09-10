import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync, closeSync, fchmodSync, mkdtempSync, readFileSync, rmSync,
  statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadState, saveState } from "../src/commands/setup.js";

vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    chmodSync: vi.fn(fs.chmodSync),
    fchmodSync: vi.fn(fs.fchmodSync),
    closeSync: vi.fn(fs.closeSync),
  };
});

describe("setup resume state", () => {
  let dir: string;
  let path: string;
  const state = {
    completedSteps: ["credentials"],
    lineChannelSecret: "test-channel-secret",
    lineChannelAccessToken: "test-access-token",
    apiKey: "test-api-key",
  };

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "clh-state-test-"));
    path = join(dir, ".line-harness-setup.json");
    vi.clearAllMocks();
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("round-trips credentials and completed steps", () => {
    saveState(dir, state);
    expect(loadState(dir)).toEqual(state);
  });

  it.skipIf(process.platform === "win32")("creates the secret-bearing file with owner-only permissions", () => {
    saveState(dir, state);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it.skipIf(process.platform === "win32")("repairs an existing 0644 file when saving and removes its old tail", () => {
    writeFileSync(path, JSON.stringify({ ...state, oldValue: "x".repeat(1000) }));
    chmodSync(path, 0o644);
    expect(statSync(path).mode & 0o777).toBe(0o644);
    saveState(dir, state);
    expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual(state);
  });

  it.skipIf(process.platform === "win32")("secures legacy state as soon as it is loaded for resume", () => {
    writeFileSync(path, JSON.stringify(state));
    chmodSync(path, 0o644);
    expect(loadState(dir)).toEqual(state);
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("does not truncate existing state or leak a descriptor when securing the write fails", () => {
    const previous = JSON.stringify(state);
    writeFileSync(path, previous);
    vi.mocked(fchmodSync).mockImplementationOnce(() => { throw new Error("permission denied"); });
    expect(() => saveState(dir, { completedSteps: [] })).toThrow("permission denied");
    expect(readFileSync(path, "utf8")).toBe(previous);
    expect(closeSync).toHaveBeenCalledOnce();
  });

  it("fails closed when existing state permissions cannot be repaired on load", () => {
    writeFileSync(path, JSON.stringify(state));
    vi.mocked(chmodSync).mockImplementationOnce(() => { throw new Error("permission denied"); });
    expect(() => loadState(dir)).toThrow("permission denied");
  });

  it("preserves the missing and corrupt state fallback", () => {
    expect(loadState(dir)).toEqual({ completedSteps: [] });
    writeFileSync(path, "{broken");
    expect(loadState(dir)).toEqual({ completedSteps: [] });
  });
});
