import { routeShape } from './api-scope.js';
/** Strict mode is opt-in during the compatibility stage. Existing role guards
 * still apply in both modes; legacy never bypasses an owner-only guard. */
export type StaffRolePolicy = 'legacy' | 'strict';
export interface StaffPolicyEnv { STAFF_ROLE_POLICY?: string }
export function staffRolePolicy(env: StaffPolicyEnv = {}): StaffRolePolicy {
  const value=env.STAFF_ROLE_POLICY?.trim().toLowerCase();
  return !value||value==='legacy'?'legacy':'strict';
}
export const STAFF_READ_ROUTES = [
  "/api/auth/passkeys",
  "/api/admin/extensions",
  "/api/auth/session",
  "/api/auto-replies",
  "/api/auto-replies/:id",
  "/api/capabilities",
  "/api/chats",
  "/api/chats/:id",
  "/api/conversations",
  "/api/conversations/:friendId",
  "/api/friends",
  "/api/friends/:friendId/reminders",
  "/api/friends/:friendId/rich-menu",
  "/api/friends/:id",
  "/api/friends/:id/journey",
  "/api/friends/:id/messages",
  "/api/friends/:id/mileage",
  "/api/friends/:id/score",
  "/api/friends/count",
  "/api/friends/ref-stats",
  "/api/inbox/activity-digest",
  "/api/inbox/unanswered",
  "/api/inbox/unanswered/count",
  "/api/incoming-images/:key",
  "/api/line-accounts",
  "/api/line-accounts/:id",
  "/api/message-templates",
  "/api/message-templates/:id",
  "/api/operators",
  "/api/staff/me",
  "/api/tags",
  "/api/templates",
  "/api/templates/:id",
  "/api/templates/:id/usages"
] as const;
export const STAFF_WRITE_ROUTES = [
  ["POST", "/api/auth/passkeys/register/options"],
  ["POST", "/api/auth/passkeys/register/verify"],
  ["PATCH", "/api/auth/passkeys/:id"],
  ["DELETE", "/api/auth/passkeys/:id"],
  ["POST", "/api/admin/extensions/:id/launch"],
  [
    "POST",
    "/api/friends/:id/tags"
  ],
  [
    "DELETE",
    "/api/friends/:id/tags/:tagId"
  ],
  [
    "PUT",
    "/api/friends/:id/metadata"
  ],
  [
    "POST",
    "/api/friends/:id/messages"
  ],
  [
    "POST",
    "/api/chats"
  ],
  [
    "PUT",
    "/api/chats/:id"
  ],
  [
    "POST",
    "/api/chats/:id/loading"
  ],
  [
    "POST",
    "/api/chats/:id/send"
  ],
  [
    "POST",
    "/api/images"
  ],
  [
    "POST",
    "/api/auth/logout-all"
  ]
] as const;
function pattern(route:string):RegExp {
  const escape = (part:string) => Array.from(part, ch => /[\w-]/.test(ch) ? ch : '\\' + ch).join('');
  return new RegExp('^'+route.split('/').map(part=>part.startsWith(':')?'[^/%]+':escape(part)).join('/')+'$');
}
const reads=STAFF_READ_ROUTES.map(pattern);
const writes=STAFF_WRITE_ROUTES.map(([method,path])=>({method,pattern:pattern(path)}));
export function strictStaffRouteAllowed(method:string,path:string,registeredPath?:string):boolean {
  if (registeredPath !== undefined) {
    const shape = routeShape(registeredPath);
    if (method === 'GET' || method === 'HEAD') return STAFF_READ_ROUTES.some(route => routeShape(route) === shape);
    return STAFF_WRITE_ROUTES.some(([verb, route]) => verb === method && routeShape(route) === shape);
  }
  if(method==='GET'||method==='HEAD')return reads.some(rule=>rule.test(path));
  return writes.some(rule=>rule.method===method&&rule.pattern.test(path));
}
const warned=new Set<string>();
export function staffRouteAllowed(staff:{id:string;role:string;apiScopes?:readonly string[]|null},method:string,path:string,env:StaffPolicyEnv = {},registeredPath?:string):boolean {
  if(staff.role==='owner'||staff.role==='admin')return true;
  if(staff.role!=='staff')return false;
  // Narrow integration scopes are already enforced by the independent gate.
  if(staff.apiScopes!=null)return true;
  const allowed=strictStaffRouteAllowed(method,path,registeredPath);
  if(staffRolePolicy(env)==='strict')return allowed;
  if(!allowed&&!warned.has(staff.id)){
    if(warned.size>=256)warned.clear();
    warned.add(staff.id);
    console.warn('[deprecation] legacy staff policy access attempted staff='+staff.id);
  }
  return true;
}
