import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { assertSetupMileageHandoffCompatible, createDatabase, createSetupD1Executor, readSourceLegacyMileageProjectionVersion } from "../src/steps/database.js";
import { wrangler, WranglerError } from "../src/lib/wrangler.js";
import { applyMileageRulesForEvent, processPendingMileageEvents } from "../../db/src/mileage.js";

// Reuse the update engine's SQLite test dependency; no remote D1 is involved.
const Database = createRequire(new URL("../../update-engine/package.json", import.meta.url))("better-sqlite3") as typeof import("../../update-engine/node_modules/better-sqlite3");
const DB_ROOT = join(dirname(fileURLToPath(import.meta.url)), "../../db");
const NAMES = ["062_mileage_admin_and_activity_rules.sql", "063_webinar_instagram_mileage.sql"];
const SOURCES = new Map(NAMES.map((name) => [name, readFileSync(join(DB_ROOT, "migrations", name))]));
const ID = "00000000-0000-4000-8000-000000000001";
const DAY = "2026-09-09T10:00:00.000+09:00";
const NOW = "2026-09-10T20:00:00.000+09:00";

vi.mock("@clack/prompts", () => ({
  spinner: () => ({ start: vi.fn(), stop: vi.fn() }),
  log: { warn: vi.fn() },
}));
vi.mock("../src/lib/wrangler.js", async (original) => ({
  ...await original<typeof import("../src/lib/wrangler.js")>(), wrangler: vi.fn(),
}));
vi.mock("@line-harness/update-engine", async () => import("../../update-engine/src/migrations.js"));

function d1(sqlite: InstanceType<typeof Database>): D1Database {
  return { prepare(sql: string) {
    const bound = (params: unknown[]) => ({
      async run() { return { success: true, results: [], meta: sqlite.prepare(sql).run(...params) }; },
      async first<T>() { return (sqlite.prepare(sql).get(...params) as T) ?? null; },
      async all<T>() { return { success: true, results: sqlite.prepare(sql).all(...params) as T[], meta: {} }; },
    });
    return { ...bound([]), bind: (...params: unknown[]) => bound(params) };
  }} as unknown as D1Database;
}

describe("setup mileage migration transport", () => {
  let repo: string;
  let sqlite: InstanceType<typeof Database>;
  let createdNow: boolean;
  let failAtomic: boolean;
  let commands: string[];

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date(NOW));
    vi.clearAllMocks();
    repo = mkdtempSync(join(tmpdir(), "clh-database-mileage-"));
    mkdirSync(join(repo, "packages/db/migrations"), { recursive: true });
    mkdirSync(join(repo, "packages/db/src"), { recursive: true });
    cpSync(join(DB_ROOT, "bootstrap.sql"), join(repo, "packages/db/schema.sql"));
    for (const name of NAMES) writeFileSync(join(repo, "packages/db/migrations", name), SOURCES.get(name)!);
    sqlite = new Database(":memory:");
    createdNow = false;
    failAtomic = false;
    commands = [];
    vi.mocked(wrangler).mockImplementation(async (args) => {
      if (args[1] === "create") {
        if (!createdNow) throw new WranglerError("already exists", "already exists");
        return JSON.stringify({ database_id: ID });
      }
      if (args[1] === "list") return JSON.stringify([{ name: "offline", uuid: ID }]);
      expect(args.slice(0, 4)).toEqual(["d1", "execute", "offline", "--remote"]);
      const fileIndex = args.indexOf("--file");
      const sql = fileIndex >= 0 ? readFileSync(args[fileIndex + 1], "utf8") : args[args.indexOf("--command") + 1];
      commands.push(sql);
      try {
        let rows: unknown[] = [];
        // Wrangler --remote --command sends ONE /query request, which is atomic.
        sqlite.transaction(() => {
          if (/^\s*SELECT\b/i.test(sql)) rows = sqlite.prepare(sql).all();
          else sqlite.exec(failAtomic && sql.includes("CREATE TABLE _line_harness_legacy_mileage_candidates")
            ? sql.replace("INSERT OR IGNORE INTO _line_harness_migrations", "INSERT OR IGNORE INTO missing_test_table")
            : sql);
        })();
        return JSON.stringify([{ success: true, results: rows }]);
      } catch (error) {
        throw new WranglerError((error as Error).message, (error as Error).message);
      }
    });
  });
  afterEach(() => { sqlite.close(); rmSync(repo, { recursive: true, force: true }); vi.useRealTimers(); });

  const setup = (repo: string, version?: 1) => createDatabase(repo, "offline", { accountId: "account-selected-in-setup", legacyMileageProjectionVersion: version });
  const ledger = () => sqlite.prepare("SELECT * FROM mileage_ledger ORDER BY id").all();

  function seedActivity() {
    sqlite.exec(readFileSync(join(DB_ROOT, "bootstrap.sql"), "utf8"));
    sqlite.exec(`INSERT INTO mileage_programs VALUES ('default','default','Harnessマイル','active','2026-01-01','2026-01-01');
      INSERT INTO users(id,display_name) VALUES('u','offline');
      INSERT INTO line_accounts(id,channel_id,name,channel_access_token,channel_secret) VALUES('a','channel','offline','offline','offline');
      INSERT INTO friends(id,line_user_id,user_id,line_account_id) VALUES('f','Uf','u','a');
      INSERT INTO messages_log(id,friend_id,direction,message_type,content,created_at) VALUES('m','f','incoming','text','offline','${DAY}');
      INSERT INTO webinars(id,account_id,title,slug,duration_seconds,created_at,updated_at) VALUES('w','a','offline','offline',1000,'2026-01-01','2026-01-01');
      INSERT INTO webinar_viewers(id,webinar_id,friend_id,session_start_at,joined_at,last_position_seconds) VALUES('v','w','f',1234,'${DAY}',300);`);
    for (const source of SOURCES.values()) {
      const sql = source.toString("utf8");
      const start = sql.indexOf("INSERT OR IGNORE INTO mileage_rules");
      sqlite.exec(sql.slice(start, sql.indexOf(";", start) + 1));
    }
  }

  it("keeps existing settled message + webinar mileage at 6 across setup and checksum retries", async () => {
    seedActivity();
    await applyMileageRulesForEvent(d1(sqlite), { eventType: "message_received", source: "line", sourceEventId: "m", friendId: "f", occurredAt: DAY });
    await applyMileageRulesForEvent(d1(sqlite), { eventType: "webinar_watch_5m", source: "webinar", sourceEventId: "w:f:5m", friendId: "f", subjectKey: "w", occurredAt: DAY });
    await processPendingMileageEvents(d1(sqlite), { now: NOW });
    const before = ledger();
    expect(sqlite.prepare("SELECT SUM(amount) AS amount FROM mileage_ledger").get()).toEqual({ amount: 6 });
    expect(await setup(repo, 1)).toEqual({ databaseId: ID, databaseName: "offline" });
    expect(ledger()).toEqual(before);
    expect(sqlite.prepare("SELECT name,checksum FROM _line_harness_migrations ORDER BY name").all()).toEqual(
      NAMES.map((name) => ({ name, checksum: `sha256:${createHash("sha256").update(SOURCES.get(name)!).digest("hex")}` })),
    );
    expect(commands.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+mileage_ledger/i.test(sql))).toBe(false);
    expect(vi.mocked(wrangler).mock.calls.some(([args]) => args.includes("--file") && /06[23]_/.test(args.at(-1)!))).toBe(false);
    commands = [];
    await setup(repo); // Exact ledger matches are valid even for an old target.
    expect(ledger()).toEqual(before);
    expect(commands.some((sql) => sql.includes("CREATE TABLE _line_harness_legacy_mileage_candidates"))).toBe(false);
  });

  it("refuses unrecorded history for an unknown target without changing financial rows", async () => {
    seedActivity();
    const before = ledger();
    await expect(setup(repo)).rejects.toThrow("Select a compatible Worker release");
    expect(ledger()).toEqual(before);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM _line_harness_migrations").get()).toEqual({ n: 0 });
    expect(commands.some((sql) => /INSERT\s+OR\s+IGNORE\s+INTO\s+mileage_ledger/i.test(sql))).toBe(false);
  });

  it("retries an initially empty existing database using the actual pre-062 setup SQL", async () => {
    cpSync(join(DB_ROOT, "schema.sql"), join(repo, "packages/db/schema.sql"));
    for (const name of readdirSync(join(DB_ROOT, "migrations")).filter((name) => name.endsWith(".sql") && name < "062")) {
      cpSync(join(DB_ROOT, "migrations", name), join(repo, "packages/db/migrations", name));
    }
    await setup(repo, 1);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM _line_harness_migrations").get()).toEqual({ n: 2 });
    expect(ledger()).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM mileage_rules").get()).toEqual({ n: 12 });
    await setup(repo, 1);
    expect(ledger()).toEqual([]);
  });

  it("rolls back a failed atomic claim, then succeeds without duplicating grants", async () => {
    seedActivity();
    failAtomic = true;
    await expect(setup(repo, 1)).rejects.toThrow("atomically");
    expect(ledger()).toEqual([]);
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM engagement_events").get()).toEqual({ n: 0 });
    expect(sqlite.prepare("SELECT COUNT(*) AS n FROM _line_harness_migrations").get()).toEqual({ n: 0 });
    failAtomic = false;
    await setup(repo, 1);
    expect(ledger()).toEqual([]);
    await processPendingMileageEvents(d1(sqlite), { now: NOW });
    expect(sqlite.prepare("SELECT SUM(amount) AS amount FROM mileage_ledger").get()).toEqual({ amount: 6 });
  });

  it("keeps fresh bootstrap to one schema request with covered migrations skipped", async () => {
    createdNow = true;
    cpSync(join(DB_ROOT, "bootstrap.sql"), join(repo, "packages/db/bootstrap.sql"));
    writeFileSync(join(repo, "packages/db/bootstrap-meta.json"), JSON.stringify({ includedMigrations: NAMES, migrationCount: 2 }));
    await setup(repo);
    expect(commands).toHaveLength(2); // bootstrap + final schema verification
    expect(sqlite.prepare("SELECT name FROM sqlite_master WHERE name='_line_harness_migrations'").get()).toBeUndefined();
  });

  it("binds hostile values as data, preserving question marks in SQL literals and comments", async () => {
    sqlite.exec("CREATE TABLE protected_table(value TEXT)");
    const hostile = "a'); DROP TABLE protected_table; -- ? `touch should-never-run` $(echo unsafe)\u0000日本語";
    const execute = createSetupD1Executor("offline");
    const response = await execute({ creds: { accountId: "", apiToken: "" }, databaseId: ID,
      sql: "SELECT ? AS value, '?' AS question /* ? */ -- ?\n", params: [hostile] });
    expect(response.result[0].results).toEqual([{ value: hostile, question: "?" }]);
    expect(sqlite.prepare("SELECT * FROM protected_table").all()).toEqual([]);
    expect(vi.mocked(wrangler).mock.lastCall![0].at(-1)).not.toContain(hostile);
    await expect(execute({ creds: { accountId: "", apiToken: "" }, databaseId: ID, sql: "SELECT ?", params: [] })).rejects.toThrow("missing");
    await expect(execute({ creds: { accountId: "", apiToken: "" }, databaseId: ID, sql: "SELECT 1", params: [hostile] })).rejects.toThrow("Unexpected");
  });

  it.each(["not JSON", "[]", '[{"success":false,"results":[]}]', '{"success":true,"result":[]}'])
    ("rejects invalid or unsuccessful Wrangler results: %s", async (output) => {
      vi.mocked(wrangler).mockResolvedValueOnce(output);
      await expect(createSetupD1Executor("offline")({ creds: { accountId: "", apiToken: "" }, databaseId: ID, sql: "SELECT 1" })).rejects.toThrow("D1 migration query");
    });

  it("only recognizes the non-executed source capability header", () => {
    const file = join(repo, "packages/db/src/mileage.ts");
    expect(readSourceLegacyMileageProjectionVersion(repo)).toBeUndefined();
    for (const source of [
      "export const LEGACY_MILEAGE_PROJECTION_VERSION = 0;",
      "/* export const LEGACY_MILEAGE_PROJECTION_VERSION = 1; */\nexport const unrelated = 1;",
      "const text = `\nexport const LEGACY_MILEAGE_PROJECTION_VERSION = 1;\n`;",
      "export const LEGACY_MILEAGE_PROJECTION_VERSION = 10;",
    ]) {
      writeFileSync(file, source);
      expect(readSourceLegacyMileageProjectionVersion(repo)).toBeUndefined();
    }
    writeFileSync(file, "/* header */\n// header\nexport const LEGACY_MILEAGE_PROJECTION_VERSION = 1;\nthrow new Error('must not execute');");
    expect(readSourceLegacyMileageProjectionVersion(repo)).toBe(1);
  });

  it.each(["pending", "processing", "failed", undefined])("blocks an incompatible Worker when a retained claim has queue status %s", async (status) => {
    seedActivity();
    sqlite.exec("CREATE TABLE _line_harness_legacy_mileage_claims(engagement_event_id TEXT PRIMARY KEY); INSERT INTO _line_harness_legacy_mileage_claims VALUES('claim')");
    // The production queue has a foreign key, so create the event via runtime.
    const event = await applyMileageRulesForEvent(d1(sqlite), { eventType: "message_received", source: "line", sourceEventId: "m", friendId: "f", occurredAt: DAY });
    sqlite.prepare("UPDATE _line_harness_legacy_mileage_claims SET engagement_event_id=?").run(event.event.id);
    if (status) sqlite.prepare("UPDATE mileage_event_queue SET status=?").run(status);
    else sqlite.exec("DELETE FROM mileage_event_queue");
    const before = sqlite.prepare("SELECT * FROM mileage_event_queue").all();
    await expect(assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline" })).rejects.toThrow("awaiting a compatible Worker");
    expect(sqlite.prepare("SELECT * FROM mileage_event_queue").all()).toEqual(before);
    expect(ledger()).toEqual([]);
    expect(commands.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
  });

  it("allows an old target only when handoff is absent or all claims are processed", async () => {
    await assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline" });
    expect(commands).toHaveLength(1);
    sqlite.exec(`CREATE TABLE _line_harness_legacy_mileage_claims(engagement_event_id TEXT PRIMARY KEY);
      INSERT INTO _line_harness_legacy_mileage_claims VALUES('claim');
      CREATE TABLE mileage_event_queue(engagement_event_id TEXT PRIMARY KEY, status TEXT);
      INSERT INTO mileage_event_queue VALUES('claim','processed');`);
    await assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline" });
    expect(commands).toHaveLength(3);
    expect(commands.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
  });

  it("blocks unresolved claims even when their entire queue table is missing", async () => {
    sqlite.exec("CREATE TABLE _line_harness_legacy_mileage_claims(engagement_event_id TEXT PRIMARY KEY); INSERT INTO _line_harness_legacy_mileage_claims VALUES('claim')");
    await expect(assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline" })).rejects.toThrow("awaiting a compatible Worker");
    expect(commands.every((sql) => /^SELECT\b/.test(sql))).toBe(true);
  });

  it("refuses unavailable handoff probes instead of interpreting them as no claims", async () => {
    vi.mocked(wrangler).mockResolvedValueOnce('[{"success":true,"results":[]}]');
    await expect(assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline" })).rejects.toThrow("Cannot verify");
    vi.mocked(wrangler).mockResolvedValueOnce('[{"success":true,"results":[{"claims_table":1,"queue_table":1}]}]')
      .mockResolvedValueOnce('[{"success":true,"results":[]}]');
    await expect(assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline" })).rejects.toThrow("Cannot verify");
  });

  it("does not need additional DB queries when the target can finish held claims", async () => {
    await assertSetupMileageHandoffCompatible({ databaseId: ID, databaseName: "offline", legacyMileageProjectionVersion: 1 });
    expect(wrangler).not.toHaveBeenCalled();
  });
});
