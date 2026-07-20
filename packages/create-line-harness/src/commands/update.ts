import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { Readable } from "node:stream";
import {
  fetchManifest,
  detectFork,
  findLatestUpgrade,
  compareSemver,
  parseBundleStream,
  verifyBundleHashes,
  verifyBundleIntegrity,
  executeD1Query,
  putWorkerScript,
  listWorkerBindings,
  deployPagesProject,
  materializeAdminFiles,
  findResidualPlaceholders,
  isBenignSchemaErrorText,
  type CfApiCreds,
  type CurrentVersion,
  type ParsedBundle,
  type ReleaseEntry,
  type WorkerBinding,
} from "@line-harness/update-engine";
import { configureAdminAuth } from "../steps/admin-auth.js";
import { ensureWorkersDevSubdomain } from "../steps/ensure-subdomain.js";
import { subdomainFromWorkersDevUrl } from "../lib/subdomain-name.js";
import {
  isGeneratedInstalledWranglerToml,
  renderInstalledWranglerToml,
  resolveInstalledWranglerConfig,
  type SavedInstallConfig,
} from "../lib/installed-wrangler.js";

/** Must mirror apps/worker/wrangler.toml — the script upload API replaces
 *  metadata wholesale, so omitting this would strip nodejs_compat. */
const WORKER_COMPATIBILITY_FLAGS = ["nodejs_compat"];

/**
 * Shape of `.line-harness-config.json` written by `setup.ts` after
 * a successful install. Older installs may be missing newer fields
 * (e.g. `cfApiToken`, `liffProject`, public URLs) — the update flow
 * surfaces a clear error in that case rather than guessing.
 */
interface SetupState {
  projectName?: string;
  workerName?: string;
  adminProject?: string;
  liffProject?: string;
  // legacy fields written by older setup.ts
  adminUrl?: string;
  workerUrl?: string;
  d1DatabaseId?: string;
  d1DatabaseName?: string;
  r2BucketName?: string;
  accountId?: string;
  cfAccountId?: string;
  cfApiToken?: string;
  manifestUrl?: string;
  workerPublicUrl?: string;
  adminPublicUrl?: string;
  liffPublicUrl?: string;
  [key: string]: unknown;
}

const DEFAULT_MANIFEST_URL =
  "https://github.com/Shudesu/line-harness-oss/releases/latest/download/release-manifest.json";

export function loadState(repoDir: string): SetupState | null {
  const configPath = join(repoDir, ".line-harness-config.json");
  if (!existsSync(configPath)) return null;
  try {
    return JSON.parse(readFileSync(configPath, "utf-8")) as SetupState;
  } catch {
    return null;
  }
}

/**
 * Persist a changed Worker public URL back to `.line-harness-config.json`
 * after the workers.dev subdomain was re-registered under a new name.
 * Updates the legacy `workerUrl` alias too, and `liffPublicUrl` when it
 * pointed at the same origin — worker-assets installs rely on
 * `liffPublicUrl === workerPublicUrl` to resolve as "no LIFF Pages project"
 * (see resolveState), so leaving it stale would trigger a bogus liffProject
 * prompt on the next run. Best-effort: on failure the next run simply
 * re-detects the mismatch.
 */
function persistWorkerPublicUrl(
  configPath: string,
  oldUrl: string,
  newUrl: string,
): void {
  try {
    const config = JSON.parse(readFileSync(configPath, "utf-8")) as SetupState;
    config.workerPublicUrl = newUrl;
    if (config.workerUrl !== undefined) config.workerUrl = newUrl;
    if (config.liffPublicUrl === oldUrl) config.liffPublicUrl = newUrl;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");
    p.log.success(`設定を保存しました: ${configPath}`);
  } catch (e) {
    p.log.warn(
      `Worker URL の設定保存に失敗: ${e instanceof Error ? e.message : String(e)} — 続行します`,
    );
  }
}

/**
 * Fully-resolved update configuration.
 *
 * `liffProject`/`liffPublicUrl` are '' for worker-assets installs — current
 * CLI setups serve the LIFF SPA from the Worker's own assets and never
 * create a LIFF Pages project. All LIFF Pages steps are skipped for them.
 */
interface ResolvedUpdateConfig {
  workerName: string;
  adminProject: string;
  liffProject: string;
  d1DatabaseId: string;
  cfAccountId: string;
  cfApiToken: string;
  manifestUrl: string;
  workerPublicUrl: string;
  adminPublicUrl: string;
  liffPublicUrl: string;
}

/**
 * Normalize the on-disk config into the strict shape the update flow needs.
 *
 * Fallback layers:
 *   - `cfAccountId` may be stored as legacy `accountId`.
 *   - `workerPublicUrl` may be derivable from legacy `workerUrl`.
 *   - `adminProject` may be derivable from legacy `adminUrl` hostname.
 *   - `liffProject` absent + `liffPublicUrl` absent-or-equal-to-workerUrl
 *     means a worker-assets install (setup.ts intentionally omits the
 *     field) → resolved as '' (no LIFF Pages project). Only the ambiguous
 *     case (a distinct liffPublicUrl with no project name) still prompts.
 *
 * Returns `{ ok: false }` (with diagnostic message via caller) if a
 * non-recoverable field is missing. We never *guess* the API token — that
 * has to be supplied via env var if absent from config.
 */
export function resolveState(
  state: SetupState,
  envApiToken: string | undefined,
): { ok: true; value: ResolvedUpdateConfig } | { ok: false; missing: string[] } {
  const missing: string[] = [];

  const workerName = state.workerName ?? state.projectName;
  if (!workerName) missing.push("workerName");

  const cfAccountId = state.cfAccountId ?? state.accountId;
  if (!cfAccountId) missing.push("cfAccountId");

  const cfApiToken = state.cfApiToken ?? envApiToken;
  if (!cfApiToken) missing.push("cfApiToken (set CLOUDFLARE_API_TOKEN env)");

  if (!state.d1DatabaseId) missing.push("d1DatabaseId");

  // Derive adminProject from legacy adminUrl if needed.
  let adminProject = state.adminProject;
  if (!adminProject && typeof state.adminUrl === "string") {
    try {
      adminProject = new URL(state.adminUrl).hostname.replace(
        /\.pages\.dev$/,
        "",
      );
    } catch {
      /* ignore */
    }
  }
  if (!adminProject) missing.push("adminProject");

  // Worker public URL — prefer explicit, else legacy workerUrl.
  const workerPublicUrl = state.workerPublicUrl ?? state.workerUrl;
  if (!workerPublicUrl) missing.push("workerPublicUrl");

  const adminPublicUrl = state.adminPublicUrl ?? state.adminUrl;
  if (!adminPublicUrl) missing.push("adminPublicUrl");

  // LIFF topology resolution. '' (empty string) is a valid persisted value
  // meaning "no LIFF Pages project".
  let liffProject = state.liffProject;
  if (liffProject === undefined) {
    if (!state.liffPublicUrl || state.liffPublicUrl === workerPublicUrl) {
      // Worker-assets install: LIFF is served by the Worker itself.
      liffProject = "";
    } else {
      // A separate LIFF URL exists but its Pages project name is unknown —
      // legacy 3-artifact install with an incomplete config. Prompt.
      missing.push("liffProject");
    }
  }
  const liffPublicUrl = liffProject ? state.liffPublicUrl : "";
  if (liffProject && !state.liffPublicUrl) missing.push("liffPublicUrl");

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: {
      workerName: workerName!,
      adminProject: adminProject!,
      liffProject: liffProject!,
      d1DatabaseId: state.d1DatabaseId!,
      cfAccountId: cfAccountId!,
      cfApiToken: cfApiToken!,
      manifestUrl: state.manifestUrl ?? DEFAULT_MANIFEST_URL,
      workerPublicUrl: workerPublicUrl!,
      adminPublicUrl: adminPublicUrl!,
      liffPublicUrl: liffPublicUrl ?? "",
    },
  };
}

/**
 * Interactively fill in fields missing from `.line-harness-config.json`
 * (legacy installs that pre-date Task 22) and persist them back to the
 * file so we don't ask again. The returned state has the new fields
 * merged in but is otherwise the original on-disk object.
 *
 * The prompts try to be helpful:
 *   - workerPublicUrl: derivable from `workerName` as `<name>.workers.dev`
 *   - liffPublicUrl: derivable from `liffProject` as `<proj>.pages.dev`
 *   - adminProject: derivable from `adminUrl` hostname
 * For the rest the user has to paste in the value from the CF dashboard.
 *
 * `cfApiToken` is NOT prompted — it must come from CLOUDFLARE_API_TOKEN
 * env because secrets don't belong in `.line-harness-config.json` (which
 * gets committed by some operators).
 */
async function promptForMissingFields(
  state: SetupState,
  configPath: string,
  missing: string[],
): Promise<SetupState> {
  // Exclude cfApiToken from prompt — it has to be env-supplied.
  const promptable = missing.filter((m) => !m.startsWith("cfApiToken"));
  if (promptable.length === 0) {
    return state;
  }

  p.log.warn(
    [
      "`.line-harness-config.json` に不足フィールドがあります。",
      "v0.1.19 以前にセットアップした環境では新しいフィールドが書き込まれていません。",
      "値を入力すると設定ファイルに保存され、次回以降は聞かれません。",
    ].join("\n"),
  );

  const updated: SetupState = { ...state };

  for (const field of promptable) {
    switch (field) {
      case "workerName": {
        const v = await p.text({
          message: "Worker 名 (例: line-harness — wrangler.toml の name)",
          validate(value) {
            if (!value) return "必須";
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.workerName = (v as string).trim();
        break;
      }
      case "cfAccountId": {
        const v = await p.text({
          message:
            "Cloudflare Account ID (wrangler.toml の account_id、または CF ダッシュボード右下)",
          validate(value) {
            if (!value || !/^[a-f0-9]{32}$/i.test(value.trim())) {
              return "32 桁の16進文字列です";
            }
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.cfAccountId = (v as string).trim();
        break;
      }
      case "d1DatabaseId": {
        const v = await p.text({
          message:
            "D1 Database ID (`npx wrangler d1 list` で確認、wrangler.toml の database_id)",
          validate(value) {
            if (!value) return "必須";
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.d1DatabaseId = (v as string).trim();
        break;
      }
      case "adminProject": {
        // Try to derive from existing adminUrl first; otherwise prompt.
        let derived: string | undefined;
        if (typeof updated.adminUrl === "string") {
          try {
            derived = new URL(updated.adminUrl).hostname.replace(
              /\.pages\.dev$/,
              "",
            );
          } catch {
            /* ignore */
          }
        }
        const v = await p.text({
          message:
            "Admin Pages プロジェクト名 (CF ダッシュボード → Pages、例: line-harness-admin-xxxxxxxx)",
          placeholder: derived,
          defaultValue: derived,
          validate(value) {
            if (!value && !derived) return "必須";
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.adminProject = ((v as string) || derived || "").trim();
        break;
      }
      case "liffProject": {
        const v = await p.text({
          message:
            "LIFF Pages プロジェクト名 (例: lh-liff-abc123 — CF ダッシュボードで確認。LIFF Pages を使っていない場合は空 Enter でスキップ)",
          defaultValue: "",
          validate(value) {
            if (value && !/^[a-z0-9][a-z0-9-]*$/i.test(value.trim())) {
              return "英数字とハイフンのみ";
            }
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        // '' is persisted intentionally: it means "no LIFF Pages project"
        // (worker-assets install) and stops future prompts.
        updated.liffProject = ((v as string) || "").trim();
        break;
      }
      case "workerPublicUrl": {
        // Try to derive from workerName.
        const derived = updated.workerName
          ? `https://${updated.workerName}.workers.dev`
          : undefined;
        const v = await p.text({
          message: "Worker public URL (例: https://line-harness.workers.dev)",
          placeholder: derived,
          defaultValue: derived,
          validate(value) {
            const s = (value || derived || "").trim();
            if (!s) return "必須";
            try {
              new URL(s);
            } catch {
              return "有効な URL を入力してください";
            }
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.workerPublicUrl = ((v as string) || derived || "").trim();
        break;
      }
      case "adminPublicUrl": {
        const derived =
          (typeof updated.adminUrl === "string" && updated.adminUrl) ||
          (updated.adminProject
            ? `https://${updated.adminProject}.pages.dev`
            : undefined);
        const v = await p.text({
          message:
            "Admin public URL (例: https://line-harness-admin-xxxxxxxx.pages.dev)",
          placeholder: derived,
          defaultValue: derived,
          validate(value) {
            const s = (value || derived || "").trim();
            if (!s) return "必須";
            try {
              new URL(s);
            } catch {
              return "有効な URL を入力してください";
            }
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.adminPublicUrl = ((v as string) || derived || "").trim();
        break;
      }
      case "liffPublicUrl": {
        const derived = updated.liffProject
          ? `https://${updated.liffProject}.pages.dev`
          : undefined;
        const v = await p.text({
          message: "LIFF public URL (例: https://lh-liff-abc123.pages.dev)",
          placeholder: derived,
          defaultValue: derived,
          validate(value) {
            const s = (value || derived || "").trim();
            if (!s) return "必須";
            try {
              new URL(s);
            } catch {
              return "有効な URL を入力してください";
            }
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.liffPublicUrl = ((v as string) || derived || "").trim();
        break;
      }
      default:
        // Unknown field — log and skip so we don't dead-loop.
        p.log.warn(`未知のフィールド "${field}" は手動で追記してください`);
        break;
    }
  }

  // Persist merged config back to disk so the next run is non-interactive.
  try {
    writeFileSync(configPath, JSON.stringify(updated, null, 2) + "\n");
    p.log.success(`設定を保存しました: ${configPath}`);
  } catch (e) {
    p.log.warn(
      `設定保存に失敗: ${e instanceof Error ? e.message : String(e)} — 続行はしますが次回も同じプロンプトが出ます`,
    );
  }

  return updated;
}

export interface RunUpdateOptions {
  /**
   * Re-deploy only the Admin Pages artifact that matches the currently
   * deployed Worker. Used to recover from a partial update without touching
   * D1, the Worker script, bindings, assets, or LIFF.
   */
  repairAdmin?: boolean;
}

export async function runUpdate(
  repoDir: string,
  options: RunUpdateOptions = {},
): Promise<void> {
  p.intro(pc.bgCyan(pc.black(" LINE Harness アップデート ")));

  const configPath = join(repoDir, ".line-harness-config.json");
  let state = loadState(repoDir);
  if (!state) {
    p.cancel(
      ".line-harness-config.json が見つかりません。先に `npx create-line-harness` でセットアップしてください。",
    );
    process.exit(1);
  }

  let resolved = resolveState(state, process.env.CLOUDFLARE_API_TOKEN);
  if (!resolved.ok) {
    // First pass missing — prompt for legacy-install gaps, then re-resolve.
    state = await promptForMissingFields(state, configPath, resolved.missing);
    resolved = resolveState(state, process.env.CLOUDFLARE_API_TOKEN);
    if (!resolved.ok) {
      p.log.error(pc.red("入力後も以下のフィールドが解決できません:"));
      for (const m of resolved.missing) {
        p.log.error(`  - ${m}`);
      }
      if (resolved.missing.some((m) => m.startsWith("cfApiToken"))) {
        p.log.info(
          "CLOUDFLARE_API_TOKEN は config に保存しません。`export CLOUDFLARE_API_TOKEN=...` してから再実行してください。",
        );
      }
      p.cancel("セットアップを完了させてから再実行してください。");
      process.exit(1);
    }
  }
  const cfg = resolved.value;

  // /admin/version is documented as public (intentionally un-authenticated
  // so the dashboard can render the upgrade banner pre-login). The header
  // is only sent in case a future Worker version starts requiring it.
  const ADMIN_API_KEY = process.env.ADMIN_API_KEY;
  if (!ADMIN_API_KEY) {
    p.log.warn(
      "ADMIN_API_KEY 環境変数が未設定です。/admin/version は現在パブリックなので続行しますが、" +
        "Worker が将来この認証を要求する場合は `export ADMIN_API_KEY=...` が必要になります。",
    );
  }

  p.log.success(`プロジェクト: ${state.projectName ?? cfg.workerName}`);

  // 0) workers.dev-hosted installs: if the account-level workers.dev
  // subdomain has been deleted since install, EVERY Worker URL probe below
  // (/admin/version, health check) fails — so check and repair it before
  // the first probe. Skipped for custom-domain installs (no workers.dev
  // hostname to repair).
  let subdomainRegisteredNow = false;
  let workerUrlRenamed = false;
  const expectedSubdomain = subdomainFromWorkersDevUrl(cfg.workerPublicUrl);
  if (expectedSubdomain) {
    const ensured = await ensureWorkersDevSubdomain({
      accountId: cfg.cfAccountId,
      apiToken: cfg.cfApiToken,
      defaultName: expectedSubdomain,
    });
    subdomainRegisteredNow = ensured.registeredNow;
    if (ensured.subdomain && ensured.subdomain !== expectedSubdomain) {
      // Registered/found under a different name — the saved Worker URL's
      // hostname is dead. Point config + this run at the new one.
      const workerLabel = new URL(cfg.workerPublicUrl).hostname.split(".")[0];
      const newUrl = `https://${workerLabel}.${ensured.subdomain}.workers.dev`;
      p.log.warn(`Worker URL を更新します: ${cfg.workerPublicUrl} → ${newUrl}`);
      persistWorkerPublicUrl(configPath, cfg.workerPublicUrl, newUrl);
      cfg.workerPublicUrl = newUrl;
      workerUrlRenamed = true;
    }
  }

  // 1) Fetch current version from deployed Worker
  const s = p.spinner();
  s.start("現在バージョン取得中");
  const workerVersionUrl = `${cfg.workerPublicUrl.replace(/\/$/, "")}/admin/version`;
  let current: CurrentVersion;
  try {
    const headers: Record<string, string> = {};
    if (ADMIN_API_KEY) headers["x-admin-api-key"] = ADMIN_API_KEY;
    const r = await fetch(workerVersionUrl, { headers });
    if (!r.ok) {
      throw new Error(`HTTP ${r.status}`);
    }
    current = (await r.json()) as CurrentVersion;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Worker /admin/version 取得失敗: ${msg}`));
    p.cancel(
      subdomainRegisteredNow
        ? "workers.dev サブドメイン登録直後のため DNS 反映待ちの可能性があります。数分待ってから同じコマンドを再実行してください。"
        : "Worker が応答していません。デプロイ状態を確認してください。",
    );
    process.exit(1);
  }
  s.stop(`現在: v${current.version}`);

  // 2) Fetch manifest
  s.start("最新マニフェスト取得中");
  let manifest;
  try {
    manifest = await fetchManifest(cfg.manifestUrl);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`manifest 取得失敗: ${msg}`));
    process.exit(1);
  }
  s.stop(`最新: v${manifest.latest}`);

  // 3) Fork detection — block automatic update if hashes don't match.
  //
  // Two distinct fork classes get different treatment:
  //   - "unknown version" (e.g. 0.0.0-dev): every CLI install before the
  //     bundle-deploy fix shipped an unstamped Worker, so this is almost
  //     always a vanilla install that simply never got version-stamped.
  //     Offer the adoption path (explicit opt-in) instead of a dead end.
  //   - hash mismatch on a KNOWN version: a genuinely modified build.
  //     Never auto-update; point to the manual guide.
  const fork = detectFork(current, manifest);
  if (fork.kind === "fork") {
    if (fork.reason.startsWith("unknown version")) {
      await runAdoption({ repoDir, cfg, manifest, current, subdomainRegisteredNow });
      return;
    }
    p.log.info(pc.yellow(`カスタマイズ版を検出しました (${fork.reason})`));
    p.log.info(
      `カスタマイズされたインストールを上書きしないよう、自動アップデートは適用しません。\nそのままご利用いただけます。更新したい場合は手動アップデートガイドをご覧ください:\n  https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md`,
    );
    p.outro(pc.yellow("自動アップデートをスキップしました (インストールはそのまま動作します)"));
    process.exit(0);
  }

  // Recovery mode intentionally runs before the "already latest" gate. A
  // partial update has already stamped the Worker with the target version,
  // so the ordinary upgrade lookup returns no work even though Admin Pages
  // is still on the previous release.
  if (options.repairAdmin) {
    const release = findReleaseForAdminRepair(manifest.releases, current.version);
    if (!release) {
      p.cancel(
        `現在の Worker v${current.version} に一致する公式リリースが manifest にありません。Admin のみの復旧は安全に実行できません。`,
      );
      process.exit(1);
    }

    p.log.info(
      `復旧モード: Worker / D1 は変更せず、Admin UI v${release.version} のみ再デプロイします。`,
    );
    const creds: CfApiCreds = {
      accountId: cfg.cfAccountId,
      apiToken: cfg.cfApiToken,
    };
    const bundle = await downloadAndVerifyBundle(release, s);
    await deployAdminFromBundle(creds, cfg, bundle, s);
    await configureAdminAuth({
      workerName: cfg.workerName,
      workerUrl: cfg.workerPublicUrl,
      adminUrl: cfg.adminPublicUrl,
    });

    p.outro(pc.green(`Admin UI v${release.version} の復旧が完了しました`));
    return;
  }

  // 4) Find upgrade target
  const upgrade = findLatestUpgrade(manifest, current.version);
  if (!upgrade) {
    if (workerUrlRenamed) {
      // The config now points at the new hostname, but the running
      // Worker's WORKER_PUBLIC_URL binding and the Admin bundle's baked-in
      // API origin still reference the dead one — redeploy the CURRENT
      // release so everything points at the new URL.
      await redeployCurrentBundle({ repoDir, cfg, manifest, current });
      p.outro(
        pc.green(`既に最新版です (v${current.version}) — 新しい Worker URL で再デプロイしました`),
      );
      return;
    }
    p.outro(pc.green(`既に最新版です (v${current.version})`));
    return;
  }

  // 5) min_from_version check
  if (compareSemver(current.version, upgrade.min_from_version) < 0) {
    p.log.error(
      pc.red(
        `min_from_version 違反: v${upgrade.version} は v${upgrade.min_from_version} 以降からのアップグレードが必要です。\n\n先に v${upgrade.min_from_version} にアップデートしてください。`,
      ),
    );
    p.cancel("アップデート中止");
    process.exit(1);
  }

  // 6) Show changelog + confirm
  p.log.info(`変更点: ${upgrade.changelog_url}`);
  const confirm = await p.confirm({
    message: `v${current.version} → v${upgrade.version} にアップデートしますか?`,
    initialValue: true,
  });
  if (p.isCancel(confirm) || !confirm) {
    p.cancel("aborted");
    process.exit(0);
  }

  const creds: CfApiCreds = { accountId: cfg.cfAccountId, apiToken: cfg.cfApiToken };

  // 7) Download + verify bundle
  const bundle = await downloadAndVerifyBundle(upgrade, s);

  // 8) Apply migrations (in manifest order). Duplicate-object errors are
  // benign — CLI installs applied every migration available at install
  // time, so the DB can legitimately be ahead of `upgrade.migrations`.
  applyMigrationsGuard(bundle, upgrade.migrations);
  await applyMigrations({
    creds,
    d1DatabaseId: cfg.d1DatabaseId,
    names: upgrade.migrations,
    bundle,
    s,
  });

  // 9) Worker — preserve existing bindings + assets
  await deployWorkerFromBundle(creds, cfg, bundle, s);

  // 10) Admin Pages — materialize the placeholder API origin first
  await deployAdminFromBundle(creds, cfg, bundle, s);

  // 11) LIFF Pages — only for legacy 3-artifact installs. Worker-assets
  // installs serve the LIFF SPA from the Worker deployed in step 9.
  if (cfg.liffProject) {
    await deployLiffFromBundle(creds, cfg, bundle, s);
  } else {
    p.log.info("LIFF は Worker アセット配信のためスキップ（Worker 更新に含まれています）");
  }

  // 12) Ensure cookie-based admin auth is configured. Installs created before
  // this version never set ADMIN_ORIGIN / ADMIN_ALLOW_CROSS_SITE, so the new
  // cross-site cookie auth would otherwise break their admin login on upgrade.
  await configureAdminAuth({
    workerName: cfg.workerName,
    workerUrl: cfg.workerPublicUrl,
    adminUrl: cfg.adminPublicUrl,
  });

  // 13) Health check (non-fatal)
  await checkWorkerHealth(
    cfg.workerPublicUrl,
    s,
    subdomainRegisteredNow
      ? "アップデート自体は完了しています。workers.dev サブドメイン登録直後は DNS 反映に数分かかるため、数分待ってから同じコマンドを再実行してください"
      : "アップデート自体は完了しています",
  );

  // 14) Refresh the local release artifact + record bundle mode so a later
  // manual `wrangler deploy` from the clone re-deploys THIS version instead
  // of silently downgrading to whatever was on disk. Best-effort.
  writeLocalWorkerArtifact(repoDir, bundle);
  persistBundleMode(repoDir, upgrade.version);

  p.outro(pc.green(`🎉 v${upgrade.version} にアップデート完了`));
}

/** Pick the artifact matching the live Worker; never deploy a newer Admin. */
export function findReleaseForAdminRepair(
  releases: ReleaseEntry[],
  currentVersion: string,
): ReleaseEntry | undefined {
  return releases.find((release) => release.version === currentVersion);
}

// ─── Shared deploy steps (normal update + adoption) ──────────────────────────

type Spinner = ReturnType<typeof p.spinner>;

/**
 * Post-deploy liveness check (non-fatal — the deploy already succeeded).
 *
 * Probes `/api/health` and treats ANY response below 500 as alive: worker
 * bundles released before the public health route existed answer 401
 * (auth middleware) or 404, and a Worker that routes a request to either
 * has provably booted. Only network errors and 5xx are reported, with
 * `doneNote` clarifying that the update itself still completed.
 */
export async function checkWorkerHealth(
  workerPublicUrl: string,
  s: Spinner,
  doneNote: string,
): Promise<void> {
  s.start("Health チェック中");
  try {
    const hRes = await fetch(
      `${workerPublicUrl.replace(/\/$/, "")}/api/health`,
    );
    if (hRes.status >= 500) throw new Error(`HTTP ${hRes.status}`);
    s.stop("Health OK");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.yellow(`Health 確認失敗: ${msg} (${doneNote})`));
  }
}

/**
 * Pre-download gate: releases without `worker_bundle_hash` shipped a broken
 * worker artifact (re-export stub) and can never be deployed from. Exits
 * with actionable guidance instead of failing mid-flow.
 */
function assertReleaseDeployable(release: ReleaseEntry): void {
  if (release.worker_bundle_hash) return;
  p.log.error(
    [
      `リリース v${release.version} はこのアップデーターに対応していません`,
      "（bundle にデプロイ可能な Worker が含まれていない旧形式のリリースです）。",
      "対応済みリリースの公開をお待ちください。",
    ].join("\n"),
  );
  p.cancel("アップデート中止（インストールはそのまま動作します）");
  process.exit(1);
}

async function downloadAndVerifyBundle(
  release: ReleaseEntry,
  s: Spinner,
): Promise<ParsedBundle> {
  assertReleaseDeployable(release);
  s.start(
    `Bundle ダウンロード中 (${(release.bundle_size_bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  try {
    const bRes = await fetch(release.bundle_url);
    if (!bRes.ok) throw new Error(`bundle fetch HTTP ${bRes.status}`);
    if (!bRes.body) throw new Error("bundle response has no body");
    const bundle = await parseBundleStream(
      Readable.fromWeb(bRes.body as Parameters<typeof Readable.fromWeb>[0]),
    );
    const hashes = verifyBundleHashes(bundle);
    verifyBundleIntegrity(hashes, release);
    s.stop("Bundle 取得 + ハッシュ検証 OK");
    return bundle;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Bundle 検証失敗: ${msg}`));
    p.cancel("bundle が壊れているか、改ざんされている可能性があります。");
    process.exit(1);
  }
}

/** Fail fast (before any D1 write) if a listed migration is absent from the bundle. */
function applyMigrationsGuard(bundle: ParsedBundle, names: string[]): void {
  for (const name of names) {
    if (!bundle.migrations.has(name)) {
      p.cancel(`migration ${name} が bundle にありません`);
      process.exit(1);
    }
  }
}

/**
 * Apply migrations one file at a time, in the given order.
 *
 * Duplicate-object errors ("already exists" / "duplicate column") are benign
 * and logged as skips: migrations are additive-only + INSERT OR IGNORE by
 * repo policy (scripts/check-migrations.ts), and CLI installs apply every
 * migration shipped at install time, so re-encountering one is expected.
 * Any other error aborts BEFORE the Worker/Pages deploys run.
 */
async function applyMigrations(opts: {
  creds: CfApiCreds;
  d1DatabaseId: string;
  names: string[];
  bundle: ParsedBundle;
  s: Spinner;
}): Promise<void> {
  const { creds, d1DatabaseId, names, bundle, s } = opts;
  for (const name of names) {
    const sql = bundle.migrations.get(name);
    if (!sql) {
      p.cancel(`migration ${name} が bundle にありません`);
      process.exit(1);
    }
    s.start(`Migration ${name} 実行中`);
    try {
      await executeD1Query({
        creds,
        databaseId: d1DatabaseId,
        sql: sql.toString("utf-8"),
      });
      s.stop(`Migration ${name} 完了`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (isBenignSchemaErrorText(msg)) {
        s.stop(pc.dim(`Migration ${name}: 適用済みのためスキップ`));
        continue;
      }
      s.stop(pc.red(`Migration ${name} 失敗: ${msg}`));
      p.cancel(
        "先に手動で migration を確認してください。Worker/Pages はまだ更新されていません。",
      );
      process.exit(1);
    }
  }
}

/**
 * Correct install-topology plain-text bindings to match the resolved config
 * before re-uploading them:
 *   - LIFF_PAGES_PROJECT: installs created before the worker-assets fix were
 *     deployed with `LIFF_PAGES_PROJECT=<worker>-liff` even though that Pages
 *     project never existed; re-uploading the binding verbatim would keep the
 *     worker-side self-update pointed at the missing project instead of
 *     taking the worker-assets skip path.
 *   - WORKER_PUBLIC_URL: when the workers.dev subdomain was re-registered
 *     under a new name this run, the deployed binding still carries the dead
 *     hostname — the worker-side self-update health check would probe a URL
 *     that never resolves again.
 */
export function normalizeInstallBindings(
  bindings: WorkerBinding[],
  opts: { liffProject: string; workerPublicUrl: string },
): WorkerBinding[] {
  return bindings.map((b) => {
    if (b.type !== "plain_text") return b;
    if (b.name === "LIFF_PAGES_PROJECT") return { ...b, text: opts.liffProject };
    if (b.name === "WORKER_PUBLIC_URL") return { ...b, text: opts.workerPublicUrl };
    return b;
  });
}

async function deployWorkerFromBundle(
  creds: CfApiCreds,
  cfg: ResolvedUpdateConfig,
  bundle: ParsedBundle,
  s: Spinner,
): Promise<void> {
  s.start("Worker デプロイ中");
  try {
    const bindings = await listWorkerBindings({
      creds,
      scriptName: cfg.workerName,
    });
    await putWorkerScript({
      creds,
      scriptName: cfg.workerName,
      scriptContent: bundle.workerJs,
      bindings: normalizeInstallBindings(bindings, {
        liffProject: cfg.liffProject,
        workerPublicUrl: cfg.workerPublicUrl,
      }),
      compatibilityFlags: WORKER_COMPATIBILITY_FLAGS,
      // Bundle carries no Worker assets — keep the ones deployed at setup
      // (they serve the LIFF SPA on worker-assets installs).
      keepAssets: true,
    });
    s.stop("Worker デプロイ完了");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Worker デプロイ失敗: ${msg}`));
    p.cancel(
      "migration は適用されています。手動で Worker を rollback してください。",
    );
    process.exit(1);
  }
}

async function deployAdminFromBundle(
  creds: CfApiCreds,
  cfg: ResolvedUpdateConfig,
  bundle: ParsedBundle,
  s: Spinner,
): Promise<void> {
  s.start("Admin Pages デプロイ中");
  try {
    // The release admin build points at https://__LH_WORKER_URL__ —
    // rewrite it to this install's Worker before uploading.
    const files = materializeAdminFiles(bundle.adminFiles, cfg.workerPublicUrl);
    const residual = findResidualPlaceholders(files);
    const r = await deployPagesProject({
      creds,
      projectName: cfg.adminProject,
      files,
    });
    s.stop(`Admin デプロイ完了 (${r.deploymentId.slice(0, 8)})`);
    if (residual.length > 0) {
      p.log.warn(
        `未知のプレースホルダーが残っています（動作に影響する可能性）: ${residual.slice(0, 5).join(", ")}${residual.length > 5 ? " …" : ""}`,
      );
    }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Admin デプロイ失敗: ${msg}`));
    p.cancel(
      "Worker は新バージョンが動いていますが、Admin は前バージョンのままです。",
    );
    process.exit(1);
  }
}

async function deployLiffFromBundle(
  creds: CfApiCreds,
  cfg: ResolvedUpdateConfig,
  bundle: ParsedBundle,
  s: Spinner,
): Promise<void> {
  s.start("LIFF Pages デプロイ中");
  try {
    const r = await deployPagesProject({
      creds,
      projectName: cfg.liffProject,
      files: bundle.liffFiles,
    });
    s.stop(`LIFF デプロイ完了 (${r.deploymentId.slice(0, 8)})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`LIFF デプロイ失敗: ${msg}`));
    p.cancel(
      "Worker + Admin は新バージョンですが、LIFF は前バージョンのままです。",
    );
    process.exit(1);
  }
}

/**
 * Write the deployed Worker bundle to the local clone's release-artifact
 * path (`apps/worker/dist/release/index.js`) — the path the generated
 * wrangler.toml points at. Keeps a later manual `wrangler deploy` from
 * downgrading/unstamping the install. Best-effort: `repoDir` may be a bare
 * config directory (no clone), in which case this is a silent no-op.
 */
function writeLocalWorkerArtifact(repoDir: string, bundle: ParsedBundle): void {
  const workerDir = join(repoDir, "apps/worker");
  if (!existsSync(workerDir)) return;
  try {
    const artifactPath = join(workerDir, "dist/release/index.js");
    mkdirSync(dirname(artifactPath), { recursive: true });
    writeFileSync(artifactPath, bundle.workerJs);
  } catch {
    // Non-critical — the next update/setup run rewrites it.
  }
}

/**
 * After a successful bundle deploy (update or adoption), record the install
 * as bundle-mode: `.line-harness-config.json` gains
 * `workerDeployMode: "bundle"` + `installedVersion`, and the clone's
 * generated wrangler.toml is re-rendered so `main` points at the release
 * artifact. Without this, an adopted source-mode install would keep
 * `main = "src/index.ts"` and a later manual `wrangler deploy` would
 * redeploy an unstamped source build, undoing the adoption. Best-effort.
 */
function persistBundleMode(repoDir: string, version: string): void {
  const configPath = join(repoDir, ".line-harness-config.json");
  if (!existsSync(configPath)) return;
  try {
    const config = JSON.parse(
      readFileSync(configPath, "utf-8"),
    ) as SavedInstallConfig & Record<string, unknown>;
    config.workerDeployMode = "bundle";
    config.installedVersion = version;
    writeFileSync(configPath, JSON.stringify(config, null, 2) + "\n");

    // Re-render the clone's wrangler.toml only when it is CLI-generated
    // (or absent) — never clobber a hand-edited config.
    const workerDir = join(repoDir, "apps/worker");
    const tomlPath = join(workerDir, "wrangler.toml");
    if (!existsSync(workerDir)) return;
    if (
      existsSync(tomlPath) &&
      !isGeneratedInstalledWranglerToml(readFileSync(tomlPath, "utf-8"))
    ) {
      return;
    }
    const resolved = resolveInstalledWranglerConfig(config);
    if (resolved) {
      writeFileSync(tomlPath, renderInstalledWranglerToml(resolved));
    }
  } catch {
    // Non-critical — setup/update reruns repair it.
  }
}

/**
 * Same-version redeploy after a workers.dev subdomain rename with no
 * pending upgrade: the deployed Admin bundle bakes in the Worker origin and
 * the Worker carries a WORKER_PUBLIC_URL binding, so the URL change still
 * needs the CURRENT release redeployed to point everything at the new
 * hostname. No migrations run (same version, DB untouched).
 */
async function redeployCurrentBundle(opts: {
  repoDir: string;
  cfg: ResolvedUpdateConfig;
  manifest: Awaited<ReturnType<typeof fetchManifest>>;
  current: CurrentVersion;
}): Promise<void> {
  const { repoDir, cfg, manifest, current } = opts;

  const release = manifest.releases.find((r) => r.version === current.version);
  if (!release || !release.worker_bundle_hash) {
    p.log.warn(
      [
        `現行バージョン v${current.version} の再デプロイ可能なリリースが見つからないため、`,
        "Worker 内部と管理画面には旧 URL が残っている可能性があります。",
        "次回のアップデート適用時に新 URL で自動的に再デプロイされます。",
      ].join("\n"),
    );
    return;
  }

  const creds: CfApiCreds = { accountId: cfg.cfAccountId, apiToken: cfg.cfApiToken };
  const s = p.spinner();
  const bundle = await downloadAndVerifyBundle(release, s);

  await deployWorkerFromBundle(creds, cfg, bundle, s);
  await deployAdminFromBundle(creds, cfg, bundle, s);
  if (cfg.liffProject) {
    await deployLiffFromBundle(creds, cfg, bundle, s);
  }

  // Re-point the cookie-auth CORS allowlist / origins at the new Worker URL.
  await configureAdminAuth({
    workerName: cfg.workerName,
    workerUrl: cfg.workerPublicUrl,
    adminUrl: cfg.adminPublicUrl,
  });

  await checkWorkerHealth(
    cfg.workerPublicUrl,
    s,
    "再デプロイ自体は完了しています。workers.dev サブドメイン登録直後は DNS 反映に数分かかるため、数分待ってから同じコマンドを再実行してください",
  );

  writeLocalWorkerArtifact(repoDir, bundle);
  persistBundleMode(repoDir, current.version);
}

// ─── Adoption path (unstamped CLI installs) ──────────────────────────────────

/**
 * Adopt an unstamped install (`/admin/version` reports a version the
 * manifest doesn't know — 0.0.0-dev for every pre-fix CLI install) onto the
 * latest official release so future updates work normally.
 *
 * Differences from a normal update:
 *   - Explicit opt-in prompt (default: No) — a genuinely customized source
 *     build would be overwritten by this operation.
 *   - Applies ALL migrations in the bundle (benign-swallowed) instead of a
 *     manifest diff: with an unknown starting version there is no reliable
 *     "already applied" set, and re-application is safe by repo policy.
 *   - Skips the min_from_version gate — it is meaningless for an unknown
 *     starting version, and full-migration replay is the compensating
 *     control.
 */
async function runAdoption(opts: {
  repoDir: string;
  cfg: ResolvedUpdateConfig;
  manifest: Awaited<ReturnType<typeof fetchManifest>>;
  current: CurrentVersion;
  /** True when runUpdate registered a workers.dev subdomain this run. */
  subdomainRegisteredNow: boolean;
}): Promise<void> {
  const { repoDir, cfg, manifest, current, subdomainRegisteredNow } = opts;

  const target = manifest.releases.find((r) => r.version === manifest.latest);
  if (!target) {
    p.cancel(
      `manifest が壊れています (latest=${manifest.latest} が releases にありません)`,
    );
    process.exit(1);
  }

  p.log.warn(
    [
      `バージョン未スタンプのインストールを検出しました (現在: v${current.version})。`,
      "旧バージョンの CLI でセットアップした環境は、公式リリースと同一でもバージョン情報が",
      "埋め込まれておらず、自動アップデートが適用できない状態です。",
      "",
      `公式リリース v${target.version} を導入すると、以後の自動アップデートが使えるようになります。`,
      "",
      pc.bold("注意: Worker / 管理画面をソースコードレベルでカスタマイズしている場合、"),
      pc.bold("この操作でカスタマイズは上書きされ失われます。"),
      "（管理画面上の設定・DB データ・シークレットはそのまま残ります）",
    ].join("\n"),
  );

  const confirm = await p.confirm({
    message: `公式リリース v${target.version} を導入しますか?`,
    initialValue: false,
  });
  if (p.isCancel(confirm) || !confirm) {
    p.log.info(
      `そのままご利用いただけます。手動での更新手順:\n  https://github.com/Shudesu/line-harness-oss/blob/main/docs/wiki/26-Manual-Update.md`,
    );
    p.outro(pc.yellow("導入をスキップしました (インストールはそのまま動作します)"));
    process.exit(0);
  }

  const creds: CfApiCreds = { accountId: cfg.cfAccountId, apiToken: cfg.cfApiToken };
  const s = p.spinner();

  const bundle = await downloadAndVerifyBundle(target, s);

  // Replay every migration in the bundle, oldest first. Duplicates are
  // skipped via the benign-error policy inside applyMigrations.
  const allMigrations = Array.from(bundle.migrations.keys()).sort();
  p.log.info(
    `全 ${allMigrations.length} migration を確認します（適用済みはスキップされます）`,
  );
  await applyMigrations({
    creds,
    d1DatabaseId: cfg.d1DatabaseId,
    names: allMigrations,
    bundle,
    s,
  });

  await deployWorkerFromBundle(creds, cfg, bundle, s);
  await deployAdminFromBundle(creds, cfg, bundle, s);
  if (cfg.liffProject) {
    await deployLiffFromBundle(creds, cfg, bundle, s);
  } else {
    p.log.info("LIFF は Worker アセット配信のためスキップ（Worker 更新に含まれています）");
  }

  // Older installs may pre-date cookie-based admin auth — same step the
  // normal update path runs.
  await configureAdminAuth({
    workerName: cfg.workerName,
    workerUrl: cfg.workerPublicUrl,
    adminUrl: cfg.adminPublicUrl,
  });

  await checkWorkerHealth(
    cfg.workerPublicUrl,
    s,
    subdomainRegisteredNow
      ? "導入自体は完了しています。workers.dev サブドメイン登録直後は DNS 反映に数分かかるため、数分待ってから同じコマンドを再実行してください"
      : "導入自体は完了しています",
  );

  writeLocalWorkerArtifact(repoDir, bundle);
  persistBundleMode(repoDir, target.version);

  p.outro(
    pc.green(
      `🎉 v${target.version} を導入しました — 以後 \`npx create-line-harness update\` で自動アップデートできます`,
    ),
  );
}
