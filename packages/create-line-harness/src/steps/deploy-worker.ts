import * as p from "@clack/prompts";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { wrangler } from "../lib/wrangler.js";

interface DeployWorkerOptions {
  repoDir: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  workerName: string;
  accountId: string;
  liffId: string;
  botBasicId: string;
}

interface DeployWorkerResult {
  workerUrl: string;
}

export async function deployWorker(
  options: DeployWorkerOptions,
): Promise<DeployWorkerResult> {
  const s = p.spinner();
  const workerDir = join(options.repoDir, "apps/worker");
  const tomlPath = join(workerDir, "wrangler.toml");

  // Backup existing wrangler.toml
  const originalToml = existsSync(tomlPath)
    ? readFileSync(tomlPath, "utf-8")
    : null;

  // Write deploy wrangler.toml
  s.start("Worker デプロイ中...");
  const deployToml = `name = "${options.workerName}"
main = "src/index.ts"
compatibility_date = "2024-12-01"
workers_dev = true
account_id = "${options.accountId}"

# Static assets (LIFF pages) served by Workers Assets
# SPA fallback ensures all non-API paths serve index.html
[assets]
not_found_handling = "single-page-application"

[[d1_databases]]
binding = "DB"
database_name = "${options.d1DatabaseName}"
database_id = "${options.d1DatabaseId}"

[triggers]
crons = ["*/5 * * * *"]
`;
  writeFileSync(tomlPath, deployToml);

  // Write .env for Vite build (LIFF client env vars)
  const envPath = join(workerDir, ".env");
  const envContent = `VITE_LIFF_ID=${options.liffId}\nVITE_BOT_BASIC_ID=${options.botBasicId}\n`;
  writeFileSync(envPath, envContent);

  try {
    const output = await wrangler(["deploy"], { cwd: workerDir });

    // Parse worker URL from output
    const urlMatch = output.match(/(https:\/\/[^\s]+\.workers\.dev)/);
    const workerUrl = urlMatch
      ? urlMatch[1]
      : `https://${options.workerName}.workers.dev`;

    s.stop("Worker デプロイ完了");
    return { workerUrl };
  } finally {
    // Restore original wrangler.toml
    if (originalToml) {
      writeFileSync(tomlPath, originalToml);
    }
    // Clean up .env
    const deployEnvPath = join(workerDir, ".env");
    if (existsSync(deployEnvPath)) {
      unlinkSync(deployEnvPath);
    }
  }
}
