import * as p from "@clack/prompts";
import { wrangler } from "../lib/wrangler.js";

interface AdminAuthOptions {
  workerName: string;
  /** Optional: the Worker can fall back to the request origin if unset. */
  workerUrl?: string;
  adminUrl: string;
}

const RETRY_AUTH_SETUP = "Cloudflare の認証と対象アカウントを確認し、同じオプションでコマンドを再実行してください。詳細: docs/ADMIN-AUTH.md";
const AUTH_VERIFICATION_FAILED = `管理画面の認証用シークレットを確認できませんでした。${RETRY_AUTH_SETUP}`;

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
  } catch {
    s.stop("管理画面の認証設定は未完了です");
    // Wrangler errors can contain request data; do not expose their text/cause.
    throw new Error(`管理画面の認証設定に失敗しました。${RETRY_AUTH_SETUP}`);
  }

  // Verify the secrets actually landed on the deployed Worker. The bulk /
  // versions path can silently no-op in some auth states, and a setup that
  // aborted earlier (e.g. the Worker-deploy failure fixed in
  // create-line-harness@0.1.27, issue #177) never reaches this step at all — in
  // both cases the Worker is left without ADMIN_ORIGIN and admin login then
  // fails with an opaque CORS error (issue #179). Surface it now, at setup time,
  // instead of leaving the operator to debug a browser CORS block.
  try {
    await assertAdminAuthConfigured(options.workerName);
  } catch (error) {
    s.stop("管理画面の認証設定は未完了です");
    throw error;
  }
  s.stop("管理画面の認証設定完了");
}

export const REQUIRED_ADMIN_AUTH_SECRETS = ["ADMIN_ORIGIN", "ADMIN_ALLOW_CROSS_SITE"];

/**
 * Parse `wrangler secret list --format json` output and return which required
 * admin-auth secrets are absent. Pure and exported so it can be unit-tested.
 *
 * Tolerant of leading noise before the JSON array. An unreadable list is
 * unverified, never evidence of success; throw without exposing the raw output.
 */
export function findMissingRequiredSecrets(rawSecretListJson: string): string[] {
  // Extract from the first '[' so a stray banner line before the JSON array
  // does not defeat the parse.
  const start = rawSecretListJson.indexOf("[");
  if (start === -1) throw new Error(AUTH_VERIFICATION_FAILED);

  let names: Set<string>;
  try {
    const parsed: unknown = JSON.parse(rawSecretListJson.slice(start));
    if (!Array.isArray(parsed) || parsed.some(entry =>
      !entry || typeof entry !== "object" || typeof entry.name !== "string" || !entry.name.trim(),
    )) throw new Error(AUTH_VERIFICATION_FAILED);
    names = new Set(parsed.map(entry => entry.name));
  } catch {
    throw new Error(AUTH_VERIFICATION_FAILED);
  }

  return REQUIRED_ADMIN_AUTH_SECRETS.filter((name) => !names.has(name));
}

/**
 * Read-only verification, also used to recheck saved "adminAuth" completion.
 * Missing secrets and unavailable verification both prevent setup completion.
 */
export async function assertAdminAuthConfigured(workerName: string): Promise<void> {
  let raw: string;
  try {
    // `--format json` is the default on current wrangler but is passed
    // explicitly so the parse stays stable across versions.
    raw = await wrangler(["secret", "list", "--name", workerName, "--format", "json"]);
  } catch {
    throw new Error(AUTH_VERIFICATION_FAILED);
  }
  const missing = findMissingRequiredSecrets(raw);
  if (missing.length > 0) {
    throw new Error(`必須の認証用シークレットが未反映です (${missing.join(", ")})。${RETRY_AUTH_SETUP}`);
  }
}
