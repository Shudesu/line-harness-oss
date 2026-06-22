const {
  adminStaff,
  json,
  methodNotAllowed,
  parseBody,
  requireAdminConfig,
  safeEqual,
  setSessionCookies,
} = require('../_lib/vercel-admin-auth')

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return methodNotAllowed(res, ['POST'])

  const missing = requireAdminConfig()
  if (missing.length > 0) {
    return json(res, 500, {
      success: false,
      error: `Admin auth is not configured: ${missing.join(', ')}`,
    })
  }

  const body = await parseBody(req)
  const email = String(body.email || '').trim()
  const password = String(body.password || '')
  const valid =
    email.toLowerCase() === String(process.env.ADMIN_EMAIL).toLowerCase() &&
    safeEqual(password, process.env.ADMIN_PASSWORD)

  if (!valid) {
    return json(res, 401, { success: false, error: 'Unauthorized' })
  }

  const staff = adminStaff()
  const csrfToken = setSessionCookies(res, staff)
  return json(res, 200, { success: true, data: staff, csrfToken })
}
