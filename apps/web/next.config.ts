import type { NextConfig } from 'next'
const nextConfig: NextConfig = {
  output: 'export',
  trailingSlash: true,
  transpilePackages: ['@line-crm/shared'],
}
export default nextConfig
