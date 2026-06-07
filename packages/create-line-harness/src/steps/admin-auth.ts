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

  s.stop("管理画面の認証設定完了");
}
