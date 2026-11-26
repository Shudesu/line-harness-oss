import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadState, runSetup, saveState } from "../src/commands/setup.js";
import { createDatabase } from "../src/steps/database.js";
import { fetchLatestRelease, type FetchedRelease } from "../src/steps/release-bundle.js";
import { deployWorker, syncInstalledWorkerConfig } from "../src/steps/deploy-worker.js";
import { deployAdmin } from "../src/steps/deploy-admin.js";
import { wrangler } from "../src/lib/wrangler.js";
import * as prompts from "@clack/prompts";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(), note: vi.fn(), outro: vi.fn(), confirm: vi.fn(async () => false),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn() },
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
}));
vi.mock("../src/steps/check-deps.js", () => ({ checkDeps: vi.fn() }));
vi.mock("../src/steps/auth.js", () => ({ ensureAuth: vi.fn(), getAccountId: vi.fn() }));
vi.mock("../src/steps/clone-repo.js", () => ({ pinRepoToTag: vi.fn(), installRepoDeps: vi.fn() }));
vi.mock("../src/steps/release-bundle.js", () => ({ fetchLatestRelease: vi.fn() }));
vi.mock("../src/steps/database.js", async original => ({
  ...await original<typeof import("../src/steps/database.js")>(), createDatabase: vi.fn(),
}));
vi.mock("../src/steps/deploy-worker.js", () => ({ deployWorker: vi.fn(), syncInstalledWorkerConfig: vi.fn() }));
vi.mock("../src/steps/deploy-admin.js", () => ({ deployAdmin: vi.fn() }));
vi.mock("../src/lib/wrangler.js", async original => ({
  ...await original<typeof import("../src/lib/wrangler.js")>(),
  getAccountIds: vi.fn(async () => [{ id: "account", name: "offline" }]),
  setAccountId: vi.fn(), wrangler: vi.fn(),
}));

const completed = ["r2billing", "credentials", "liffId", "database", "r2", "worker", "secrets", "lineAccount", "admin"];
const state = {
  completedSteps: completed,
  releaseVersion: "0.24.1", projectName: "offline", accountId: "account",
  d1DatabaseId: "saved-db", d1DatabaseName: "offline", r2BucketName: "saved-bucket",
  workerName: "offline", workerUrl: "https://worker.example", adminUrl: "https://admin.example",
  lineChannelId: "channel", lineChannelAccessToken: "private-channel-token", lineChannelSecret: "private-channel-secret",
  lineLoginChannelId: "login", liffId: "saved-liff", apiKey: "private-api-key", botBasicId: "@offline", lineAccountId: "saved-line-account",
};
const required = '[{"name":"ADMIN_ORIGIN"},{"name":"ADMIN_ALLOW_CROSS_SITE"}]';

describe("setup admin auth completion and retry", () => {
  let repo: string;
  let listResult: string | Error;
  beforeEach(() => {
    vi.clearAllMocks();
    repo = mkdtempSync(join(tmpdir(), "clh-admin-auth-retry-"));
    mkdirSync(join(repo, "packages/db/src"), { recursive: true });
    writeFileSync(join(repo, "packages/db/src/mileage.ts"), "export const LEGACY_MILEAGE_PROJECTION_VERSION = 1;");
    saveState(repo, structuredClone(state));
    writeFileSync(join(repo, ".line-harness-config.json"), '{"existingConfig":"retain-until-success"}\n');
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      release: { version: "0.24.1", legacy_mileage_projection_version: 1 },
      bundle: { workerJs: Buffer.from("verified-worker"), adminFiles: new Map() }, manifest: {},
    } as FetchedRelease);
    listResult = "[]";
    vi.mocked(wrangler).mockImplementation(async args => {
      if (args[0] === "secret" && args[1] === "bulk") return "";
      if (args[0] === "secret" && args[1] === "list") {
        if (listResult instanceof Error) throw listResult;
        return listResult;
      }
      throw new Error("Unexpected external mutation");
    });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network access"); }));
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it.each([false, true])("retains failed setup state and credentials, then completes a successful retry (source=%s)", async fromSource => {
    await expect(runSetup(repo, { fromSource })).rejects.toThrow("必須の認証用シークレットが未反映");
    expect(loadState(repo)).toMatchObject(state);
    expect(loadState(repo).completedSteps).not.toContain("adminAuth");
    expect(readFileSync(join(repo, ".line-harness-config.json"), "utf8")).toBe('{"existingConfig":"retain-until-success"}\n');
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
    expect(deployAdmin).not.toHaveBeenCalled();
    expect(syncInstalledWorkerConfig).not.toHaveBeenCalled();
    expect(prompts.note).not.toHaveBeenCalled();
    expect(prompts.outro).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();

    listResult = required;
    vi.mocked(syncInstalledWorkerConfig).mockImplementationOnce(async options => {
      expect(loadState(repo)).toMatchObject({ ...state, completedSteps: [...completed, "adminAuth"] });
      expect(options.workerDeployMode).toBe(fromSource ? "source" : "bundle");
      expect(options.bundleWorkerJs).toEqual(fromSource ? undefined : Buffer.from("verified-worker"));
    });
    await runSetup(repo, { fromSource });
    expect(existsSync(join(repo, ".line-harness-setup.json"))).toBe(false);
    expect(syncInstalledWorkerConfig).toHaveBeenCalledOnce();
    expect(vi.mocked(wrangler).mock.calls.filter(([args]) => args[1] === "bulk")).toHaveLength(2);
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
    expect(deployAdmin).not.toHaveBeenCalled();
    expect(JSON.parse(readFileSync(join(repo, ".line-harness-config.json"), "utf8"))).toMatchObject({
      d1DatabaseId: "saved-db", accountId: "account", workerDeployMode: fromSource ? "source" : "bundle",
    });
  });

  it.each([new Error("private-verification-token"), "private-verification-token"])
    ("does not complete or remove state after unavailable verification", async failure => {
      listResult = failure;
      let caught: unknown;
      try { await runSetup(repo); } catch (error) { caught = error; }
      expect(String(caught)).toContain("確認できませんでした");
      expect(String(caught)).not.toContain("private-verification-token");
      expect(loadState(repo)).toEqual(state);
      expect(syncInstalledWorkerConfig).not.toHaveBeenCalled();
      expect(prompts.note).not.toHaveBeenCalled();
      expect(prompts.outro).not.toHaveBeenCalled();
    });

  it("revokes an old false-completion flag and retries configuration before allowing success", async () => {
    saveState(repo, { ...state, completedSteps: [...completed, "adminAuth"] });
    await expect(runSetup(repo)).rejects.toThrow("必須の認証用シークレットが未反映");
    expect(loadState(repo).completedSteps).toEqual(completed);
    expect(vi.mocked(wrangler).mock.calls.map(([args]) => args[1])).toEqual(["list", "bulk", "list"]);
    expect(syncInstalledWorkerConfig).not.toHaveBeenCalled();
    listResult = required;
    await runSetup(repo);
    expect(existsSync(join(repo, ".line-harness-setup.json"))).toBe(false);
    expect(syncInstalledWorkerConfig).toHaveBeenCalledOnce();
  });

  it("only reads secrets when a saved completion flag still verifies successfully", async () => {
    saveState(repo, { ...state, completedSteps: [...completed, "adminAuth"] });
    listResult = required;
    await runSetup(repo);
    expect(vi.mocked(wrangler).mock.calls.map(([args]) => args[1])).toEqual(["list"]);
    expect(existsSync(join(repo, ".line-harness-setup.json"))).toBe(false);
  });
});
