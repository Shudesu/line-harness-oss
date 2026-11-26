import { requiredMachineScope, machineScopeAllowed } from './scopes.js';
import { Hono, type Env as HonoEnv, type MiddlewareHandler } from 'hono';
import { routePath } from 'hono/route';
import { allowsApiScope } from './api-scope.js';
import { staffRouteAllowed } from './staff-policy.js';
import { safeDecode } from '../utils/safe-decode.js';
import type { AuthenticatedStaff } from './auth.js';

/** Bind authorization to the actual registered route, so a new static endpoint
 * cannot inherit the permissions of an older :id route matching the same URL. */
const authorizeRoute: MiddlewareHandler = async (c, next) => {
  const staff = c.get('staff') as AuthenticatedStaff | undefined;
  if (!staff) return next(); // Public/LINE-signed routes keep their own identity gates.
  const path = new URL(c.req.url).pathname;
  const legacy =
    /^\/images\/incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp)$/.test(
      safeDecode(path),
    );
  const scopePath = legacy
    ? safeDecode(path).replace('/images/', '/api/incoming-images/')
    : path;
  const registered = legacy ? '/api/incoming-images/:key' : routePath(c);
  if (staff.machine) {
    const required = requiredMachineScope(c.req.method, registered);
    if (!machineScopeAllowed(staff.machine, required)) {
      if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method))
        console.info(
          '[machine-key] key=' +
            staff.id +
            ' ' +
            c.req.method +
            ' ' +
            registered +
            ' 403',
        );
      return c.json(
        {
          success: false,
          error: 'insufficient_scope',
          required: required ?? 'human',
        },
        403,
      );
    }
    await next();
    if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method))
      console.info(
        '[machine-key] key=' +
          staff.id +
          ' ' +
          c.req.method +
          ' ' +
          registered +
          ' ' +
          c.res.status,
      );
    return;
  }
  if (!allowsApiScope(staff.apiScopes, c.req.method, scopePath, registered))
    return c.json(
      { success: false, error: 'API key scope does not allow this operation' },
      403,
    );
  if (!staffRouteAllowed(staff, c.req.method, scopePath, c.env, registered))
    return c.json(
      {
        success: false,
        error: 'insufficient_role',
        message: 'この操作には管理者以上の権限が必要です',
      },
      403,
    );
  return next();
};
const decorated = new WeakSet<object>();
function decorate<T extends Hono<any>>(router: T): T {
  if (decorated.has(router)) return router;
  decorated.add(router);
  for (const method of [
    'get',
    'post',
    'put',
    'patch',
    'delete',
    'options',
    'all',
  ] as const) {
    const original = router[method].bind(router) as (...args: any[]) => any;
    (router as any)[method] = (...args: any[]) =>
      typeof args[0] === 'string'
        ? original(args[0], authorizeRoute, ...args.slice(1))
        : original(authorizeRoute, ...args);
  }
  const on = router.on.bind(router) as (...args: any[]) => any;
  (router as any).on = (method: any, path: any, ...handlers: any[]) =>
    on(method, path, authorizeRoute, ...handlers);
  const basePath = router.basePath.bind(router);
  (router as any).basePath = (path: string) => decorate(basePath(path));
  return router;
}
/** Mount behind authMiddleware; public routes retain their own signature/LINE identity checks. */
export function createAuthorizedRouter<E extends HonoEnv = HonoEnv>(
  options?: ConstructorParameters<typeof Hono>[0],
): Hono<E> {
  return decorate(new Hono<E>(options));
}
