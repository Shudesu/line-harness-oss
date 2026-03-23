import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  output: 'export',
  transpilePackages: ['@line-crm/shared'],
}
export default nextConfig
