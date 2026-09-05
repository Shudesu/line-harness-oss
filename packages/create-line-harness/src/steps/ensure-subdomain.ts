import * as p from "@clack/prompts";
import pc from "picocolors";
import {
  getWorkersSubdomain,
  putWorkersSubdomain,
  SubdomainConflictError,
  type CfApiCreds,
} from "@line-harness/update-engine";
import { readWranglerOAuthToken } from "../lib/wrangler-oauth.js";
import {
  isValidSubdomainName,
  sanitizeSubdomainCandidate,
} from "../lib/subdomain-name.js";

/**
 * Make sure the Cloudflare account has a workers.dev subdomain BEFORE the
 * Worker deploy runs. Accounts that never deployed a Worker don't have one,
 * and `wrangler deploy` then fails with "You need to register a workers.dev
 * subdomain before publishing to workers.dev" — a dead end when wrangler
 * runs non-interactively (community users ended up re-running the same
 * command in a loop).
 *
 * Uses the same REST endpoints wrangler's own interactive prompt calls
 * (GET/PUT accounts/{account_id}/workers/subdomain), authenticated with
 * either a caller-supplied API token (update flow) or wrangler's OAuth
 * token from `wrangler login` (setup flow).
 */

export interface EnsureSubdomainOptions {
  accountId: string;
  /** Source string for the suggested subdomain name (e.g. project name). */
  defaultName: string;
  /**
   * CF API token to use (update flow). When absent, falls back to
   * CLOUDFLARE_API_TOKEN and then wrangler's own OAuth token.
   */
  apiToken?: string;
}

export interface EnsureSubdomainResult {
  /**
   * True when a subdomain was registered during THIS run — callers add
   * "DNS propagation takes a few minutes" guidance to any immediately
   * following health check failure.
   */
  registeredNow: boolean;
  /**
   * The account's current subdomain when known (pre-existing or just
   * registered); null when it could not be determined. The update flow
   * compares this against the hostname in the saved Worker URL and
   * rewrites the URL when the user registered a different name.
   */
  subdomain: string | null;
}

function onboardingUrl(accountId: string): string {
  return `https://dash.cloudflare.com/${accountId}/workers/onboarding`;
}

/** DNS-propagation note shown right after a successful registration. */
function dnsPropagationNote(): string {
  return [
    "登録直後は DNS 反映に数分かかることがあります。",
    "この後のデプロイ確認やヘルスチェックが失敗した場合は、数分待ってから",
    "同じコマンドを再実行してください（続きから再開されます）。",
  ].join("\n");
}

function manualRegistrationGuide(accountId: string): string {
  return [
    "CLI からの自動登録ができなかったため、ブラウザで手動登録してください:",
    "",
    `  1. ${pc.cyan(onboardingUrl(accountId))} を開く`,
    "  2. 「サブドメインの登録」（Register subdomain）で好きな名前を入力して登録",
    "     （この名前はアカウント共通で、URL の一部になります）",
  ].join("\n");
}

async function promptSubdomainName(defaultCandidate: string | null): Promise<string> {
  const name = await p.text({
    message:
      "workers.dev サブドメイン名（Worker の URL が https://<Worker名>.<この名前>.workers.dev になります）",
    placeholder: defaultCandidate ?? undefined,
    defaultValue: defaultCandidate ?? undefined,
    validate(value) {
      const v = (value || defaultCandidate || "").trim();
      if (!isValidSubdomainName(v)) {
        return "英小文字・数字・ハイフンのみ、63文字以内、先頭と末尾は英数字にしてください";
      }
    },
  });
  if (p.isCancel(name)) {
    p.cancel("セットアップをキャンセルしました");
    process.exit(0);
  }
  return ((name as string) || defaultCandidate || "").trim();
}

/**
 * Interactive registration loop: prompt a name → PUT → on conflict re-prompt.
 * Returns the registered name, or null when the caller should fall back to
 * the manual (dashboard) path.
 */
async function registerInteractively(
  creds: CfApiCreds,
  defaultName: string,
): Promise<string | null> {
  let candidate = sanitizeSubdomainCandidate(defaultName);
  for (;;) {
    const name = await promptSubdomainName(candidate);
    // The suggested name conflicted once — don't suggest it again.
    candidate = null;

    const s = p.spinner();
    s.start(`workers.dev サブドメイン "${name}" を登録中...`);
    try {
      await putWorkersSubdomain({ creds, subdomain: name });
      s.stop(`workers.dev サブドメイン登録完了: ${name}.workers.dev`);
      p.log.info(dnsPropagationNote());
      return name;
    } catch (error) {
      if (error instanceof SubdomainConflictError) {
        s.stop(pc.yellow(`"${name}" は既に使われています`));
        p.log.warn(
          "workers.dev サブドメインは全世界で早い者勝ちです。別の名前を入力してください。",
        );
        continue;
      }
      const msg = error instanceof Error ? error.message : String(error);
      s.stop(pc.yellow(`自動登録に失敗しました: ${msg}`));
      return null;
    }
  }
}

/**
 * Manual fallback: show the dashboard guide, then poll the GET endpoint
 * each time the user says they're done. The user can also choose to
 * continue without verification (the deploy will surface the truth).
 * Returns the verified name, or null when the user skipped verification.
 */
async function registerManually(creds: CfApiCreds): Promise<string | null> {
  p.log.warn(manualRegistrationGuide(creds.accountId));

  for (;;) {
    const choice = await p.select({
      message: "ダッシュボードでの登録が終わったら「確認する」を選んでください",
      options: [
        { value: "check", label: "確認する（登録済みかチェックします）" },
        { value: "continue", label: "確認せずに続行する（未登録だとデプロイに失敗します）" },
      ],
    });
    if (p.isCancel(choice)) {
      p.cancel("セットアップをキャンセルしました");
      process.exit(0);
    }
    if (choice === "continue") {
      return null;
    }

    const s = p.spinner();
    s.start("登録状態を確認中...");
    try {
      const subdomain = await getWorkersSubdomain({ creds });
      if (subdomain) {
        s.stop(`workers.dev サブドメイン確認完了: ${subdomain}.workers.dev`);
        p.log.info(dnsPropagationNote());
        return subdomain;
      }
      s.stop(pc.yellow("まだ登録が確認できません"));
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      s.stop(pc.yellow(`確認に失敗しました: ${msg}`));
    }
  }
}

export async function ensureWorkersDevSubdomain(
  options: EnsureSubdomainOptions,
): Promise<EnsureSubdomainResult> {
  const apiToken =
    options.apiToken ??
    process.env.CLOUDFLARE_API_TOKEN ??
    readWranglerOAuthToken() ??
    undefined;

  if (!apiToken) {
    // Can't pre-check (no readable credential). Not fatal: wrangler deploy
    // runs next with its own auth, and its error path points back here.
    return { registeredNow: false, subdomain: null };
  }

  const creds: CfApiCreds = { accountId: options.accountId, apiToken };

  const s = p.spinner();
  s.start("workers.dev サブドメイン確認中...");
  let existing: string | null;
  try {
    existing = await getWorkersSubdomain({ creds });
  } catch {
    // Auth scope/network issues etc. — the account may well have a
    // subdomain, so don't drag the user into registration. Proceed and let
    // the deploy tell the truth.
    s.stop("workers.dev サブドメイン確認をスキップ（状態を取得できませんでした）");
    return { registeredNow: false, subdomain: null };
  }

  if (existing) {
    s.stop(`workers.dev サブドメイン: ${existing}.workers.dev`);
    return { registeredNow: false, subdomain: existing };
  }

  s.stop(pc.yellow("workers.dev サブドメインが未登録です"));
  p.log.info(
    [
      "この Cloudflare アカウントにはまだ workers.dev サブドメインがありません。",
      "Worker を公開するために必要なので、ここで登録します（無料・1アカウント1回だけ）。",
    ].join("\n"),
  );

  const registeredName = await registerInteractively(creds, options.defaultName);
  if (registeredName) {
    return { registeredNow: true, subdomain: registeredName };
  }

  const manualName = await registerManually(creds);
  return { registeredNow: manualName !== null, subdomain: manualName };
}
