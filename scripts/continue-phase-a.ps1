# Run AFTER `npx wrangler login` succeeds in this terminal.
$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot\..

Write-Host "=== Phase A continue (post Cloudflare login) ===" -ForegroundColor Cyan

npx wrangler whoami | Out-Null
if (-not $?) {
  Write-Host "Not logged in. Run: npx wrangler login" -ForegroundColor Red
  Write-Host "  (Browser must approve; wait until wrangler shows your account email.)" -ForegroundColor Yellow
  exit 1
}
Write-Host "Cloudflare: OK" -ForegroundColor Green

pnpm --filter @line-crm/shared build
pnpm --filter @line-crm/line-sdk build
pnpm --filter @line-harness/update-engine build
pnpm --filter create-line-harness build

Write-Host "`nStarting create-line-harness setup (interactive — LINE credentials required)..." -ForegroundColor Yellow
pnpm deploy:setup

Write-Host "`n--- Next: edit .cursor/mcp.json ---" -ForegroundColor Cyan
Write-Host "  LINE_HARNESS_API_URL = Worker URL from setup output"
Write-Host "  LINE_HARNESS_API_KEY = API key from setup output"
Write-Host "  LINE_HARNESS_ACCOUNT_ID = optional (single LINE account)"
Write-Host "`nThen: pnpm verify:self-host" -ForegroundColor Green
Write-Host "Admin: pnpm dev:web → http://localhost:3001 (dashboard checklist)" -ForegroundColor Green
