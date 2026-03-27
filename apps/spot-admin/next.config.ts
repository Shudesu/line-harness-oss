import type { NextConfig } from 'next'
import { readFileSync } from 'fs'
import { resolve } from 'path'

const pkg = JSON.parse(readFileSync(resolve(__dirname, '../../package.json'), 'utf-8'))

const nextConfig: NextConfig = {
  output: 'export',
  env: {
    APP_VERSION: pkg.version,
  },
}
export default nextConfig
