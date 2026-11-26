export function routeShape(path:string):string { return path.replace(/:[^/]+/g, ':param'); }
const readRoutes=new Set([
 '/api/friends','/api/friends/count','/api/friends/ref-stats','/api/friends/:param','/api/friends/:param/messages',
 '/api/chats','/api/chats/:param','/api/conversations','/api/conversations/:param',
 '/api/inbox/activity-digest','/api/inbox/unanswered','/api/inbox/unanswered/count','/api/incoming-images/:param',
]);
const sendRoutes=new Set(['/api/friends/:param/messages','/api/chats/:param/send','/api/images']);
import type { StaffApiScope } from '@line-crm/db';

/** Explicit allowlist: new endpoints never inherit integration privileges. */
export function allowsApiScope(scopes: StaffApiScope[] | null | undefined, method: string, path: string, registeredPath?: string): boolean {
  if (scopes == null) return true;
  if ((method === 'GET' || method === 'HEAD') && scopes.includes('messages:read')) {
    if (registeredPath !== undefined && !readRoutes.has(routeShape(registeredPath))) return false;
    return /^\/api\/(?:friends(?:\/[^/%]+(?:\/messages)?)?|chats(?:\/[^/%]+)?|conversations(?:\/[^/%]+)?|inbox\/(?:activity-digest|unanswered(?:\/count)?)|incoming-images\/incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp))$/.test(path);
  }
  if (method === 'POST' && scopes.includes('messages:send')) {
    if (registeredPath !== undefined && !sendRoutes.has(routeShape(registeredPath))) return false;
    return /^\/api\/(?:friends\/[^/%]+\/messages|chats\/[^/%]+\/send|images)$/.test(path);
  }
  return false;
}
