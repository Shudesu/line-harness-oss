const { json, methodNotAllowed } = require('../../_lib/vercel-admin-auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  return json(res, 200, {
    success: true,
    data: {
      configured: Boolean(process.env.KUCHIKOMI_ROBO_WEBHOOK_URL),
      hasApiKey: Boolean(process.env.KUCHIKOMI_ROBO_API_KEY),
      hasSharedSecret: Boolean(process.env.KUCHIKOMI_ROBO_SHARED_SECRET),
      defaultStoreId: process.env.KUCHIKOMI_ROBO_STORE_ID || null,
    },
  })
}
