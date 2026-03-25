#!/usr/bin/env node
// Initial setup script: copies *.example files to working copies if they don't exist

import { copyFileSync, existsSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const files = [
  {
    src: 'apps/worker/wrangler.toml.example',
    dest: 'apps/worker/wrangler.toml',
    note: '→ database_id と WORKER_URL を自分の値に書き換えてください',
  },
  {
    src: 'apps/worker/.dev.vars.example',
    dest: 'apps/worker/.dev.vars',
    note: '→ LINE チャネル情報と API_KEY を記入してください',
  },
  {
    src: 'apps/web/.env.example',
    dest: 'apps/web/.env.local',
    note: '→ NEXT_PUBLIC_API_URL と NEXT_PUBLIC_API_KEY を記入してください',
  },
  {
    src: 'apps/liff/.env.example',
    dest: 'apps/liff/.env.local',
    note: '→ VITE_LIFF_ID と VITE_API_URL を記入してください',
  },
]

let created = 0

for (const { src, dest, note } of files) {
  const srcPath = resolve(root, src)
  const destPath = resolve(root, dest)

  if (existsSync(destPath)) {
    console.log(`  skip   ${dest}  (already exists)`)
  } else {
    copyFileSync(srcPath, destPath)
    console.log(`  create ${dest}`)
    console.log(`         ${note}`)
    created++
  }
}

console.log('')
if (created > 0) {
  console.log(`${created} ファイルを作成しました。各ファイルに値を記入してください。`)
  console.log('')
  console.log('次のステップ:')
  console.log('  1. apps/worker/wrangler.toml  → database_id を設定')
  console.log('  2. apps/worker/.dev.vars       → LINE チャネル情報を設定')
  console.log('  3. apps/web/.env.local         → API URL / キーを設定')
  console.log('  4. apps/liff/.env.local        → LIFF ID / API URL を設定')
  console.log('')
  console.log('ローカル起動:')
  console.log('  pnpm dev:worker   # http://localhost:8787')
  console.log('  pnpm dev:web      # http://localhost:3001')
} else {
  console.log('全ファイルが既に存在します。セットアップ済みです。')
}
