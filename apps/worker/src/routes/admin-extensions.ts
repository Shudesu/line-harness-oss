import { Hono } from 'hono';
import type { Env } from '../index.js';
import { parseAdminExtensions, visibleAdminExtensions } from '../lib/admin-extensions.js';

export const adminExtensions = new Hono<Env>();
// Bounded diagnostic deduplication only; never cache principals or configuration.
const reported = new Set<string>();
adminExtensions.get('/api/admin/extensions', c => {
  const staff = c.get('staff');
  if (!staff) return c.json({ error: 'unauthorized' }, 401);
  c.header('Cache-Control', 'no-store');
  const extensions = parseAdminExtensions(c.env.ADMIN_EXTENSIONS, (index, reason) => {
    const key = index + ':' + reason;
    if (reported.size < 64 && !reported.has(key)) {
      reported.add(key);
      console.warn('admin_extension_configuration', { index, reason });
    }
  });
  const coreOrigins = [new URL(c.req.url).origin];
  for (const origin of (c.env.ADMIN_ORIGIN ?? '').split(',')) {
    try { coreOrigins.push(new URL(origin.trim()).origin); } catch { /* Existing auth config validates origins. */ }
  }
  return c.json({ extensions: visibleAdminExtensions(extensions, staff.role, coreOrigins) });
});
