import { jstNow } from './utils.js';

// =============================================================================
// Organizations — cross-account customer ledger. One organization bundles
// multiple line_accounts (LINE OAs) so LTV can be rolled up per customer/company
// instead of per individual LINE OA.
// =============================================================================

export interface Organization {
  id: string;
  name: string;
  created_at: string;
  updated_at: string;
}

export async function getOrganizations(db: D1Database): Promise<Organization[]> {
  const result = await db
    .prepare(`SELECT * FROM organizations ORDER BY created_at DESC`)
    .all<Organization>();
  return result.results;
}

export async function getOrganizationById(
  db: D1Database,
  id: string,
): Promise<Organization | null> {
  return db.prepare(`SELECT * FROM organizations WHERE id = ?`).bind(id).first<Organization>();
}

export async function createOrganization(
  db: D1Database,
  name: string,
): Promise<Organization> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO organizations (id, name, created_at, updated_at) VALUES (?, ?, ?, ?)`,
    )
    .bind(id, name, now, now)
    .run();

  return (await getOrganizationById(db, id))!;
}

export async function renameOrganization(
  db: D1Database,
  id: string,
  name: string,
): Promise<void> {
  await db
    .prepare(`UPDATE organizations SET name = ?, updated_at = ? WHERE id = ?`)
    .bind(name, jstNow(), id)
    .run();
}

export async function deleteOrganization(db: D1Database, id: string): Promise<void> {
  // line_accounts.organization_id has no ON DELETE clause — unassign first so
  // deleting an organization can never leave a dangling FK.
  await db
    .prepare(`UPDATE line_accounts SET organization_id = NULL WHERE organization_id = ?`)
    .bind(id)
    .run();
  await db.prepare(`DELETE FROM organizations WHERE id = ?`).bind(id).run();
}

export async function assignAccountToOrganization(
  db: D1Database,
  lineAccountId: string,
  organizationId: string | null,
): Promise<void> {
  await db
    .prepare(`UPDATE line_accounts SET organization_id = ?, updated_at = ? WHERE id = ?`)
    .bind(organizationId, jstNow(), lineAccountId)
    .run();
}

// ── LTV rollup ───────────────────────────────────────────────────────────────
// Both revenue sources (approved affiliate/CV conversions and Stripe payments)
// only carry friend_id, so the join path to an organization is always
// friends.line_account_id → line_accounts.organization_id. There is no
// organization_id column on friends itself (see migration 050) — a friend row
// is scoped to one LINE OA, and the OA's organization is looked up via JOIN
// rather than denormalized, matching the existing users-grouped.ts pattern.

export interface OrganizationLtv {
  organizationId: string;
  organizationName: string;
  approvedConversionCount: number;
  approvedConversionValue: number;
  stripeEventCount: number;
  stripeRevenue: number;
}

export async function getOrganizationLtv(
  db: D1Database,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<OrganizationLtv[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];
  if (opts.startDate) {
    conditions.push('event_created_at >= ?');
    values.push(opts.startDate);
  }
  if (opts.endDate) {
    conditions.push('event_created_at <= ?');
    values.push(opts.endDate);
  }
  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  const result = await db
    .prepare(
      `WITH org_conversions AS (
         SELECT
           la.organization_id AS organization_id,
           ce.created_at AS event_created_at,
           COALESCE(cp.value, 0) AS value
         FROM conversion_events ce
         JOIN friends f ON f.id = ce.friend_id
         JOIN line_accounts la ON la.id = f.line_account_id
         LEFT JOIN conversion_points cp ON cp.id = ce.conversion_point_id
         WHERE ce.approval_status = 'approved'
           AND la.organization_id IS NOT NULL
       ),
       org_stripe AS (
         SELECT
           la.organization_id AS organization_id,
           se.processed_at AS event_created_at,
           COALESCE(se.amount, 0) AS amount
         FROM stripe_events se
         JOIN friends f ON f.id = se.friend_id
         JOIN line_accounts la ON la.id = f.line_account_id
         WHERE la.organization_id IS NOT NULL
       )
       SELECT
         o.id AS organization_id,
         o.name AS organization_name,
         COALESCE(c.cnt, 0) AS approved_conversion_count,
         COALESCE(c.total, 0) AS approved_conversion_value,
         COALESCE(s.cnt, 0) AS stripe_event_count,
         COALESCE(s.total, 0) AS stripe_revenue
       FROM organizations o
       LEFT JOIN (
         SELECT organization_id, COUNT(*) AS cnt, SUM(value) AS total
         FROM org_conversions
         ${where}
         GROUP BY organization_id
       ) c ON c.organization_id = o.id
       LEFT JOIN (
         SELECT organization_id, COUNT(*) AS cnt, SUM(amount) AS total
         FROM org_stripe
         ${where}
         GROUP BY organization_id
       ) s ON s.organization_id = o.id
       ORDER BY (COALESCE(c.total, 0) + COALESCE(s.total, 0)) DESC`,
    )
    .bind(...values, ...values)
    .all<{
      organization_id: string;
      organization_name: string;
      approved_conversion_count: number;
      approved_conversion_value: number;
      stripe_event_count: number;
      stripe_revenue: number;
    }>();

  return result.results.map((r) => ({
    organizationId: r.organization_id,
    organizationName: r.organization_name,
    approvedConversionCount: r.approved_conversion_count,
    approvedConversionValue: r.approved_conversion_value,
    stripeEventCount: r.stripe_event_count,
    stripeRevenue: r.stripe_revenue,
  }));
}
