const {
  currentSession,
  json,
  methodNotAllowed,
} = require('../../_lib/vercel-admin-auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'GET') return methodNotAllowed(res, ['GET'])
  const staff = currentSession(req)
  if (!staff) return json(res, 401, { success: false, error: 'Unauthorized' })
  return json(res, 200, { history: [] })
}
