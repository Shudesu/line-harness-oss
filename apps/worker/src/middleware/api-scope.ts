import type { StaffApiScope } from '@line-crm/db';

/** Explicit allowlist: new endpoints never inherit integration privileges. */
export function allowsApiScope(scopes: StaffApiScope[] | null | undefined, method: string, path: string): boolean {
  if (scopes == null) return true;
  if ((method === 'GET' || method === 'HEAD') && scopes.includes('messages:read')) {
    return /^\/api\/(?:friends(?:\/[^/%]+(?:\/messages)?)?|chats(?:\/[^/%]+)?|conversations(?:\/[^/%]+)?|inbox\/(?:activity-digest|unanswered(?:\/count)?)|incoming-images\/incoming-[a-zA-Z0-9_-]+\.(?:jpg|jpeg|png|gif|webp))$/.test(path);
  }
  if (method === 'POST' && scopes.includes('messages:send')) {
    return /^\/api\/(?:friends\/[^/%]+\/messages|chats\/[^/%]+\/send|images)$/.test(path);
  }
  return false;
}
