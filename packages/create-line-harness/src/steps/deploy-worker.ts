import * as p from "@clack/prompts";
import { writeFileSync, existsSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { execa } from "execa";
import { wrangler, WranglerError } from "../lib/wrangler.js";

const WORKERS_DEV_URL = /(https:\/\/[^\s]+\.workers\.dev)/;
const TTY_REQUIRED = /non[- ]?interactive|cloudflare_api_token|consent denied|authentication error|expired/i;

interface DeployWorkerOptions {
  repoDir: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  workerName: string;
  accountId: string;
  liffId: string;
  botBasicId: string;
  r2BucketName: string;
}

interface DeployWorkerResult {
  workerUrl: string;
}

export async function deployWorker(
  options: DeployWorkerOptions,
): Promise<DeployWorkerResult> {
  const workerDir = join(options.repoDir, "apps/worker");
  const tomlPath = join(workerDir, "wrangler.toml");

  // Backup existing wrangler.toml
  const originalToml = existsSync(tomlPath)
    ? readFileSync(tomlPath, "utf-8")
    : null;

  // Write deploy wrangler.toml
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

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "${options.r2BucketName}"

[triggers]
crons = ["*/5 * * * *"]
`;
  writeFileSync(tomlPath, deployToml);

  // Write .env for Vite build (LIFF client env vars)
  const envPath = join(workerDir, ".env");
  const envContent = `VITE_LIFF_ID=${options.liffId}\nVITE_BOT_BASIC_ID=${options.botBasicId}\n`;
  writeFileSync(envPath, envContent);

  const buildSpinner = p.spinner();
  buildSpinner.start("Worker ビルド中...");
  try {
    // Build workspace dependencies that the worker needs
    await execa("npx", ["pnpm", "-r", "--filter", "./packages/shared", "--filter", "./packages/line-sdk", "--filter", "./packages/db", "build"], { cwd: options.repoDir });
    await execa("npx", ["vite", "build"], { cwd: workerDir });
    buildSpinner.stop("Worker ビルド完了");

    // Pipe-first: capture deploy output so we can parse the real URL
    // (Cloudflare serves Workers at https://<worker>.<account-subdomain>.workers.dev,
    // so guessing the hostname is unsafe).
    let workerUrl: string;
    try {
      const output = await wrangler(["deploy"], { cwd: workerDir });
      const match = output.match(WORKERS_DEV_URL);
      if (!match) {
        throw new Error(`Worker URL を出力からパースできません:\n${output}`);
      }
      workerUrl = match[1];
    } catch (firstError) {
      // Pipe deploy may fail with "non-interactive / CLOUDFLARE_API_TOKEN required"
      // when wrangler needs to refresh its OAuth token. Retry once with a real TTY.
      const isAuthError =
        firstError instanceof WranglerError &&
        TTY_REQUIRED.test(firstError.stderr);
      if (!isAuthError) throw firstError;

      p.log.warn(
        "wrangler の認証を更新するため、対話モードで再実行します（出力が表示されます）...",
      );
      await wrangler(["deploy"], { cwd: workerDir, tty: true });

      // Worker is now live. Try a second pipe call to recover the URL — token
      // is fresh so this should succeed cheaply. If it doesn't, we deliberately
      // keep state.workerUrl unset by throwing: the next setup run will retry
      // the worker step (it isn't marked complete yet) and recover the URL.
      try {
        const output = await wrangler(["deploy"], { cwd: workerDir });
        const match = output.match(WORKERS_DEV_URL);
        if (!match) {
          throw new Error("URL not found in second deploy output");
        }
        workerUrl = match[1];
      } catch (urlError) {
        const reason =
          urlError instanceof Error ? urlError.message : String(urlError);
        throw new Error(
          [
            "Worker のデプロイは完了しましたが URL を取得できませんでした。",
            `理由: ${reason}`,
            "",
            "対処:",
            `  1. もう一度同じコマンドを実行すると、worker ステップが再試行され URL を取得します。`,
            `  2. または \`npx wrangler deployments list --name ${options.workerName}\` で URL を確認してください。`,
          ].join("\n"),
        );
      }
    }

    p.log.success(`Worker デプロイ完了: ${workerUrl}`);
    return { workerUrl };
  } catch (error) {
    // Make sure the spinner is stopped before the error bubbles up
    try {
      buildSpinner.stop("Worker デプロイ失敗");
    } catch {
      // already stopped
    }
    throw error;
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
