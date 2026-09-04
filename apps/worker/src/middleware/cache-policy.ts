import type { MiddlewareHandler } from 'hono';

/**
 * Workers Cache is enabled only in the private test environment. Responses
 * must opt in with an explicit public Cache-Control header; everything else
 * is kept out of the cache by default, especially cookie-authenticated APIs.
 */
export function applyDefaultCachePolicy(response: Response, pathname: string): Response {
  if (response.headers.has('Cache-Control')) return response;

  const isPrivateSurface =
    pathname.startsWith('/api/') ||
    pathname.startsWith('/admin/') ||
    pathname === '/webhook' ||
    pathname === '/docs' ||
    pathname === '/openapi.json';

  response.headers.set('Cache-Control', isPrivateSurface ? 'private, no-store' : 'no-store');
  return response;
}

export const defaultCachePolicyMiddleware: MiddlewareHandler = async (c, next) => {
  await next();
  applyDefaultCachePolicy(c.res, new URL(c.req.url).pathname);
};
