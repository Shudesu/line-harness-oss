import type { Context, Next } from 'hono';
import type { Env } from '../index.js';

export async function authMiddleware(c: Context<Env>, next: Next): Promise<Response | void> {
  // Skip auth for the LINE webhook endpoint — it uses signature verification instead
  // Skip auth for OpenAPI docs — public documentation
  const path = new URL(c.req.url).pathname;
  if (
    path === '/webhook' ||
    path === '/docs' ||
    path === '/openapi.json' ||
    path === '/api/affiliates/click' ||
    path.startsWith('/t/') ||
    path.startsWith('/r/') ||
    path.startsWith('/api/liff/') ||
    path.startsWith('/auth/') ||
    (path === '/api/integrations/google-calendar/slots' && c.req.method === 'GET') ||
    (path === '/api/integrations/google-calendar/book' && c.req.method === 'POST') ||
    path === '/api/integrations/stripe/webhook' ||
    path.match(/^\/api\/webhooks\/incoming\/[^/]+\/receive$/) ||
    path.match(/^\/api\/forms\/[^/]+\/submit$/) ||
    path.match(/^\/api\/forms\/[^/]+$/) || // GET form definition (public for LIFF)
    (path === '/api/jobs' && c.req.method === 'GET') ||
    (path.match(/^\/api\/jobs\/[^/]+$/) && c.req.method === 'GET') ||
    (path.match(/^\/api\/jobs\/[^/]+\/book$/) && c.req.method === 'POST') ||
    // Note: /api/bookings/pending, /approve, /deny are NOT public — they require API_KEY
    // Profile & Documents (LIFF public)
    path.match(/^\/api\/profiles(\/[^/]+)?$/) ||
    (path === '/api/documents/upload' && c.req.method === 'POST') ||
    (path.match(/^\/api\/documents\/[^/]+$/) && !path.includes('/file/') && c.req.method === 'GET') ||
    path.match(/^\/api\/favorites(\/[^/]+)?(\/[^/]+)?$/) ||
    (path.match(/^\/api\/liff\/mypage\/[^/]+$/) && c.req.method === 'GET') ||
    // Attendance (LIFF public)
    (path === '/api/attendance/checkin' && c.req.method === 'POST') ||
    (path === '/api/attendance/checkout' && c.req.method === 'POST') ||
    (path === '/api/attendance/status' && c.req.method === 'GET') ||
    // Reviews & Credit Score (LIFF public)
    (path === '/api/reviews' && c.req.method === 'POST') ||
    (path === '/api/reviews/check' && c.req.method === 'GET') ||
    path.match(/^\/api\/reviews\/stats\/[^/]+$/) ||
    path.match(/^\/api\/reviews\/target\/[^/]+$/) ||
    path.match(/^\/api\/credit-score\/[^/]+$/)
  ) {
    return next();
  }

  const authHeader = c.req.header('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  const token = authHeader.slice('Bearer '.length);
  if (token !== c.env.API_KEY) {
    return c.json({ success: false, error: 'Unauthorized' }, 401);
  }

  return next();
}
