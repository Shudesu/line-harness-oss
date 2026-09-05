import * as p from "@clack/prompts";
import {
  writeFileSync,
  existsSync,
  readFileSync,
  unlinkSync,
  mkdirSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { execa } from "execa";
import { wrangler, WranglerError } from "../lib/wrangler.js";
import {
  renderInstalledWranglerToml,
  type InstalledWranglerConfig,
} from "../lib/installed-wrangler.js";
import { repoPnpm } from "../lib/pnpm.js";

const WORKERS_DEV_URL = /(https:\/\/[^\s]+\.workers\.dev)/;
const TTY_REQUIRED = /non[- ]?interactive|cloudflare_api_token|consent denied|authentication error|expired/i;
// Unregistered workers.dev subdomain. Wrangler prints this alongside a
// non-interactive-context error (its registration prompt cannot be answered
// through our pipe), so it would otherwise take the TTY-retry path below and
// lose the message getHelp() keys on — rethrow immediately instead.
const WORKERS_DEV_SUBDOMAIN_UNREGISTERED = /register a workers\.dev subdomain/i;
const RETRYABLE_NETWORK_ERROR =
  /fetch failed|connectivity issue|network connectivity|connection reset|socket hang up/i;
const MAX_DEPLOY_ATTEMPTS = 3;

/** Path (relative to apps/worker) where the official release Worker
 *  artifact is placed. The generated wrangler.toml points main at it. */
export const RELEASE_ARTIFACT_RELPATH = "dist/release/index.js";

interface DeployWorkerOptions {
  repoDir: string;
  d1DatabaseId: string;
  d1DatabaseName: string;
  workerName: string;
  accountId: string;
  liffId: string;
  botBasicId: string;
  r2BucketName: string;
  /**
   * Official release Worker bytes (bundle.tar.gz → worker/index.js).
   * When set, the deploy ships THESE bytes via `no_bundle` so the Worker's
   * baked-in version stamp matches the release manifest and `update` works.
   * Absent only in `--from-source` mode (deploys 0.0.0-dev, no updates).
   */
  bundleWorkerJs?: Buffer;
}

interface DeployWorkerResult {
  workerUrl: string;
}

interface SyncInstalledWorkerConfigOptions extends InstalledWranglerConfig {
  repoDir: string;
  /** See DeployWorkerOptions.bundleWorkerJs — refreshed before the final deploy. */
  bundleWorkerJs?: Buffer;
}

/** Write the release Worker artifact into the clone. */
export function writeReleaseArtifact(
  workerDir: string,
  bundleWorkerJs: Buffer,
): void {
  const artifactPath = join(workerDir, RELEASE_ARTIFACT_RELPATH);
  mkdirSync(dirname(artifactPath), { recursive: true });
  writeFileSync(artifactPath, bundleWorkerJs);
}

async function deployWorkerBundle(
  workerDir: string,
  workerName: string,
): Promise<string> {
  const deployAndParseUrl = async (): Promise<string> => {
    const output = await wrangler(["deploy"], { cwd: workerDir });
    const match = output.match(WORKERS_DEV_URL);
    if (!match) {
      throw new Error(`Worker URL を出力からパースできません:\n${output}`);
    }
    return match[1];
  };

  const isSubdomainUnregisteredError = (error: unknown): boolean =>
    error instanceof WranglerError &&
    WORKERS_DEV_SUBDOMAIN_UNREGISTERED.test(`${error.message}\n${error.stderr}`);

  const isAuthError = (error: unknown): boolean =>
    error instanceof WranglerError &&
    TTY_REQUIRED.test(`${error.message}\n${error.stderr}`);

  const isRetryableNetworkError = (error: unknown): boolean => {
    const text =
      error instanceof WranglerError
        ? `${error.message}\n${error.stderr}`
        : error instanceof Error
          ? error.message
          : String(error);
    return RETRYABLE_NETWORK_ERROR.test(text);
  };

  const sleep = (ms: number) =>
    new Promise((resolve) => setTimeout(resolve, ms));

  for (let attempt = 1; attempt <= MAX_DEPLOY_ATTEMPTS; attempt++) {
    try {
      return await deployAndParseUrl();
    } catch (firstError) {
      // No retry can fix an unregistered subdomain — surface the original
      // WranglerError so setup's top-level catch renders the registration
      // guidance (WranglerError.getHelp()).
      if (isSubdomainUnregisteredError(firstError)) {
        throw firstError;
      }

      if (isAuthError(firstError)) {
        p.log.warn(
          "wrangler の認証を更新するため、対話モードで再実行します（出力が表示されます）...",
        );
        await wrangler(["deploy"], { cwd: workerDir, tty: true });

        try {
          return await deployAndParseUrl();
        } catch (urlError) {
          if (isSubdomainUnregisteredError(urlError)) {
            throw urlError;
          }
          if (
            isRetryableNetworkError(urlError) &&
            attempt < MAX_DEPLOY_ATTEMPTS
          ) {
            p.log.warn(
              `Worker デプロイ後の確認中に一時的な通信エラーが発生したため再試行します (${attempt}/${MAX_DEPLOY_ATTEMPTS})...`,
            );
            await sleep(attempt * 2_000);
            continue;
          }

          const reason =
            urlError instanceof Error ? urlError.message : String(urlError);
          throw new Error(
            [
              "Worker のデプロイは完了しましたが URL を取得できませんでした。",
              `理由: ${reason}`,
              "",
              "対処:",
              "  1. もう一度同じコマンドを実行すると、worker ステップが再試行され URL を取得します。",
              `  2. または \`npx wrangler deployments list --name ${workerName}\` で URL を確認してください。`,
            ].join("\n"),
          );
        }
      }

      if (isRetryableNetworkError(firstError) && attempt < MAX_DEPLOY_ATTEMPTS) {
        p.log.warn(
          `Worker デプロイ中に一時的な通信エラーが発生したため再試行します (${attempt}/${MAX_DEPLOY_ATTEMPTS})...`,
        );
        await sleep(attempt * 2_000);
        continue;
      }

      throw firstError;
    }
  }

  throw new Error("Worker デプロイの再試行回数を超えました");
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

  // Deploy config template. `main` differs between the build pass (the
  // @cloudflare/vite-plugin needs the source entry to produce dist/client)
  // and the bundle deploy pass (ships the official release artifact
  // verbatim via no_bundle).
  const renderDeployToml = (main: string, noBundle: boolean) => `name = "${options.workerName}"
main = "${main}"
${noBundle ? 'no_bundle = true\n' : ""}compatibility_date = "2024-12-01"
compatibility_flags = ["nodejs_compat"]
workers_dev = true
account_id = "${options.accountId}"

# Static assets (LIFF pages) served by Workers Assets.
# Worker runs first so bot UAs get OGP HTML injection; normal UAs are
# served the SPA via env.ASSETS.fetch() in the Worker's notFound handler.
[assets]
directory = "dist/client"
binding = "ASSETS"
run_worker_first = true

[[d1_databases]]
binding = "DB"
database_name = "${options.d1DatabaseName}"
database_id = "${options.d1DatabaseId}"

[[r2_buckets]]
binding = "IMAGES"
bucket_name = "${options.r2BucketName}"

[triggers]
crons = ["*/5 * * * *", "0 */6 * * *"]
`;

  // Build pass config: vite needs the source entrypoint.
  writeFileSync(tomlPath, renderDeployToml("src/index.ts", false));

  // Write .env for Vite build (LIFF client env vars)
  const envPath = join(workerDir, ".env");
  const envContent = `VITE_LIFF_ID=${options.liffId}\nVITE_BOT_BASIC_ID=${options.botBasicId}\n`;
  writeFileSync(envPath, envContent);

  const buildSpinner = p.spinner();
  buildSpinner.start("Worker ビルド中...");
  try {
    // Build workspace dependencies that the worker needs
    await repoPnpm(
      options.repoDir,
      [
        "-r",
        "--filter",
        "./packages/shared",
        "--filter",
        "./packages/line-sdk",
        "--filter",
        "./packages/db",
        "--filter",
        "./packages/update-engine",
        "build",
      ],
      { cwd: options.repoDir },
    );
    await execa("npx", ["vite", "build"], { cwd: workerDir });
    buildSpinner.stop("Worker ビルド完了");

    if (options.bundleWorkerJs) {
      // Deploy the OFFICIAL release Worker bytes (not the local build).
      // Their baked-in _version.ts stamp matches the release manifest, so
      // `update`'s fork detection sees a vanilla install. The local vite
      // build above still provides dist/client (the LIFF SPA assets).
      writeReleaseArtifact(workerDir, options.bundleWorkerJs);
      writeFileSync(tomlPath, renderDeployToml(RELEASE_ARTIFACT_RELPATH, true));
    }

    // Pipe-first: capture deploy output so we can parse the real URL
    // (Cloudflare serves Workers at https://<worker>.<account-subdomain>.workers.dev,
    // so guessing the hostname is unsafe).
    const workerUrl = await deployWorkerBundle(workerDir, options.workerName);

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

export async function syncInstalledWorkerConfig(
  options: SyncInstalledWorkerConfigOptions,
): Promise<void> {
  const workerDir = join(options.repoDir, "apps/worker");
  const tomlPath = join(workerDir, "wrangler.toml");
  if (options.workerDeployMode === "bundle") {
    if (!options.bundleWorkerJs) {
      throw new Error(
        "internal: workerDeployMode=bundle なのに bundleWorkerJs がありません",
      );
    }
    // This is the FINAL deploy of setup — make sure the artifact the
    // generated toml points at is the release bytes (a resumed run may
    // have a stale/absent dist/release/index.js).
    writeReleaseArtifact(workerDir, options.bundleWorkerJs);
  }
  writeFileSync(tomlPath, renderInstalledWranglerToml(options));

  const s = p.spinner();
  s.start("Worker 設定反映中...");
  try {
    await deployWorkerBundle(workerDir, options.workerName);
    s.stop("Worker 設定反映完了");
  } catch (error) {
    s.stop("Worker 設定反映失敗");
    throw error;
  }
}
