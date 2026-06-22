const { json, methodNotAllowed } = require('../_lib/vercel-admin-auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const sha = process.env.VERCEL_GIT_COMMIT_SHA || process.env.APP_COMMIT_SHA || 'vercel'
  return json(res, 200, {
    version: process.env.npm_package_version || '0.15.0',
    worker_hash: sha.slice(0, 12),
    admin_hash: sha.slice(0, 12),
    liff_hash: sha.slice(0, 12),
  })
}
