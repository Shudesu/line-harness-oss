vi.mock('../src/steps/admin-auth.js', () => ({ assertAdminAuthConfigured: vi.fn(), configureAdminAuth: vi.fn() }));
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as prompts from "@clack/prompts";
import { loadState, runSetup, saveState } from "../src/commands/setup.js";
import { checkDeps } from "../src/steps/check-deps.js";
import { ensureAuth } from "../src/steps/auth.js";
import { pinRepoToTag } from "../src/steps/clone-repo.js";
import { createDatabase } from "../src/steps/database.js";
import { deployWorker, syncInstalledWorkerConfig } from "../src/steps/deploy-worker.js";
import { deployAdmin } from "../src/steps/deploy-admin.js";
import { setSecrets } from "../src/steps/secrets.js";
import { fetchLatestRelease, type FetchedRelease } from "../src/steps/release-bundle.js";
import { wrangler } from "../src/lib/wrangler.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn() },
  confirm: vi.fn(),
}));
vi.mock("../src/steps/check-deps.js", () => ({ checkDeps: vi.fn() }));
vi.mock("../src/steps/auth.js", () => ({ ensureAuth: vi.fn(), getAccountId: vi.fn() }));
vi.mock("../src/steps/clone-repo.js", () => ({ pinRepoToTag: vi.fn(), installRepoDeps: vi.fn() }));
vi.mock("../src/steps/release-bundle.js", () => ({ fetchLatestRelease: vi.fn() }));
vi.mock("../src/steps/ensure-subdomain.js", () => ({ ensureWorkersDevSubdomain: vi.fn() }));
vi.mock("../src/steps/deploy-worker.js", () => ({ deployWorker: vi.fn(), syncInstalledWorkerConfig: vi.fn() }));
vi.mock("../src/steps/deploy-admin.js", () => ({ deployAdmin: vi.fn() }));
vi.mock("../src/steps/secrets.js", () => ({ setSecrets: vi.fn() }));
vi.mock("../src/steps/database.js", async (original) => ({
  ...await original<typeof import("../src/steps/database.js")>(), createDatabase: vi.fn(),
}));
vi.mock("../src/lib/wrangler.js", async (original) => ({
  ...await original<typeof import("../src/lib/wrangler.js")>(),
  getAccountIds: vi.fn(async () => [{ id: "account", name: "offline" }]),
  setAccountId: vi.fn(), wrangler: vi.fn(),
}));

const OLD_STATE = {
  releaseVersion: "0.24.0",
  completedSteps: ["r2billing", "credentials", "liffId", "database", "r2", "worker", "secrets", "lineAccount", "admin", "adminAuth", "workerConfig"],
  projectName: "offline", accountId: "account",
  d1DatabaseId: "existing-db", d1DatabaseName: "offline", r2BucketName: "offline-images",
  workerName: "offline", workerUrl: "https://offline.example", adminUrl: "https://admin.example",
  lineChannelId: "channel", lineChannelAccessToken: "saved-token", lineChannelSecret: "saved-secret",
  lineLoginChannelId: "login", liffId: "saved-liff", apiKey: "saved-api-key",
  lineAccountId: "saved-line-account", botBasicId: "@offline",
};

function release(version: string, capable = true): FetchedRelease {
  return {
    release: { version, ...(capable ? { legacy_mileage_projection_version: 1 } : {}) },
    bundle: { workerJs: Buffer.from(`verified-worker-${version}`), adminFiles: new Map() },
    manifest: {},
  } as FetchedRelease;
}

describe("explicit setup release recovery", () => {
  let repo: string;
  let priorState: string;
  beforeEach(() => {
    vi.clearAllMocks();
    repo = mkdtempSync(join(tmpdir(), "clh-setup-release-"));
    mkdirSync(join(repo, "packages/db/src"), { recursive: true });
    saveState(repo, structuredClone(OLD_STATE));
    priorState = readFileSync(join(repo, ".line-harness-setup.json"), "utf8");
    vi.mocked(fetchLatestRelease).mockResolvedValue(release("0.24.1"));
    vi.mocked(pinRepoToTag).mockResolvedValue(undefined);
    vi.mocked(ensureAuth).mockResolvedValue(undefined);
    vi.mocked(createDatabase).mockResolvedValue({ databaseId: "existing-db", databaseName: "offline" });
    vi.mocked(deployWorker).mockRejectedValue(new Error("stop-before-worker-deploy"));
    vi.mocked(deployAdmin).mockRejectedValue(new Error("stop-before-admin-deploy"));
    vi.mocked(prompts.confirm).mockRejectedValue(new Error("stop-after-completed-steps"));
    vi.mocked(wrangler).mockRejectedValue(new Error("Unexpected remote command"));
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it("switches an incomplete 0.24.0 DB setup to the verified compatible release and persists its new retry target", async () => {
    saveState(repo, { ...structuredClone(OLD_STATE), completedSteps: ["r2billing", "credentials", "liffId", "r2"] });
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("stop-before-worker-deploy");
    expect(fetchLatestRelease).toHaveBeenCalledWith(expect.any(String), "0.24.1");
    expect(pinRepoToTag).toHaveBeenCalledWith(repo, "0.24.1");
    expect(createDatabase).toHaveBeenCalledWith(repo, "offline", { accountId: "account", legacyMileageProjectionVersion: 1 });
    expect(deployWorker).toHaveBeenCalledWith(expect.objectContaining({
      d1DatabaseId: "existing-db", d1DatabaseName: "offline",
      bundleWorkerJs: Buffer.from("verified-worker-0.24.1"), liffId: "saved-liff",
    }));
    expect(loadState(repo)).toMatchObject({
      releaseVersion: "0.24.1", d1DatabaseId: "existing-db", lineChannelSecret: "saved-secret", apiKey: "saved-api-key",
    });

    vi.mocked(fetchLatestRelease).mockClear();
    vi.mocked(createDatabase).mockClear();
    await expect(runSetup(repo)).rejects.toThrow("stop-before-worker-deploy");
    expect(fetchLatestRelease).toHaveBeenCalledWith(expect.any(String), "0.24.1");
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it("invalidates only release-dependent completion flags while retaining resources, credentials and LINE registration", async () => {
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("stop-before-worker-deploy");
    expect(loadState(repo)).toEqual({
      ...OLD_STATE, releaseVersion: "0.24.1",
      completedSteps: ["r2billing", "credentials", "liffId", "r2", "secrets", "lineAccount", "database"],
    });
    expect(setSecrets).not.toHaveBeenCalled();
    expect(wrangler).not.toHaveBeenCalled();
    expect(deployAdmin).not.toHaveBeenCalled();
    expect(syncInstalledWorkerConfig).not.toHaveBeenCalled();
  });

  it("redeploys the new matching admin after replacing the Worker without re-entering saved secrets or account registration", async () => {
    vi.mocked(deployWorker).mockResolvedValueOnce({ workerUrl: OLD_STATE.workerUrl });
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("stop-before-admin-deploy");
    expect(deployAdmin).toHaveBeenCalledWith(expect.objectContaining({
      workerUrl: OLD_STATE.workerUrl, apiKey: OLD_STATE.apiKey, adminFiles: expect.any(Map),
    }));
    expect(loadState(repo).completedSteps).toContain("worker");
    expect(loadState(repo).completedSteps).not.toContain("adminAuth");
    expect(loadState(repo).completedSteps).not.toContain("workerConfig");
    expect(setSecrets).not.toHaveBeenCalled();
    expect(wrangler).not.toHaveBeenCalled();
  });

  it.each(["missing official release", "bundle hash verification failed"])("preserves every saved field when verification fails: %s", async (message) => {
    vi.mocked(fetchLatestRelease).mockRejectedValueOnce(new Error(message));
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow(message);
    expect(readFileSync(join(repo, ".line-harness-setup.json"), "utf8")).toBe(priorState);
    expect(pinRepoToTag).not.toHaveBeenCalled();
    expect(ensureAuth).not.toHaveBeenCalled();
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
  });

  it("preserves the old pin and completion flags if the verified release cannot be checked out", async () => {
    vi.mocked(pinRepoToTag).mockRejectedValueOnce(new Error("tag checkout failed"));
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("tag checkout failed");
    expect(readFileSync(join(repo, ".line-harness-setup.json"), "utf8")).toBe(priorState);
    expect(createDatabase).not.toHaveBeenCalled();
  });

  it.each([true, false])("keeps a same-version pin and all valid completion flags (explicit=%s)", async (explicit) => {
    vi.mocked(fetchLatestRelease).mockResolvedValueOnce(release("0.24.0", false));
    vi.mocked(wrangler).mockResolvedValueOnce(JSON.stringify([{ success: true, results: [{ claims_table: 0, queue_table: 1 }] }]));
    await expect(runSetup(repo, explicit ? { releaseVersion: "0.24.0" } : {})).rejects.toThrow("stop-after-completed-steps");
    expect(fetchLatestRelease).toHaveBeenCalledWith(expect.any(String), "0.24.0");
    expect(loadState(repo)).toEqual(OLD_STATE);
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
    expect(deployAdmin).not.toHaveBeenCalled();
    expect(syncInstalledWorkerConfig).not.toHaveBeenCalled();
  });

  it("cannot deploy an explicit target lacking mileage capability when held claims remain", async () => {
    vi.mocked(fetchLatestRelease).mockResolvedValueOnce(release("0.24.1", false));
    vi.mocked(wrangler)
      .mockResolvedValueOnce(JSON.stringify([{ success: true, results: [{ claims_table: 1, queue_table: 1 }] }]))
      .mockResolvedValueOnce(JSON.stringify([{ success: true, results: [{ unresolved: 1 }] }]));
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("awaiting a compatible Worker");
    expect(createDatabase).toHaveBeenCalledWith(repo, "offline", { accountId: "account", legacyMileageProjectionVersion: undefined });
    expect(deployWorker).not.toHaveBeenCalled();
    expect(vi.mocked(wrangler).mock.calls.every(([args]) => args.includes("--command") && args.at(-1)?.startsWith("SELECT"))).toBe(true);
    expect(loadState(repo)).toMatchObject({ d1DatabaseId: "existing-db", lineChannelSecret: "saved-secret" });
  });

  it("allows an explicit release on a fresh setup", async () => {
    saveState(repo, { completedSteps: [] });
    vi.mocked(ensureAuth).mockRejectedValueOnce(new Error("stop-before-auth"));
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("stop-before-auth");
    expect(fetchLatestRelease).toHaveBeenCalledWith(expect.any(String), "0.24.1");
    expect(loadState(repo)).toEqual({ completedSteps: [], releaseVersion: "0.24.1" });
  });

  it("refuses a downgrade before release fetch or resource changes", async () => {
    await expect(runSetup(repo, { releaseVersion: "0.23.0" })).rejects.toThrow("cannot downgrade");
    expect(readFileSync(join(repo, ".line-harness-setup.json"), "utf8")).toBe(priorState);
    expect(checkDeps).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(wrangler).not.toHaveBeenCalled();
  });

  it("does not guess a safe release for a saved source setup whose baseline is unknown", async () => {
    const { releaseVersion: _pin, ...sourceState } = structuredClone(OLD_STATE);
    saveState(repo, sourceState);
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("without a verified release baseline");
    expect(loadState(repo)).toEqual(sourceState);
    expect(checkDeps).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(createDatabase).not.toHaveBeenCalled();
    expect(wrangler).not.toHaveBeenCalled();
  });

  it("records source work even with a retained old bundle pin, then refuses to treat that pin as its baseline", async () => {
    writeFileSync(join(repo, "packages/db/src/mileage.ts"), "export const LEGACY_MILEAGE_PROJECTION_VERSION = 1;");
    await expect(runSetup(repo, { fromSource: true })).rejects.toThrow("stop-after-completed-steps");
    expect(loadState(repo)).toEqual({ ...OLD_STATE, sourceSetup: true });
    vi.mocked(checkDeps).mockClear();
    await expect(runSetup(repo, { releaseVersion: "0.24.1" })).rejects.toThrow("without a verified release baseline");
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(checkDeps).not.toHaveBeenCalled();
    expect(loadState(repo)).toEqual({ ...OLD_STATE, sourceSetup: true });
  });

  it("refuses an ordinary retry after recorded source work before fetching or changing saved state/config", async () => {
    mkdirSync(join(repo, "apps/worker"), { recursive: true });
    const configPath = join(repo, "apps/worker/wrangler.toml");
    writeFileSync(configPath, "current source config");
    saveState(repo, { ...structuredClone(OLD_STATE), sourceSetup: true, originalWranglerToml: "previous config snapshot" });
    const sourceState = readFileSync(join(repo, ".line-harness-setup.json"), "utf8");

    await expect(runSetup(repo)).rejects.toThrow("Resume the same source checkout with --from-source");
    expect(readFileSync(join(repo, ".line-harness-setup.json"), "utf8")).toBe(sourceState);
    expect(readFileSync(configPath, "utf8")).toBe("current source config");
    expect(checkDeps).not.toHaveBeenCalled();
    expect(ensureAuth).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(pinRepoToTag).not.toHaveBeenCalled();
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
    expect(wrangler).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects API-level source/release conflicts and invalid versions before loading setup state", async () => {
    await expect(runSetup(repo, { fromSource: true, releaseVersion: "0.24.1" })).rejects.toThrow("併用できません");
    await expect(runSetup(repo, { releaseVersion: "latest" })).rejects.toThrow("stable version");
    expect(readFileSync(join(repo, ".line-harness-setup.json"), "utf8")).toBe(priorState);
    expect(checkDeps).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
  });
});
