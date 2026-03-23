import { jstNow } from './utils.js';
// =============================================================================
// Affiliates — Affiliate & Tracking System
// =============================================================================

export interface Affiliate {
  id: string;
  name: string;
  code: string;
  commission_rate: number;
  is_active: number;
  created_at: string;
}

export interface AffiliateClick {
  id: string;
  affiliate_id: string;
  url: string | null;
  ip_address: string | null;
  created_at: string;
}

// ── Affiliate CRUD ──────────────────────────────────────────────────────────

export async function getAffiliates(db: D1Database): Promise<Affiliate[]> {
  const result = await db
    .prepare(`SELECT * FROM affiliates ORDER BY created_at DESC`)
    .all<Affiliate>();
  return result.results;
}

export async function getAffiliateById(
  db: D1Database,
  id: string,
): Promise<Affiliate | null> {
  return db
    .prepare(`SELECT * FROM affiliates WHERE id = ?`)
    .bind(id)
    .first<Affiliate>();
}

export async function getAffiliateByCode(
  db: D1Database,
  code: string,
): Promise<Affiliate | null> {
  return db
    .prepare(`SELECT * FROM affiliates WHERE code = ?`)
    .bind(code)
    .first<Affiliate>();
}

export interface CreateAffiliateInput {
  name: string;
  code: string;
  commissionRate?: number;
}

export async function createAffiliate(
  db: D1Database,
  input: CreateAffiliateInput,
): Promise<Affiliate> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO affiliates (id, name, code, commission_rate, is_active, created_at)
       VALUES (?, ?, ?, ?, 1, ?)`,
    )
    .bind(id, input.name, input.code, input.commissionRate ?? 0, now)
    .run();

  return (await getAffiliateById(db, id))!;
}

export type UpdateAffiliateInput = Partial<
  Pick<Affiliate, 'name' | 'commission_rate' | 'is_active'>
>;

export async function updateAffiliate(
  db: D1Database,
  id: string,
  updates: UpdateAffiliateInput,
): Promise<Affiliate | null> {
  const fields: string[] = [];
  const values: unknown[] = [];

  if (updates.name !== undefined) {
    fields.push('name = ?');
    values.push(updates.name);
  }
  if (updates.commission_rate !== undefined) {
    fields.push('commission_rate = ?');
    values.push(updates.commission_rate);
  }
  if (updates.is_active !== undefined) {
    fields.push('is_active = ?');
    values.push(updates.is_active);
  }

  if (fields.length === 0) return getAffiliateById(db, id);

  values.push(id);
  await db
    .prepare(`UPDATE affiliates SET ${fields.join(', ')} WHERE id = ?`)
    .bind(...values)
    .run();

  return getAffiliateById(db, id);
}

export async function deleteAffiliate(
  db: D1Database,
  id: string,
): Promise<void> {
  await db.prepare(`DELETE FROM affiliates WHERE id = ?`).bind(id).run();
}

// ── Affiliate Clicks ────────────────────────────────────────────────────────

export async function recordAffiliateClick(
  db: D1Database,
  affiliateId: string,
  url?: string | null,
  ipAddress?: string | null,
): Promise<AffiliateClick> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO affiliate_clicks (id, affiliate_id, url, ip_address, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, affiliateId, url ?? null, ipAddress ?? null, now)
    .run();

  return (await db
    .prepare(`SELECT * FROM affiliate_clicks WHERE id = ?`)
    .bind(id)
    .first<AffiliateClick>())!;
}

// ── Affiliate Report ────────────────────────────────────────────────────────

export interface AffiliateReport {
  affiliateId: string;
  affiliateName: string;
  code: string;
  commissionRate: number;
  totalClicks: number;
  totalConversions: number;
  totalRevenue: number;
}

export async function getAffiliateReport(
  db: D1Database,
  affiliateId?: string,
  opts: { startDate?: string; endDate?: string } = {},
): Promise<AffiliateReport[]> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (affiliateId) {
    conditions.push('a.id = ?');
    values.push(affiliateId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

  // Validate date strings to prevent SQL injection (ISO 8601 format only)
  const safeDate = (d: string): string => {
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2}(\.\d+)?Z?)?$/.test(d)) {
      throw new Error(`Invalid date format: ${d}`);
    }
    return d;
  };

  // Build date conditions for subqueries with validated dates
  let clickDateCond = '';
  let cvDateCond = '';
  if (opts.startDate) {
    const sd = safeDate(opts.startDate);
    clickDateCond += ` AND ac.created_at >= '${sd}'`;
    cvDateCond += ` AND ce.created_at >= '${sd}'`;
  }
  if (opts.endDate) {
    const ed = safeDate(opts.endDate);
    clickDateCond += ` AND ac.created_at <= '${ed}'`;
    cvDateCond += ` AND ce.created_at <= '${ed}'`;
  }

  const result = await db
    .prepare(
      `SELECT
         a.id as affiliate_id,
         a.name as affiliate_name,
         a.code,
         a.commission_rate,
         (SELECT COUNT(*) FROM affiliate_clicks ac WHERE ac.affiliate_id = a.id${clickDateCond}) as total_clicks,
         (SELECT COUNT(*) FROM conversion_events ce WHERE ce.affiliate_code = a.code${cvDateCond}) as total_conversions,
         (SELECT COALESCE(SUM(cp.value), 0) FROM conversion_events ce
          JOIN conversion_points cp ON cp.id = ce.conversion_point_id
          WHERE ce.affiliate_code = a.code${cvDateCond}) as total_revenue
       FROM affiliates a
       ${where}
       ORDER BY total_conversions DESC`,
    )
    .bind(...values)
    .all<{
      affiliate_id: string;
      affiliate_name: string;
      code: string;
      commission_rate: number;
      total_clicks: number;
      total_conversions: number;
      total_revenue: number;
    }>();

  return result.results.map((r) => ({
    affiliateId: r.affiliate_id,
    affiliateName: r.affiliate_name,
    code: r.code,
    commissionRate: r.commission_rate,
    totalClicks: r.total_clicks,
    totalConversions: r.total_conversions,
    totalRevenue: r.total_revenue,
  }));
}
