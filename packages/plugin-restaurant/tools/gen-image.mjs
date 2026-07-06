// Codex image_gen → ファイル取得（信頼版）
// 依存: Node 組み込みのみ（child_process / fs）。
//
// なぜ必要か:
//   Codex に「生成して保存して」と頼むと、後処理で generated_images から
//   "最新ファイル" を find して別スレッドの古い画像を取り違えてコピーすることがある
//   （実際に企業サイト画像が混入する事故が起きた）。本スクリプトは Codex に
//   「生成だけ」させ、そのタスク自身のスレッドフォルダ
//   ~/.codex/generated_images/<threadId>/ig_*.png から最新を“こちらが”回収する。
//
// 使い方:
//   node scripts/gen-image.mjs "<prompt>" <out.png> [--timeout 360]
//
// 出力(JSON): { ok, out, threadId, jobId, picked }
//
// 注意: Codex にログイン必須（image_gen はモデルのツール）。未ログインなら
//   `!codex login`（対話）をユーザーに依頼すること。

import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

const HOME = os.homedir();
const GEN_ROOT = path.join(HOME, ".codex", "generated_images");

function arg(name, fb = null) {
  const i = process.argv.indexOf(name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fb;
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const prompt = process.argv[2];
const out = process.argv[3];
if (!prompt || !out || prompt.startsWith("--")) {
  console.error('usage: node scripts/gen-image.mjs "<prompt>" <out.png> [--timeout 360]');
  process.exit(1);
}
const timeoutSec = parseInt(arg("--timeout", "360"), 10);

// --- companion を解決（最新バージョンを選ぶ） ---
function resolveCompanion() {
  const base = path.join(HOME, ".claude/plugins/cache/openai-codex/codex");
  if (!fs.existsSync(base)) return null;
  const vers = fs
    .readdirSync(base)
    .filter((d) => fs.existsSync(path.join(base, d, "scripts/codex-companion.mjs")))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  if (!vers.length) return null;
  return path.join(base, vers[vers.length - 1], "scripts/codex-companion.mjs");
}
const CC = resolveCompanion();
if (!CC) {
  console.error("codex-companion.mjs が見つかりません（Codex プラグイン未導入？）");
  process.exit(1);
}

// --- ジョブのログファイルを探す ---
function findLog(jobId) {
  const base = path.join(HOME, ".claude/plugins/data/codex-openai-codex/state");
  if (!fs.existsSync(base)) return null;
  for (const d of fs.readdirSync(base)) {
    const p = path.join(base, d, "jobs", `${jobId}.log`);
    if (fs.existsSync(p)) return p;
  }
  return null;
}
function newestPng(dir) {
  if (!fs.existsSync(dir)) return null;
  const pngs = fs
    .readdirSync(dir)
    .filter((f) => f.toLowerCase().endsWith(".png"))
    .map((f) => ({ f: path.join(dir, f), t: fs.statSync(path.join(dir, f)).mtimeMs }))
    .sort((a, b) => b.t - a.t);
  return pngs.length ? pngs[0].f : null;
}

const wrapped =
  "Use ONLY your built-in image_gen tool to generate this image. Do NOT search for or use any CLI. " +
  "Do NOT copy or move files. Just generate it. PROMPT: " +
  prompt;

let started;
try {
  started = execFileSync("node", [CC, "task", "--background", "--write", wrapped], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
} catch (e) {
  console.error("companion task の起動に失敗:", e.message);
  process.exit(1);
}
const jobId = (started.match(/task-[a-z0-9-]+/i) || [])[0];
if (!jobId) {
  console.error("jobId を取得できませんでした:\n" + started);
  process.exit(1);
}

const deadline = Date.now() + timeoutSec * 1000;
let threadId = null;
let log = null;
while (Date.now() < deadline) {
  if (!log) log = findLog(jobId);
  if (log && fs.existsSync(log)) {
    const txt = fs.readFileSync(log, "utf8");
    if (!threadId) {
      const m = txt.match(/Thread ready \(([0-9a-f-]{36})\)/i);
      if (m) threadId = m[1];
    }
    const done = /Final output/.test(txt);
    if (threadId) {
      const img = newestPng(path.join(GEN_ROOT, threadId));
      if (img && done) {
        fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
        fs.copyFileSync(img, path.resolve(out));
        console.log(JSON.stringify({ ok: true, out: path.resolve(out), threadId, jobId, picked: img }, null, 2));
        process.exit(0);
      }
    }
  }
  await sleep(6000);
}

// タイムアウト時、スレッドが分かっていれば最後の望みで回収
if (threadId) {
  const img = newestPng(path.join(GEN_ROOT, threadId));
  if (img) {
    fs.mkdirSync(path.dirname(path.resolve(out)), { recursive: true });
    fs.copyFileSync(img, path.resolve(out));
    console.log(JSON.stringify({ ok: true, out: path.resolve(out), threadId, jobId, picked: img, note: "timeout-but-recovered" }, null, 2));
    process.exit(0);
  }
}
console.error(JSON.stringify({ ok: false, jobId, threadId, error: "画像を回収できませんでした（タイムアウト/未ログインの可能性）" }, null, 2));
process.exit(1);
