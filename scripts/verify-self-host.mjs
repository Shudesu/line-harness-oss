#!/usr/bin/env node
/**
 * Self-host readiness check (Phase A).
 * Usage: node scripts/verify-self-host.mjs [--api-url URL] [--api-key KEY]
 * Reads .cursor/mcp.json env when flags omitted.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const args = process.argv.slice(2);

function flag(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}

function loadMcpEnv() {
  const path = join(root, '.cursor', 'mcp.json');
  if (!existsSync(path)) return {};
  try {
    const json = JSON.parse(readFileSync(path, 'utf8'));
    const servers = json.mcpServers ?? {};
    const entry = servers['line-harness'] ?? Object.values(servers)[0];
    return entry?.env ?? {};
  } catch {
    return {};
  }
}

const mcpEnv = loadMcpEnv();
const apiUrl = (flag('--api-url') ?? mcpEnv.LINE_HARNESS_API_URL ?? '').replace(/\/$/, '');
const apiKey = flag('--api-key') ?? mcpEnv.LINE_HARNESS_API_KEY ?? '';

let failed = 0;

function ok(msg) {
  console.log(`✓ ${msg}`);
}
function warn(msg) {
  console.log(`! ${msg}`);
}
function fail(msg) {
  console.log(`✗ ${msg}`);
  failed += 1;
}

const nodeMajor = Number(process.versions.node.split('.')[0]);
if (nodeMajor >= 20) ok(`Node.js ${process.versions.node}`);
else fail(`Node.js 20+ required (current ${process.versions.node})`);

if (existsSync(join(root, 'pnpm-lock.yaml'))) ok('pnpm workspace present');
else warn('pnpm-lock.yaml not found — run from repo root');

if (existsSync(join(root, '.cursor', 'mcp.json'))) {
  if (!apiKey || apiKey.includes('REPLACE')) {
    warn('.cursor/mcp.json exists but LINE_HARNESS_API_KEY is still a placeholder');
  } else {
    ok('LINE_HARNESS_API_KEY set in .cursor/mcp.json');
  }
} else {
  warn('No .cursor/mcp.json — copy from .cursor/mcp.json.example after deploy');
}

if (!apiUrl) {
  warn('No API URL — set LINE_HARNESS_API_URL in .cursor/mcp.json or pass --api-url');
} else {
  try {
    const health = await fetch(`${apiUrl}/api/health`, { signal: AbortSignal.timeout(15_000) });
    if (health.ok) ok(`Worker health: ${apiUrl}/api/health`);
    else fail(`Worker health returned ${health.status}`);
  } catch (e) {
    fail(`Worker unreachable at ${apiUrl} (${e instanceof Error ? e.message : e})`);
  }

  try {
    const cap = await fetch(`${apiUrl}/api/capabilities`, { signal: AbortSignal.timeout(15_000) });
    if (cap.ok) ok('GET /api/capabilities');
    else fail(`capabilities returned ${cap.status}`);
  } catch (e) {
    fail(`capabilities fetch failed (${e instanceof Error ? e.message : e})`);
  }

  if (apiKey && !apiKey.includes('REPLACE')) {
    try {
      const res = await fetch(`${apiUrl}/api/line-accounts`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15_000),
      });
      if (res.ok) ok('API key accepted (GET /api/line-accounts)');
      else fail(`API key rejected (${res.status})`);
    } catch (e) {
      fail(`authenticated API check failed (${e instanceof Error ? e.message : e})`);
    }
  }
}

console.log('');
if (failed > 0) {
  console.log(`Self-host check finished with ${failed} error(s). See docs/self-host/PHASE-A-DEPLOY.md`);
  process.exit(1);
}
console.log('Self-host check passed (or only warnings). Next: docs/wiki/30-Video-Feature-Playbook.md');
process.exit(0);
