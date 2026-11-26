import type { MachineScope } from '@line-crm/db';
import { STAFF_READ_ROUTES, STAFF_WRITE_ROUTES } from './staff-policy.js';
import { routeShape } from './api-scope.js';
export interface MachinePrincipal {
  type: 'machine';
  id: string;
  scopes: MachineScope[];
}
// Explicit registered route identities. New routes remain denied until their
// responses and side effects have been audited. No raw-path wildcard grants.
const reads = [
  ...STAFF_READ_ROUTES.filter(
    (p) =>
      !p.startsWith('/api/auth/') &&
      ![
        '/api/admin/extensions',
        '/api/auth/session',
        '/api/staff/me',
        '/api/auto-replies',
        '/api/auto-replies/:id',
      ].includes(p),
  ),
  '/api/scenarios',
  '/api/scenarios/:id',
  '/api/scenarios/:id/steps',
  '/api/broadcasts',
  '/api/broadcasts/:id',
  '/api/entry-routes',
  '/api/entry-routes/:id',
  '/api/conversion-points',
  '/api/users',
  '/api/users/:id',
];
const sends = [
  ['POST', '/api/friends/:id/messages'],
  ['POST', '/api/chats/:id/send'],
  ['POST', '/api/chats/:id/loading'],
  ['POST', '/api/broadcasts'],
  ['PUT', '/api/broadcasts/:id'],
  ['POST', '/api/broadcasts/:id/send'],
  ['POST', '/api/broadcasts/:id/test'],
  ['POST', '/api/broadcasts/:id/schedule'],
];
const writes = [
  ...STAFF_WRITE_ROUTES.filter(
    ([m, p]) =>
      !p.startsWith('/api/auth/') &&
      !p.startsWith('/api/admin/') &&
      !sends.some(([sm, sp]) => sm === m && sp === p),
  ),
  ['POST', '/api/tags'],
  ['PUT', '/api/tags/:id'],
  ['DELETE', '/api/tags/:id'],
  ['POST', '/api/templates'],
  ['PUT', '/api/templates/:id'],
  ['DELETE', '/api/templates/:id'],
  ['POST', '/api/message-templates'],
  ['PUT', '/api/message-templates/:id'],
  ['DELETE', '/api/message-templates/:id'],
  ['DELETE', '/api/broadcasts/:id'],
];
// Administrative integration writes are intentionally narrow. Credential issuance,
// staff management, login, machine-key management and extension launch are human-only.
const admins = [
  ['GET', '/api/automations'],
  ['POST', '/api/automations'],
  ['PUT', '/api/automations/:id'],
  ['DELETE', '/api/automations/:id'],
  ['GET', '/api/account-settings'],
  ['PUT', '/api/account-settings'],
];
export function requiredMachineScope(
  method: string,
  registeredPath: string,
): MachineScope | null {
  const shape = routeShape(registeredPath);
  const match = (rules: readonly (readonly string[])[]) =>
    rules.some(([m, p]) => m === method && routeShape(p) === shape);
  if (
    (method === 'GET' || method === 'HEAD') &&
    reads.some((p) => routeShape(p) === shape)
  )
    return 'read';
  if (match(sends)) return 'send';
  if (match(writes)) return 'write';
  if (match(admins)) return 'admin';
  return null;
}
export function machineScopeAllowed(
  principal: MachinePrincipal,
  required: MachineScope | null,
): boolean {
  return (
    required !== null &&
    (principal.scopes.includes(required) ||
      (required === 'read' && principal.scopes.includes('write')))
  );
}
