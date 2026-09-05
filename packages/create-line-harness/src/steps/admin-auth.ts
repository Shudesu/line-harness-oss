import * as p from "@clack/prompts";
import { wrangler } from "../lib/wrangler.js";

interface AdminAuthOptions {
  workerName: string;
  /** Optional: the Worker can fall back to the request origin if unset. */
  workerUrl?: string;
  adminUrl: string;
}

/**
 * Configure the Worker for cookie-based admin auth.
 *
 * The default topology puts the admin on `*.pages.dev` and the API on
 * `*.workers.dev` — these are cross-site, so the session cookie must be
 * SameSite=None; Secure and the admin origin must be on the CORS allowlist.
 * This sets the env the Worker reads (see apps/worker/src/middleware/
 * admin-auth-config.ts):
 *
 *   - ADMIN_ORIGIN          = the admin Pages URL (credentialed CORS allowlist)
 *   - ADMIN_ALLOW_CROSS_SITE= true (opt into SameSite=None cookies)
 *   - WORKER_URL            = the Worker URL (used for cross-site detection)
 */
export async function configureAdminAuth(options: AdminAuthOptions): Promise<void> {
  const s = p.spinner();
  s.start("管理画面の認証設定中...");

  const secrets: Record<string, string> = {
    ADMIN_ORIGIN: options.adminUrl,
    ADMIN_ALLOW_CROSS_SITE: "true",
  };
  if (options.workerUrl) {
    secrets.WORKER_URL = options.workerUrl;
  }

  const jsonPayload = JSON.stringify(secrets);
  try {
    await wrangler(["secret", "bulk", "--name", options.workerName], {
      input: jsonPayload,
    });
  } catch {
    for (const [name, value] of Object.entries(secrets)) {
      await wrangler(["versions", "secret", "put", name, "--name", options.workerName], {
        input: value,
      });
    }
    await wrangler(["versions", "deploy", "--name", options.workerName, "--yes"]);
  }

  // Verify the secrets actually landed on the deployed Worker. The bulk /
  // versions path can silently no-op in some auth states, and a setup that
  // aborted earlier (e.g. the Worker-deploy failure fixed in
  // create-line-harness@0.1.27, issue #177) never reaches this step at all — in
  // both cases the Worker is left without ADMIN_ORIGIN and admin login then
  // fails with an opaque CORS error (issue #179). Surface it now, at setup time,
  // instead of leaving the operator to debug a browser CORS block.
  const missing = await findMissingAdminAuthSecrets(options.workerName);

  s.stop("管理画面の認証設定完了");

  if (missing.length > 0) {
    p.log.warn(
      `管理画面の認証用シークレット (${missing.join(", ")}) が Worker "${options.workerName}" に見つかりませんでした。\n` +
        `このままでは管理画面ログインが CORS エラーで失敗します (issue #179)。以下で設定してください:\n` +
        missing
          .map((name) => {
            const value = name === "ADMIN_ORIGIN" ? options.adminUrl : "true";
            return `  printf '%s' '${value}' | npx wrangler secret put ${name} --name ${options.workerName}`;
          })
          .join("\n") +
        `\n※ 複数の Cloudflare アカウントを使っている場合は npx wrangler whoami で対象アカウントを確認してください。` +
        `\n詳細: docs/ADMIN-AUTH.md`,
    );
  }
}

export const REQUIRED_ADMIN_AUTH_SECRETS = ["ADMIN_ORIGIN", "ADMIN_ALLOW_CROSS_SITE"];

/**
 * Parse `wrangler secret list --format json` output and return which required
 * admin-auth secrets are absent. Pure and exported so it can be unit-tested.
 *
 * Tolerant of leading noise (a banner or npx chatter before the JSON array) and
 * of any unparsable input: returns `[]` ("assume fine") on failure so a garbled
 * secret list never produces a false "missing" report.
 */
export function findMissingRequiredSecrets(rawSecretListJson: string): string[] {
  // Extract from the first '[' so a stray banner line before the JSON array
  // does not defeat the parse.
  const start = rawSecretListJson.indexOf("[");
  if (start === -1) return [];

  let names: Set<string>;
  try {
    const parsed = JSON.parse(rawSecretListJson.slice(start)) as Array<{ name?: string }>;
    if (!Array.isArray(parsed)) return [];
    names = new Set(
      parsed.map((entry) => entry?.name).filter((name): name is string => Boolean(name)),
    );
  } catch {
    return [];
  }

  return REQUIRED_ADMIN_AUTH_SECRETS.filter((name) => !names.has(name));
}

/**
 * Return which required admin-auth secrets are absent from the deployed Worker.
 *
 * Best-effort by design: returns `[]` ("assume fine") whenever the secret list
 * cannot be read, so a transient verification failure never blocks setup with a
 * false negative. We only report a secret as missing when the list was read
 * successfully and the name is genuinely absent.
 */
async function findMissingAdminAuthSecrets(workerName: string): Promise<string[]> {
  let raw: string;
  try {
    // `--format json` is the default on current wrangler but is passed
    // explicitly so the parse stays stable across versions.
    raw = await wrangler(["secret", "list", "--name", workerName, "--format", "json"]);
  } catch {
    return [];
  }
  return findMissingRequiredSecrets(raw);
}
