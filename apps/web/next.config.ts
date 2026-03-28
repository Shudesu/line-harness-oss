import type { NextConfig } from 'next'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))

const nextConfig: NextConfig = {
  transpilePackages: ['@line-crm/shared', '@line-crm/db'],
  env: {
    APP_VERSION: pkg.version,
  },
  webpack: (config) => {
    // DB package uses ESM .js extensions (import './utils.js' → utils.ts)
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js', '.jsx'],
      '.mjs': ['.mts', '.mjs'],
    }
    return config
  },
}

if (process.env.NODE_ENV === 'development') {
  initOpenNextCloudflareForDev()
}

export default nextConfig
