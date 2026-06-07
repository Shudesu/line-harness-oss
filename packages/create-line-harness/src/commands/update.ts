import * as p from "@clack/prompts";
import pc from "picocolors";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  fetchManifest,
  detectFork,
  findLatestUpgrade,
  compareSemver,
  parseBundleStream,
  verifyBundleHashes,
  assertHashesMatch,
  executeD1Query,
  putWorkerScript,
  listWorkerBindings,
  deployPagesProject,
  type CurrentVersion,
} from "@line-harness/update-engine";
import { configureAdminAuth } from "../steps/admin-auth.js";

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
 * Normalize the on-disk config into the strict shape the update flow needs.
 *
 * Two layers of fallback:
 *   - `cfAccountId` may be stored as legacy `accountId`.
 *   - `workerPublicUrl` may be derivable from legacy `workerUrl`.
 *   - `adminProject` may be derivable from legacy `adminUrl` hostname.
 *
 * Returns `null` (with diagnostic message via caller) if a non-recoverable
 * field is missing. We never *guess* the API token — that has to be supplied
 * via env var if absent from config.
 */
function resolveState(
  state: SetupState,
  envApiToken: string | undefined,
): {
  ok: true;
  value: Required<
    Pick<
      SetupState,
      | "workerName"
      | "adminProject"
      | "liffProject"
      | "d1DatabaseId"
      | "cfAccountId"
      | "cfApiToken"
      | "manifestUrl"
      | "workerPublicUrl"
      | "adminPublicUrl"
      | "liffPublicUrl"
    >
  >;
} | { ok: false; missing: string[] } {
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

  // No legacy field for liffProject — must be present or prompt later.
  if (!state.liffProject) missing.push("liffProject");

  // Worker public URL — prefer explicit, else legacy workerUrl.
  const workerPublicUrl = state.workerPublicUrl ?? state.workerUrl;
  if (!workerPublicUrl) missing.push("workerPublicUrl");

  const adminPublicUrl = state.adminPublicUrl ?? state.adminUrl;
  if (!adminPublicUrl) missing.push("adminPublicUrl");

  // No legacy field for liffPublicUrl; require explicit value.
  if (!state.liffPublicUrl) missing.push("liffPublicUrl");

  if (missing.length > 0) {
    return { ok: false, missing };
  }

  return {
    ok: true,
    value: {
      workerName: workerName!,
      adminProject: adminProject!,
      liffProject: state.liffProject!,
      d1DatabaseId: state.d1DatabaseId!,
      cfAccountId: cfAccountId!,
      cfApiToken: cfApiToken!,
      manifestUrl: state.manifestUrl ?? DEFAULT_MANIFEST_URL,
      workerPublicUrl: workerPublicUrl!,
      adminPublicUrl: adminPublicUrl!,
      liffPublicUrl: state.liffPublicUrl!,
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
            "LIFF Pages プロジェクト名 (例: lh-liff-abc123 — CF ダッシュボードで確認)",
          validate(value) {
            if (!value) return "必須";
            if (!/^[a-z0-9][a-z0-9-]*$/i.test(value.trim())) {
              return "英数字とハイフンのみ";
            }
          },
        });
        if (p.isCancel(v)) {
          p.cancel("aborted");
          process.exit(0);
        }
        updated.liffProject = (v as string).trim();
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

export async function runUpdate(repoDir: string): Promise<void> {
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
    p.cancel("Worker が応答していません。デプロイ状態を確認してください。");
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

  // 3) Fork detection — block automatic update if hashes don't match
  const fork = detectFork(current, manifest);
  if (fork.kind === "fork") {
    p.log.warn(pc.yellow(`改造を検知: ${fork.reason}`));
    p.log.info(
      `自動アップデートは無効化されます。\n手動更新手順は wiki を参照してください:\n  https://theharness.com/wiki/updates/manual`,
    );
    p.outro(pc.yellow("自動アップデートをスキップしました"));
    process.exit(0);
  }

  // 4) Find upgrade target
  const upgrade = findLatestUpgrade(manifest, current.version);
  if (!upgrade) {
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

  const creds = { accountId: cfg.cfAccountId, apiToken: cfg.cfApiToken };

  // 7) Download + verify bundle
  s.start(
    `Bundle ダウンロード中 (${(upgrade.bundle_size_bytes / 1024 / 1024).toFixed(1)} MB)`,
  );
  let bundle;
  try {
    const bRes = await fetch(upgrade.bundle_url);
    if (!bRes.ok) throw new Error(`bundle fetch HTTP ${bRes.status}`);
    if (!bRes.body) throw new Error("bundle response has no body");
    bundle = await parseBundleStream(
      Readable.fromWeb(bRes.body as Parameters<typeof Readable.fromWeb>[0]),
    );
    const hashes = verifyBundleHashes(bundle);
    assertHashesMatch(hashes, upgrade);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Bundle 検証失敗: ${msg}`));
    p.cancel("bundle が壊れているか、改ざんされている可能性があります。");
    process.exit(1);
  }
  s.stop("Bundle 取得 + ハッシュ検証 OK");

  // 8) Apply migrations (in manifest order)
  for (const name of upgrade.migrations) {
    const sql = bundle.migrations.get(name);
    if (!sql) {
      p.cancel(`migration ${name} が bundle にありません`);
      process.exit(1);
    }
    s.start(`Migration ${name} 実行中`);
    try {
      await executeD1Query({
        creds,
        databaseId: cfg.d1DatabaseId,
        sql: sql.toString("utf-8"),
      });
      s.stop(`Migration ${name} 完了`);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      s.stop(pc.red(`Migration ${name} 失敗: ${msg}`));
      p.cancel(
        "先に手動で migration を確認してください。Worker/Pages はまだ更新されていません。",
      );
      process.exit(1);
    }
  }

  // 9) Worker — preserve existing bindings
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
      bindings,
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

  // 10) Admin Pages
  s.start("Admin Pages デプロイ中");
  try {
    const r = await deployPagesProject({
      creds,
      projectName: cfg.adminProject,
      files: bundle.adminFiles,
    });
    s.stop(`Admin デプロイ完了 (${r.deploymentId.slice(0, 8)})`);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(pc.red(`Admin デプロイ失敗: ${msg}`));
    p.cancel(
      "Worker は新バージョンが動いていますが、Admin は前バージョンのままです。",
    );
    process.exit(1);
  }

  // 11) LIFF Pages
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

  // 12) Ensure cookie-based admin auth is configured. Installs created before
  // this version never set ADMIN_ORIGIN / ADMIN_ALLOW_CROSS_SITE, so the new
  // cross-site cookie auth would otherwise break their admin login on upgrade.
  await configureAdminAuth({
    workerName: cfg.workerName,
    workerUrl: cfg.workerPublicUrl,
    adminUrl: cfg.adminPublicUrl,
  });

  // 13) Health check (non-fatal)
  s.start("Health チェック中");
  try {
    const hRes = await fetch(
      `${cfg.workerPublicUrl.replace(/\/$/, "")}/health`,
    );
    if (!hRes.ok) throw new Error(`HTTP ${hRes.status}`);
    s.stop("Health OK");
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    s.stop(
      pc.yellow(
        `Health 確認失敗: ${msg} (アップデート自体は完了しています)`,
      ),
    );
  }

  p.outro(pc.green(`🎉 v${upgrade.version} にアップデート完了`));
}
