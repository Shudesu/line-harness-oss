import { jstNow } from './utils.js';

// --- Types ---

export interface PayrollRecord {
  id: string;
  friend_id: string;
  booking_id: string;
  job_id: string;
  nursery_name: string;
  work_date: string;
  start_time: string;
  end_time: string;
  actual_hours: number | null;
  hourly_rate: number;
  gross_amount: number;
  transport_fee: number;
  withholding_tax: number;
  net_amount: number;
  payment_method: 'spot' | 'monthly';
  payment_status: 'pending' | 'processing' | 'paid';
  paid_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface WorkerPaymentSettings {
  id: string;
  friend_id: string;
  default_payment_method: 'spot' | 'monthly';
  bank_name: string | null;
  branch_name: string | null;
  account_type: string | null;
  account_number: string | null;
  account_holder: string | null;
  created_at: string;
  updated_at: string;
}

export interface WithholdingTaxRate {
  id: string;
  year: number;
  threshold_amount: number;
  rate: number;
  effective_from: string;
}

// --- 源泉徴収計算 ---

export async function getWithholdingTaxRate(db: D1Database, year: number): Promise<WithholdingTaxRate | null> {
  return db.prepare(
    `SELECT * FROM withholding_tax_rates WHERE year = ? ORDER BY effective_from DESC LIMIT 1`
  ).bind(year).first<WithholdingTaxRate>();
}

/**
 * 源泉徴収額を計算
 * 日額報酬が閾値を超えた場合に税率を適用
 */
export function calculateWithholdingTax(
  grossAmount: number,
  rate: WithholdingTaxRate | null,
): number {
  if (!rate) return 0;
  if (grossAmount <= rate.threshold_amount) return 0;
  // 源泉徴収額 = 報酬額 × 税率（1円未満切り捨て）
  return Math.floor(grossAmount * rate.rate);
}

/**
 * 報酬を自動計算してレコードを作成
 */
export async function createPayrollRecord(
  db: D1Database,
  input: {
    friendId: string;
    bookingId: string;
    jobId: string;
    nurseryName: string;
    workDate: string;
    startTime: string;
    endTime: string;
    actualHours: number | null;
    hourlyRate: number;
    transportFee?: number;
    paymentMethod?: 'spot' | 'monthly';
  },
): Promise<PayrollRecord> {
  const id = crypto.randomUUID();
  const now = jstNow();

  // 勤務時間計算（actual_hoursがあればそちら優先、なければ予定時間から計算）
  let hours = input.actualHours;
  if (!hours) {
    const [sh, sm] = input.startTime.split(':').map(Number);
    const [eh, em] = input.endTime.split(':').map(Number);
    hours = (eh * 60 + em - sh * 60 - sm) / 60;
  }

  const grossAmount = Math.round(hours * input.hourlyRate);
  const transportFee = input.transportFee || 0;

  // 源泉徴収計算
  const year = parseInt(input.workDate.slice(0, 4), 10);
  const taxRate = await getWithholdingTaxRate(db, year);
  const withholdingTax = calculateWithholdingTax(grossAmount, taxRate);

  const netAmount = grossAmount + transportFee - withholdingTax;

  // 振込方法: ワーカーのデフォルト設定を使用、指定があればそちら優先
  let paymentMethod = input.paymentMethod || 'monthly';
  if (!input.paymentMethod) {
    const settings = await getWorkerPaymentSettings(db, input.friendId);
    if (settings) paymentMethod = settings.default_payment_method;
  }

  await db.prepare(`
    INSERT INTO payroll_records (
      id, friend_id, booking_id, job_id, nursery_name, work_date,
      start_time, end_time, actual_hours, hourly_rate,
      gross_amount, transport_fee, withholding_tax, net_amount,
      payment_method, payment_status, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)
  `).bind(
    id, input.friendId, input.bookingId, input.jobId, input.nurseryName, input.workDate,
    input.startTime, input.endTime, hours, input.hourlyRate,
    grossAmount, transportFee, withholdingTax, netAmount,
    paymentMethod, now, now,
  ).run();

  return (await getPayrollRecordById(db, id))!;
}

// --- CRUD ---

export async function getPayrollRecordById(db: D1Database, id: string): Promise<PayrollRecord | null> {
  return db.prepare(`SELECT * FROM payroll_records WHERE id = ?`).bind(id).first<PayrollRecord>();
}

export async function getPayrollByBookingId(db: D1Database, bookingId: string): Promise<PayrollRecord | null> {
  return db.prepare(`SELECT * FROM payroll_records WHERE booking_id = ?`).bind(bookingId).first<PayrollRecord>();
}

export async function getPayrollByFriendId(
  db: D1Database,
  friendId: string,
  opts?: { status?: string; fromDate?: string; toDate?: string },
): Promise<PayrollRecord[]> {
  let sql = `SELECT * FROM payroll_records WHERE friend_id = ?`;
  const binds: unknown[] = [friendId];

  if (opts?.status) {
    sql += ` AND payment_status = ?`;
    binds.push(opts.status);
  }
  if (opts?.fromDate) {
    sql += ` AND work_date >= ?`;
    binds.push(opts.fromDate);
  }
  if (opts?.toDate) {
    sql += ` AND work_date <= ?`;
    binds.push(opts.toDate);
  }

  sql += ` ORDER BY work_date DESC`;

  const stmt = db.prepare(sql);
  const result = await stmt.bind(...binds).all<PayrollRecord>();
  return result.results;
}

/**
 * ワーカーの報酬サマリー
 */
export async function getPayrollSummary(
  db: D1Database,
  friendId: string,
): Promise<{
  totalGross: number;
  totalTransport: number;
  totalWithholding: number;
  totalNet: number;
  totalPaid: number;
  totalPending: number;
  recordCount: number;
}> {
  const result = await db.prepare(`
    SELECT
      COALESCE(SUM(gross_amount), 0) as total_gross,
      COALESCE(SUM(transport_fee), 0) as total_transport,
      COALESCE(SUM(withholding_tax), 0) as total_withholding,
      COALESCE(SUM(net_amount), 0) as total_net,
      COALESCE(SUM(CASE WHEN payment_status = 'paid' THEN net_amount ELSE 0 END), 0) as total_paid,
      COALESCE(SUM(CASE WHEN payment_status = 'pending' THEN net_amount ELSE 0 END), 0) as total_pending,
      COUNT(*) as record_count
    FROM payroll_records
    WHERE friend_id = ?
  `).bind(friendId).first<{
    total_gross: number;
    total_transport: number;
    total_withholding: number;
    total_net: number;
    total_paid: number;
    total_pending: number;
    record_count: number;
  }>();

  return {
    totalGross: result?.total_gross || 0,
    totalTransport: result?.total_transport || 0,
    totalWithholding: result?.total_withholding || 0,
    totalNet: result?.total_net || 0,
    totalPaid: result?.total_paid || 0,
    totalPending: result?.total_pending || 0,
    recordCount: result?.record_count || 0,
  };
}

export async function updatePayrollStatus(
  db: D1Database,
  id: string,
  status: 'processing' | 'paid',
): Promise<void> {
  const now = jstNow();
  const paidAt = status === 'paid' ? now : null;
  await db.prepare(
    `UPDATE payroll_records SET payment_status = ?, paid_at = ?, updated_at = ? WHERE id = ?`
  ).bind(status, paidAt, now, id).run();
}

export async function updatePayrollMethod(
  db: D1Database,
  id: string,
  method: 'spot' | 'monthly',
): Promise<void> {
  await db.prepare(
    `UPDATE payroll_records SET payment_method = ?, updated_at = ? WHERE id = ?`
  ).bind(method, jstNow(), id).run();
}

// --- ワーカー振込設定 ---

export async function getWorkerPaymentSettings(
  db: D1Database,
  friendId: string,
): Promise<WorkerPaymentSettings | null> {
  return db.prepare(
    `SELECT * FROM worker_payment_settings WHERE friend_id = ?`
  ).bind(friendId).first<WorkerPaymentSettings>();
}

export async function upsertWorkerPaymentSettings(
  db: D1Database,
  friendId: string,
  input: {
    defaultPaymentMethod?: 'spot' | 'monthly';
    bankName?: string;
    branchName?: string;
    accountType?: string;
    accountNumber?: string;
    accountHolder?: string;
  },
): Promise<WorkerPaymentSettings> {
  const now = jstNow();
  const existing = await getWorkerPaymentSettings(db, friendId);

  if (existing) {
    await db.prepare(`
      UPDATE worker_payment_settings SET
        default_payment_method = COALESCE(?, default_payment_method),
        bank_name = COALESCE(?, bank_name),
        branch_name = COALESCE(?, branch_name),
        account_type = COALESCE(?, account_type),
        account_number = COALESCE(?, account_number),
        account_holder = COALESCE(?, account_holder),
        updated_at = ?
      WHERE friend_id = ?
    `).bind(
      input.defaultPaymentMethod ?? null,
      input.bankName ?? null,
      input.branchName ?? null,
      input.accountType ?? null,
      input.accountNumber ?? null,
      input.accountHolder ?? null,
      now, friendId,
    ).run();
    return (await getWorkerPaymentSettings(db, friendId))!;
  }

  const id = crypto.randomUUID();
  await db.prepare(`
    INSERT INTO worker_payment_settings (
      id, friend_id, default_payment_method,
      bank_name, branch_name, account_type, account_number, account_holder,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id, friendId, input.defaultPaymentMethod || 'monthly',
    input.bankName ?? null, input.branchName ?? null,
    input.accountType ?? null, input.accountNumber ?? null,
    input.accountHolder ?? null, now, now,
  ).run();
  return (await getWorkerPaymentSettings(db, friendId))!;
}
