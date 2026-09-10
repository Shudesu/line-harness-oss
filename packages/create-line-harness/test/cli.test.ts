import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { join, resolve } from "node:path";
import { runCli } from "../src/cli.js";

const mocks = vi.hoisted(() => ({
  runSetup: vi.fn(),
  runUpdate: vi.fn(),
  ensureRepo: vi.fn(),
  existsSync: vi.fn(),
  mkdirSync: vi.fn(),
  homedir: vi.fn(),
  loaded: [] as string[],
}));

vi.mock("../src/commands/setup.js", () => {
  mocks.loaded.push("setup");
  return { runSetup: mocks.runSetup };
});
vi.mock("../src/commands/update.js", () => {
  mocks.loaded.push("update");
  return { runUpdate: mocks.runUpdate };
});
vi.mock("../src/steps/clone-repo.js", () => {
  mocks.loaded.push("clone");
  return { ensureRepo: mocks.ensureRepo };
});
vi.mock("node:fs", () => ({
  existsSync: mocks.existsSync,
  mkdirSync: mocks.mkdirSync,
}));
vi.mock("node:os", () => ({ homedir: mocks.homedir, tmpdir: () => "/tmp" }));

beforeEach(() => {
  vi.resetModules();
  vi.resetAllMocks();
  mocks.loaded.length = 0;
  mocks.ensureRepo.mockResolvedValue("/test/repo");
  mocks.homedir.mockReturnValue("/test/home");
  mocks.existsSync.mockReturnValue(false);
  vi.spyOn(console, "log").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected network access"); }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

function expectNoSetupSideEffects(): void {
  expect(mocks.loaded).toEqual([]);
  expect(mocks.runSetup).not.toHaveBeenCalled();
  expect(mocks.runUpdate).not.toHaveBeenCalled();
  expect(mocks.ensureRepo).not.toHaveBeenCalled();
  expect(mocks.existsSync).not.toHaveBeenCalled();
  expect(mocks.mkdirSync).not.toHaveBeenCalled();
  expect(mocks.homedir).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
}

describe("CLI help and invalid arguments", () => {
  it.each([
    ["--help"],
    ["-h"],
    ["setup", "--help"],
    ["update", "-h"],
    ["--help", "update", "--repair-admin", "--repo-dir", "./missing"],
    ["--repo-dir", "./missing", "--from-source", "setup", "-h"],
  ])("prints help without loading commands or touching directories: %j", async (...args) => {
    expect(await runCli(args)).toBe(0);
    expect(console.log).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(console.error).not.toHaveBeenCalled();
    expectNoSetupSideEffects();
  });

  it.each([
    ["--unknown"],
    ["-x"],
    ["--help", "--unknown"],
    ["--from-source=true"],
    ["install"],
    ["setup", "update"],
    ["setup", "setup"],
    ["setup", "unexpected"],
    ["--repo-dir"],
    ["--repo-dir", ""],
    ["--repo-dir", "   "],
    ["--repo-dir", "--from-source"],
    ["--repo-dir", "--help"],
    ["--repo-dir", "a", "--repo-dir", "b"],
    ["--from-source", "--from-source"],
    ["--repair-admin"],
    ["setup", "--repair-admin"],
    ["update", "--from-source"],
    ["update", "--repair-admin", "--repair-admin"],
  ])("rejects malformed arguments before side effects: %j", async (...args) => {
    expect(await runCli(args)).toBe(1);
    expect(console.error).toHaveBeenCalledWith(expect.stringContaining("Usage:"));
    expect(console.log).not.toHaveBeenCalled();
    expectNoSetupSideEffects();
  });

  it("does not echo a value accidentally supplied to an unknown option", async () => {
    await runCli(["--token=private-test-token"]);
    expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-test-token");
  });
});

describe("supported commands and options", () => {
  it("defaults to setup", async () => {
    expect(await runCli([])).toBe(0);
    expect(mocks.ensureRepo).toHaveBeenCalledWith(null);
    expect(mocks.runSetup).toHaveBeenCalledWith("/test/repo", { fromSource: false });
    expect(mocks.loaded).toEqual(["clone", "setup"]);
    expect(mocks.runUpdate).not.toHaveBeenCalled();
  });

  it.each([
    ["setup", "--repo-dir", "./a repo", "--from-source"],
    ["--from-source", "--repo-dir", "./a repo", "setup"],
    ["--repo-dir", "./a repo", "--from-source"],
  ])("preserves source setup and option order: %j", async (...args) => {
    expect(await runCli(args)).toBe(0);
    expect(mocks.ensureRepo).toHaveBeenCalledWith(resolve("./a repo"));
    expect(mocks.runSetup).toHaveBeenCalledWith("/test/repo", { fromSource: true });
  });

  it("runs admin repair in the explicit config directory without cloning", async () => {
    expect(await runCli(["--repo-dir", "./config", "update", "--repair-admin"])).toBe(0);
    expect(mocks.runUpdate).toHaveBeenCalledWith(resolve("./config"), { repairAdmin: true });
    expect(mocks.loaded).toEqual(["update"]);
    expect(mocks.ensureRepo).not.toHaveBeenCalled();
    expect(mocks.existsSync).not.toHaveBeenCalled();
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
  });

  it("uses an existing cwd config for update", async () => {
    mocks.existsSync.mockImplementation((path) => path === join(process.cwd(), ".line-harness-config.json"));
    expect(await runCli(["update"])).toBe(0);
    expect(mocks.runUpdate).toHaveBeenCalledWith(process.cwd(), { repairAdmin: false });
    expect(mocks.mkdirSync).not.toHaveBeenCalled();
  });

  it("creates the canonical config directory only for a valid update", async () => {
    expect(await runCli(["update"])).toBe(0);
    expect(mocks.mkdirSync).toHaveBeenCalledWith("/test/home/.line-harness", { recursive: true });
    expect(mocks.runUpdate).toHaveBeenCalledWith("/test/home/.line-harness", { repairAdmin: false });
    expect(mocks.ensureRepo).not.toHaveBeenCalled();
  });
});
