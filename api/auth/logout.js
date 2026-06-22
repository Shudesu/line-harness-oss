const {
  clearSessionCookies,
  json,
  methodNotAllowed,
} = require('../_lib/vercel-admin-auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])
  clearSessionCookies(res)
  return json(res, 200, { success: true, data: null })
}
