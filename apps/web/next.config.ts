import type { NextConfig } from 'next'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))
const repoRoot = resolve(__dirname, '../..')

function readGitSha(): string | null {
  try {
    return execSync('git rev-parse HEAD', { cwd: repoRoot, stdio: ['ignore', 'pipe', 'ignore'] })
      .toString()
      .trim()
  } catch {
    return null
  }
}

const buildSha =
  process.env.APP_COMMIT_SHA || process.env.GITHUB_SHA || process.env.CF_PAGES_COMMIT_SHA || readGitSha() || 'local'
const buildTime = process.env.APP_BUILD_TIME || new Date().toISOString()

// three-surfaces bundle（2026-08-24）: テナントのオリジン直下（root）は LIFF アプリ
// （apps/worker 自身の dist/client — friend-add フロー本体）が占有するので、admin は
// サブパスに移った。`NEXT_BASE_PATH`（例: `/console`）は配布ビルド時のみ
// 設定される — 未設定（自己ホスト/開発時のデフォルト）なら従来どおり root で動く。
// 先頭 '/' 必須・末尾 '/' 不可（Next.js の basePath の制約そのまま）。
const basePath = (process.env.NEXT_BASE_PATH ?? '').trim().replace(/\/+$/, '')
if (basePath && !basePath.startsWith('/')) {
  throw new Error(`next.config.ts: NEXT_BASE_PATH must start with '/', got ${JSON.stringify(basePath)}`)
}

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
  basePath: basePath || undefined,
  assetPrefix: basePath || undefined,
  env: {
    APP_VERSION: pkg.version,
    APP_COMMIT_SHA: buildSha.slice(0, 12),
    APP_BUILD_TIME: buildTime,
    // API topology must be explicit in the emitted client bundle. Standard
    // Pages/self-hosted builds use the materialized Worker origin; the WfP
    // workflow overrides this with `same-origin`. Keeping a concrete default
    // here also lets Next fold the branch at build time instead of leaving a
    // runtime process.env lookup in browser code.
    NEXT_PUBLIC_API_MODE: process.env.NEXT_PUBLIC_API_MODE ?? 'worker-origin',
    // basePath 自体は next/link・next/router には自動で乗るが、`window.location.href = '/x'`
    // のような生の絶対パス代入には乗らない。そうした呼び出し側（sidebar.tsx のログアウト、
    // emergency/page.tsx の切替導線）がこの値を読んで自分でプレフィックスする
    // （`src/lib/base-path.ts` の `withBasePath` 参照）。
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
}
export default nextConfig
