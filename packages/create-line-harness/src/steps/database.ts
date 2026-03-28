import * as p from "@clack/prompts";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { wrangler, WranglerError } from "../lib/wrangler.js";

interface DatabaseResult {
  databaseId: string;
  databaseName: string;
}

export async function createDatabase(
  repoDir: string,
): Promise<DatabaseResult> {
  const s = p.spinner();
  const databaseName = "line-harness";

  // Create D1 database
  s.start("D1 データベース作成中...");
  let databaseId: string;
  try {
    const output = await wrangler(["d1", "create", databaseName]);
    // Parse database_id from TOML or JSON format
    const tomlMatch = output.match(/database_id\s*=\s*"([^"]+)"/);
    const jsonMatch = output.match(/"database_id"\s*:\s*"([^"]+)"/);
    const uuidMatch = output.match(
      /([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})/i,
    );
    const match = tomlMatch || jsonMatch || uuidMatch;
    if (!match) {
      throw new Error(`D1 ID をパースできません: ${output}`);
    }
    databaseId = match[1];
    s.stop("D1 データベース作成完了");
  } catch (error) {
    if (
      error instanceof WranglerError &&
      error.stderr.includes("already exists")
    ) {
      s.stop("D1 データベースは既に存在します");
      const listOutput = await wrangler(["d1", "list", "--json"]);
      const databases = JSON.parse(listOutput);
      const db = databases.find(
        (d: { name: string }) => d.name === databaseName,
      );
      if (!db) {
        throw new Error("既存の D1 データベースが見つかりません");
      }
      databaseId = db.uuid;
    } else {
      throw error;
    }
  }

  // Run base schema first, then migrations
  const schemaFile = join(repoDir, "packages/db/schema.sql");
  const migrationsDir = join(repoDir, "packages/db/migrations");
  const migrationFiles = readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  const totalFiles = 1 + migrationFiles.length;
  s.start(`テーブル作成中（${totalFiles} files）...`);

  // Base schema (CREATE IF NOT EXISTS — safe to re-run)
  try {
    await wrangler([
      "d1",
      "execute",
      databaseName,
      "--remote",
      "--file",
      schemaFile,
    ]);
  } catch {
    // May fail if tables exist with different schema — continue to migrations
  }

  // Migration files
  for (const file of migrationFiles) {
    try {
      await wrangler([
        "d1",
        "execute",
        databaseName,
        "--remote",
        "--file",
        join(migrationsDir, file),
      ]);
    } catch {
      // Already applied — continue
    }
  }
  s.stop("テーブル作成完了");

  return { databaseId, databaseName };
}
