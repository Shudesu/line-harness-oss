#!/usr/bin/env node
// Reads .env at the repo root and pushes Worker secrets to Cloudflare via
// `wrangler secret bulk`. Never writes values to disk except a short-lived
// temp file (mode 0600) that is deleted after the call.
//
// Usage:
//   node scripts/push-secrets.mjs          # → default (dev) environment
//   node scripts/push-secrets.mjs --prod   # → production environment

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";

const WORKER_SECRETS = [
  "API_KEY",
  "LEGACY_API_KEY",
  "LINE_CHANNEL_ACCESS_TOKEN",
  "LINE_CHANNEL_SECRET",
  "LINE_LOGIN_CHANNEL_ID",
  "LINE_LOGIN_CHANNEL_SECRET",
  "WORKER_URL",
  "LIFF_URL",
  "STRIPE_WEBHOOK_SECRET",
  "X_HARNESS_URL",
];

const isProd = process.argv.includes("--prod");
const envFile = ".env";

if (!fs.existsSync(envFile)) {
  console.error(`[push-secrets] ${envFile} not found at repo root.`);
  process.exit(1);
}

const env = {};
for (const raw of fs.readFileSync(envFile, "utf8").split("\n")) {
  const line = raw.trim();
  if (!line || line.startsWith("#") || !line.includes("=")) continue;
  const i = line.indexOf("=");
  const key = line.slice(0, i).trim();
  let value = line.slice(i + 1).trim();
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    value = value.slice(1, -1);
  }
  env[key] = value;
}

const payload = {};
for (const key of WORKER_SECRETS) {
  const v = env[key];
  if (v && !v.startsWith("your-") && v !== "") payload[key] = v;
}

const keys = Object.keys(payload);
if (keys.length === 0) {
  console.error("[push-secrets] No worker secrets found in .env (placeholders are skipped).");
  process.exit(1);
}

const tmp = path.join(os.tmpdir(), `wrangler-secrets-${process.pid}-${Date.now()}.json`);
fs.writeFileSync(tmp, JSON.stringify(payload), { mode: 0o600 });

const envFlag = isProd ? " --env production" : "";
console.log(`[push-secrets] pushing ${keys.length} key(s) → ${isProd ? "production" : "dev"}: ${keys.join(", ")}`);

try {
  execSync(`npx wrangler secret bulk "${tmp}"${envFlag}`, {
    cwd: path.resolve("apps/worker"),
    stdio: "inherit",
  });
} finally {
  fs.unlinkSync(tmp);
}
