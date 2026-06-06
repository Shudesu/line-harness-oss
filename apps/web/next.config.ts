import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))

const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
  // 検証/dev フェーズでは既存コードの lint warning でビルドを止めない
  eslint: { ignoreDuringBuilds: true },
  env: {
    APP_VERSION: pkg.version,
  },
}
export default nextConfig
