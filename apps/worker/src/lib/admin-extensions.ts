import type { AdminExtension } from '@line-crm/shared';

type Role = AdminExtension['minRole'];
const rank: Record<Role, number> = { staff: 0, admin: 1, owner: 2 };

/** Bounded parsing. Diagnostics never include labels or URLs. */
export function parseAdminExtensions(raw: string | undefined,
  invalid: (index: number, reason: string) => void = () => {}): AdminExtension[] {
  if (!raw) return [];
  if (raw.length > 16_384 || new TextEncoder().encode(raw).byteLength > 16_384) {
    invalid(-1, 'configuration_too_large'); return [];
  }
  let entries: unknown;
  try { entries = JSON.parse(raw); } catch { invalid(-1, 'invalid_json'); return []; }
  if (!Array.isArray(entries) || entries.length > 32) { invalid(-1, 'invalid_list'); return []; }
  const seen = new Set<string>(), result: AdminExtension[] = [];
  entries.forEach((entry: unknown, index) => {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) { invalid(index, 'invalid_entry'); return; }
    const value = entry as Record<string, unknown>;
    if (typeof value.id !== 'string' || !/^[a-z][a-z0-9-]{1,31}$/.test(value.id) || seen.has(value.id) ||
      typeof value.label !== 'string' || !value.label.trim() || [...value.label].length > 20 ||
      /[\u0000-\u001f\u007f]/.test(value.label) ||
      typeof value.url !== 'string' || value.url.length > 2048 ||
      (value.minRole !== undefined && value.minRole !== 'owner' && value.minRole !== 'admin' && value.minRole !== 'staff')) {
      invalid(index, 'invalid_metadata'); return;
    }
    let url: URL;
    try { url = new URL(value.url); } catch { invalid(index, 'invalid_url'); return; }
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) { invalid(index, 'invalid_url'); return; }
    seen.add(value.id);
    result.push({ id: value.id, label: value.label.trim(), url: url.href, minRole: value.minRole ?? 'staff' });
  });
  return result;
}

export function visibleAdminExtensions(extensions: AdminExtension[], role: Role, coreOrigins: string[]): AdminExtension[] {
  return extensions.filter(extension => rank[role] >= rank[extension.minRole] &&
    !coreOrigins.includes(new URL(extension.url).origin));
}
