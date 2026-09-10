import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadState, runSetup, saveState } from "../src/commands/setup.js";
import { createDatabase, readSourceLegacyMileageProjectionVersion } from "../src/steps/database.js";
import { fetchLatestRelease, type FetchedRelease } from "../src/steps/release-bundle.js";
import { setAccountId, wrangler } from "../src/lib/wrangler.js";
import { deployWorker } from "../src/steps/deploy-worker.js";

vi.mock("@clack/prompts", () => ({
  intro: vi.fn(),
  log: { info: vi.fn(), success: vi.fn(), warn: vi.fn() },
}));
vi.mock("../src/steps/check-deps.js", () => ({ checkDeps: vi.fn() }));
vi.mock("../src/steps/auth.js", () => ({ ensureAuth: vi.fn(), getAccountId: vi.fn() }));
vi.mock("../src/steps/clone-repo.js", () => ({ pinRepoToTag: vi.fn() }));
vi.mock("../src/steps/release-bundle.js", () => ({ fetchLatestRelease: vi.fn() }));
vi.mock("../src/steps/ensure-subdomain.js", () => ({ ensureWorkersDevSubdomain: vi.fn() }));
vi.mock("../src/steps/deploy-worker.js", () => ({
  deployWorker: vi.fn(async () => { throw new Error("stop-before-worker-deploy"); }),
  syncInstalledWorkerConfig: vi.fn(),
}));
vi.mock("../src/lib/wrangler.js", async (original) => ({
  ...await original<typeof import("../src/lib/wrangler.js")>(),
  getAccountIds: vi.fn(async () => [{ id: "selected-account", name: "offline" }]),
  setAccountId: vi.fn(),
  wrangler: vi.fn(() => { throw new Error("Unexpected remote command"); }),
}));
vi.mock("../src/steps/database.js", async (original) => {
  const actual = await original<typeof import("../src/steps/database.js")>();
  return { ...actual,
    createDatabase: vi.fn(async () => { throw new Error("stop-before-D1"); }),
    readSourceLegacyMileageProjectionVersion: vi.fn(actual.readSourceLegacyMileageProjectionVersion),
  };
});

describe("setup target mileage capability", () => {
  let repo: string;
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(wrangler).mockImplementation(async () => { throw new Error("Unexpected remote command"); });
    repo = mkdtempSync(join(tmpdir(), "clh-setup-mileage-"));
    mkdirSync(join(repo, "packages/db/src"), { recursive: true });
    saveState(repo, {
      completedSteps: ["r2billing", "credentials", "liffId"],
      projectName: "offline", accountId: "selected-account", apiKey: "offline",
      lineChannelId: "offline", lineChannelAccessToken: "offline", lineChannelSecret: "offline",
      liffId: "offline-liff",
    });
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Unexpected network request"); }));
  });
  afterEach(() => { rmSync(repo, { recursive: true, force: true }); vi.unstubAllGlobals(); });

  it.each([1, undefined] as const)("passes only the verified release capability (%s) in bundle mode", async (capability) => {
    // A newer local source marker must never upgrade an older bundle's capability.
    writeFileSync(join(repo, "packages/db/src/mileage.ts"), "export const LEGACY_MILEAGE_PROJECTION_VERSION = 1;");
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      release: { version: "0.24.0", legacy_mileage_projection_version: capability },
      bundle: {}, manifest: {},
    } as FetchedRelease);
    await expect(runSetup(repo)).rejects.toThrow("stop-before-D1");
    expect(setAccountId).toHaveBeenCalledWith("selected-account");
    expect(createDatabase).toHaveBeenCalledWith(repo, "offline", {
      accountId: "selected-account", legacyMileageProjectionVersion: capability,
    });
    expect(readSourceLegacyMileageProjectionVersion).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([1, 0, undefined] as const)("reads the source capability (%s) without executing the checkout", async (capability) => {
    if (capability !== undefined) writeFileSync(join(repo, "packages/db/src/mileage.ts"),
      `// source capability\nexport const LEGACY_MILEAGE_PROJECTION_VERSION = ${capability};\nthrow new Error('must not execute');`);
    await expect(runSetup(repo, { fromSource: true })).rejects.toThrow("stop-before-D1");
    expect(createDatabase).toHaveBeenCalledWith(repo, "offline", {
      accountId: "selected-account", legacyMileageProjectionVersion: capability === 1 ? 1 : undefined,
    });
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(readSourceLegacyMileageProjectionVersion).toHaveBeenCalledWith(repo);
    expect(fetch).not.toHaveBeenCalled();
  });

  function completedDatabase() {
    const state = loadState(repo);
    saveState(repo, { ...state,
      completedSteps: [...state.completedSteps, "database", "r2"],
      d1DatabaseId: "saved-database-id", d1DatabaseName: "offline",
      r2BucketName: "offline-images", botBasicId: "@offline",
    });
  }

  function mockHandoff(unresolved: 0 | 1) {
    vi.mocked(wrangler).mockImplementation(async (args) => {
      expect(args.slice(0, 6)).toEqual(["d1", "execute", "offline", "--remote", "--json", "--command"]);
      const sql = args[6];
      expect(sql).toMatch(/^SELECT\b/);
      const row = sql.includes("sqlite_master")
        ? { claims_table: 1, queue_table: 1 } : { unresolved };
      return JSON.stringify([{ success: true, results: [row] }]);
    });
  }

  it("blocks source-to-old-bundle resume with completed DB and unfinished held claims", async () => {
    completedDatabase(); // Source setups have no persisted releaseVersion.
    writeFileSync(join(repo, "packages/db/src/mileage.ts"), "export const LEGACY_MILEAGE_PROJECTION_VERSION = 1;");
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      release: { version: "0.23.0" }, bundle: {}, manifest: {},
    } as FetchedRelease);
    mockHandoff(1);
    await expect(runSetup(repo)).rejects.toThrow("awaiting a compatible Worker");
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
    expect(readSourceLegacyMileageProjectionVersion).not.toHaveBeenCalled();
    expect(wrangler).toHaveBeenCalledTimes(2);
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([0, undefined] as const)("blocks completed-DB source resume after marker changed to %s", async (capability) => {
    completedDatabase();
    if (capability !== undefined) writeFileSync(join(repo, "packages/db/src/mileage.ts"),
      `export const LEGACY_MILEAGE_PROJECTION_VERSION = ${capability};`);
    mockHandoff(1);
    await expect(runSetup(repo, { fromSource: true })).rejects.toThrow("awaiting a compatible Worker");
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).not.toHaveBeenCalled();
    expect(fetchLatestRelease).not.toHaveBeenCalled();
    expect(wrangler).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])("allows completed-DB resume with a compatible target (source=%s)", async (fromSource) => {
    completedDatabase();
    writeFileSync(join(repo, "packages/db/src/mileage.ts"), "export const LEGACY_MILEAGE_PROJECTION_VERSION = 1;");
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      release: { version: "0.24.0", legacy_mileage_projection_version: 1 }, bundle: {}, manifest: {},
    } as FetchedRelease);
    await expect(runSetup(repo, { fromSource })).rejects.toThrow("stop-before-worker-deploy");
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).toHaveBeenCalledOnce();
    expect(wrangler).not.toHaveBeenCalled();
  });

  it("allows an old bundle on resume when every held claim has completed", async () => {
    completedDatabase();
    vi.mocked(fetchLatestRelease).mockResolvedValue({
      release: { version: "0.23.0" }, bundle: {}, manifest: {},
    } as FetchedRelease);
    mockHandoff(0);
    await expect(runSetup(repo)).rejects.toThrow("stop-before-worker-deploy");
    expect(createDatabase).not.toHaveBeenCalled();
    expect(deployWorker).toHaveBeenCalledOnce();
    expect(wrangler).toHaveBeenCalledTimes(2);
  });
});
