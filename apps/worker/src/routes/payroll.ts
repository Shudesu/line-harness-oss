import { Hono } from 'hono';
import {
  getPayrollByFriendId,
  getPayrollSummary,
  getPayrollByBookingId,
  createPayrollRecord,
  updatePayrollStatus,
  updatePayrollMethod,
  getWorkerPaymentSettings,
  upsertWorkerPaymentSettings,
  getJobById,
  getFriendById,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { assertOwnFriendId } from '../middleware/liff-auth.js';

const payroll = new Hono<Env>();

// ========== 管理者向け: 全ワーカーの報酬一覧（API_KEY認証） ==========

payroll.get('/api/payroll/admin/list', async (c) => {
  try {
    const status = c.req.query('status');
    let sql = `SELECT p.*, f.display_name as friend_display_name FROM payroll_records p LEFT JOIN friends f ON f.id = p.friend_id`;
    const binds: unknown[] = [];

    if (status && ['pending', 'processing', 'paid'].includes(status)) {
      sql += ` WHERE p.payment_status = ?`;
      binds.push(status);
    }
    sql += ` ORDER BY p.work_date DESC, p.created_at DESC LIMIT 200`;

    const stmt = c.env.DB.prepare(sql);
    const result = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all();

    return c.json({
      success: true,
      data: result.results.map((r: Record<string, unknown>) => ({
        id: r.id,
        friendId: r.friend_id,
        friendDisplayName: r.friend_display_name || '',
        workDate: r.work_date,
        nurseryName: r.nursery_name,
        startTime: r.start_time,
        endTime: r.end_time,
        actualHours: r.actual_hours,
        hourlyRate: r.hourly_rate,
        grossAmount: r.gross_amount,
        transportFee: r.transport_fee,
        withholdingTax: r.withholding_tax,
        netAmount: r.net_amount,
        paymentMethod: r.payment_method,
        paymentStatus: r.payment_status,
        paidAt: r.paid_at,
      })),
    });
  } catch (err) {
    console.error('GET /api/payroll/admin/list error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== ワーカー向け: 報酬明細一覧（LIFF認証） ==========

payroll.get('/api/payroll/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const fromDate = c.req.query('fromDate');
    const toDate = c.req.query('toDate');
    const status = c.req.query('status');

    const records = await getPayrollByFriendId(c.env.DB, friendId, { status, fromDate, toDate });
    const summary = await getPayrollSummary(c.env.DB, friendId);

    return c.json({
      success: true,
      data: {
        records: records.map((r) => ({
          id: r.id,
          workDate: r.work_date,
          nurseryName: r.nursery_name,
          startTime: r.start_time,
          endTime: r.end_time,
          actualHours: r.actual_hours,
          hourlyRate: r.hourly_rate,
          grossAmount: r.gross_amount,
          transportFee: r.transport_fee,
          withholdingTax: r.withholding_tax,
          netAmount: r.net_amount,
          paymentMethod: r.payment_method,
          paymentStatus: r.payment_status,
          paidAt: r.paid_at,
        })),
        summary: {
          totalGross: summary.totalGross,
          totalTransport: summary.totalTransport,
          totalWithholding: summary.totalWithholding,
          totalNet: summary.totalNet,
          totalPaid: summary.totalPaid,
          totalPending: summary.totalPending,
          recordCount: summary.recordCount,
        },
      },
    });
  } catch (err) {
    console.error('GET /api/payroll/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 管理者向け: 報酬レコード作成（チェックアウト時に自動実行） ==========

payroll.post('/api/payroll', async (c) => {
  try {
    const body = await c.req.json<{
      friendId: string;
      bookingId: string;
      jobId: string;
      transportFee?: number;
      paymentMethod?: 'spot' | 'monthly';
    }>();

    if (!body.friendId || !body.bookingId || !body.jobId) {
      return c.json({ success: false, error: 'friendId, bookingId, jobId are required' }, 400);
    }

    // 重複チェック
    const existing = await getPayrollByBookingId(c.env.DB, body.bookingId);
    if (existing) {
      return c.json({ success: true, data: existing, message: 'Already exists' });
    }

    // 求人情報取得
    const job = await getJobById(c.env.DB, body.jobId);
    if (!job) return c.json({ success: false, error: 'Job not found' }, 404);

    // 予約情報から実働時間取得
    const booking = await c.env.DB.prepare(
      `SELECT actual_hours FROM calendar_bookings WHERE id = ?`
    ).bind(body.bookingId).first<{ actual_hours: number | null }>();

    const record = await createPayrollRecord(c.env.DB, {
      friendId: body.friendId,
      bookingId: body.bookingId,
      jobId: body.jobId,
      nurseryName: job.nursery_name,
      workDate: job.work_date,
      startTime: job.start_time,
      endTime: job.end_time,
      actualHours: booking?.actual_hours ?? null,
      hourlyRate: job.hourly_rate || 0,
      transportFee: body.transportFee,
      paymentMethod: body.paymentMethod,
    });

    return c.json({ success: true, data: record }, 201);
  } catch (err) {
    console.error('POST /api/payroll error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 管理者向け: 支払いステータス更新 ==========

payroll.put('/api/payroll/:id/status', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ status: 'processing' | 'paid' }>();
    if (!body.status || !['processing', 'paid'].includes(body.status)) {
      return c.json({ success: false, error: 'status must be processing or paid' }, 400);
    }
    await updatePayrollStatus(c.env.DB, id, body.status);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/payroll/:id/status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== ワーカー向け: 振込方法変更（LIFF認証） ==========

payroll.put('/api/payroll/:id/method', async (c) => {
  try {
    const id = c.req.param('id');
    const body = await c.req.json<{ method: 'spot' | 'monthly' }>();
    if (!body.method || !['spot', 'monthly'].includes(body.method)) {
      return c.json({ success: false, error: 'method must be spot or monthly' }, 400);
    }
    await updatePayrollMethod(c.env.DB, id, body.method);
    return c.json({ success: true });
  } catch (err) {
    console.error('PUT /api/payroll/:id/method error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== ワーカー向け: 振込設定（LIFF認証） ==========

payroll.get('/api/payment-settings/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const settings = await getWorkerPaymentSettings(c.env.DB, friendId);
    return c.json({ success: true, data: settings });
  } catch (err) {
    console.error('GET /api/payment-settings/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

payroll.put('/api/payment-settings/:friendId', async (c) => {
  try {
    const friendId = c.req.param('friendId');
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }
    const body = await c.req.json<{
      defaultPaymentMethod?: 'spot' | 'monthly';
      bankName?: string;
      branchName?: string;
      accountType?: string;
      accountNumber?: string;
      accountHolder?: string;
    }>();
    const settings = await upsertWorkerPaymentSettings(c.env.DB, friendId, body);
    return c.json({ success: true, data: settings });
  } catch (err) {
    console.error('PUT /api/payment-settings/:friendId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { payroll };
