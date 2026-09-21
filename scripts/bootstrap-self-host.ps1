# L Harness OSS — Phase A bootstrap (Windows)
# Usage: powershell -ExecutionPolicy Bypass -File scripts/bootstrap-self-host.ps1
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "=== L Harness self-host bootstrap ===" -ForegroundColor Cyan

$nodeMajor = [int]((node -v).TrimStart("v").Split(".")[0])
if ($nodeMajor -lt 20) {
  Write-Error "Node.js 20+ required (current: $(node -v))"
}

Write-Host "`n[1/4] pnpm install (if needed)..." -ForegroundColor Yellow
pnpm install --frozen-lockfile 2>$null
if (-not $?) { pnpm install }

Write-Host "`n[2/4] Build packages..." -ForegroundColor Yellow
pnpm --filter @line-crm/shared build
pnpm --filter @line-crm/line-sdk build
pnpm --filter @line-harness/update-engine build
pnpm --filter create-line-harness build

Write-Host "`n[3/4] Cloudflare login..." -ForegroundColor Yellow
npx wrangler whoami 2>$null
if (-not $?) {
  Write-Host "Wrangler is not logged in. Opening browser for OAuth..." -ForegroundColor Yellow
  npx wrangler login
}

Write-Host "`n[4/4] Run setup CLI (interactive)..." -ForegroundColor Yellow
Write-Host "  → LINE Messaging API + LINE Login の値を用意してください。" -ForegroundColor Gray
Write-Host "  → Step 14 で Cursor を選択すると .cursor/mcp.json が生成されます。" -ForegroundColor Gray
pnpm deploy:setup

Write-Host "`nAfter setup, update .cursor/mcp.json and run:" -ForegroundColor Green
Write-Host "  pnpm verify:self-host" -ForegroundColor Green
Write-Host "Playbook: docs/wiki/30-Video-Feature-Playbook.md" -ForegroundColor Green
Write-Host "`nLocal dev (monorepo): pnpm dev:worker → http://localhost:5173 (not 8787)" -ForegroundColor Gray
Write-Host "  pnpm dev:web → http://localhost:3001" -ForegroundColor Gray
