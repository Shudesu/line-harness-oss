/**
 * Ref codes handed out by the product itself (not tenant campaigns).
 *
 * 'dashboard' is what the admin dashboard's friend-add card rides as the
 * provenance marker (/r/dashboard?account=...). Reserved refs are:
 *   - rejected at entry-route create/update (routes/entry-routes.ts)
 *   - excluded from campaign attribution side effects (applyRefAttribution)
 *     while still being written to friends.ref_code / ref_tracking, so
 *     provenance survives but a pre-existing colliding campaign row can
 *     never fire its tags/scenarios from a dashboard-copied link.
 */
export const RESERVED_REF_CODES = new Set(['dashboard']);

export function isReservedRef(ref: string): boolean {
  return RESERVED_REF_CODES.has(ref.toLowerCase());
}
