import { Hono } from 'hono';
import {
  getOrCreateAttendanceToken,
  getJobByAttendanceToken,
  getBookingForAttendance,
  checkIn,
  checkOut,
  getAttendanceByJob,
  getJobById,
  getFriendById,
} from '@line-crm/db';
import type { Env } from '../index.js';
import { assertOwnFriendId } from '../middleware/liff-auth.js';

const attendance = new Hono<Env>();

// ========== QRコード用トークン取得（管理: API_KEY認証） ==========
// 園がQRコードを表示するためにトークンを取得する

attendance.get('/api/attendance/qr/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const job = await getJobById(c.env.DB, jobId);
    if (!job) return c.json({ success: false, error: 'Job not found' }, 404);

    const token = await getOrCreateAttendanceToken(c.env.DB, jobId);
    const liffUrl = c.env.LIFF_URL || 'https://liff.line.me/2009592890-7BIHHO5p';
    const checkinUrl = `${liffUrl}?page=checkin&token=${token}`;

    return c.json({
      success: true,
      data: {
        jobId,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
        token,
        checkinUrl,
      },
    });
  } catch (err) {
    console.error('GET /api/attendance/qr/:jobId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チェックイン（公開: LIFF用） ==========
// ワーカーがQRコードをスキャンしてチェックイン

attendance.post('/api/attendance/checkin', async (c) => {
  try {
    const { token, friendId } = await c.req.json<{ token: string; friendId: string }>();
    if (!token || !friendId) {
      return c.json({ success: false, error: 'token and friendId are required' }, 400);
    }

    // LIFF認証時は自分のfriendIdのみ
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    // トークンから求人を特定
    const job = await getJobByAttendanceToken(c.env.DB, token);
    if (!job) return c.json({ success: false, error: 'Invalid attendance token' }, 404);

    // この求人に対する承認済み予約を探す
    const booking = await getBookingForAttendance(c.env.DB, job.id, friendId);
    if (!booking) {
      return c.json({ success: false, error: 'No approved booking found for this job' }, 404);
    }

    if (booking.approval_status !== 'approved') {
      return c.json({ success: false, error: 'Booking is not approved yet' }, 400);
    }

    if (booking.check_in_at) {
      return c.json({
        success: false,
        error: 'Already checked in',
        data: { check_in_at: booking.check_in_at },
      }, 400);
    }

    const result = await checkIn(c.env.DB, booking.booking_id);

    return c.json({
      success: true,
      data: {
        bookingId: booking.booking_id,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
        checkInAt: result.check_in_at,
      },
    });
  } catch (err) {
    console.error('POST /api/attendance/checkin error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== チェックアウト（公開: LIFF用） ==========

attendance.post('/api/attendance/checkout', async (c) => {
  try {
    const { token, friendId } = await c.req.json<{ token: string; friendId: string }>();
    if (!token || !friendId) {
      return c.json({ success: false, error: 'token and friendId are required' }, 400);
    }

    // LIFF認証時は自分のfriendIdのみ
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const job = await getJobByAttendanceToken(c.env.DB, token);
    if (!job) return c.json({ success: false, error: 'Invalid attendance token' }, 404);

    const booking = await getBookingForAttendance(c.env.DB, job.id, friendId);
    if (!booking) {
      return c.json({ success: false, error: 'No booking found for this job' }, 404);
    }

    if (!booking.check_in_at) {
      return c.json({ success: false, error: 'Not checked in yet' }, 400);
    }

    if (booking.check_out_at) {
      return c.json({
        success: false,
        error: 'Already checked out',
        data: { check_out_at: booking.check_out_at, actual_hours: booking.actual_hours },
      }, 400);
    }

    const result = await checkOut(c.env.DB, booking.booking_id);

    return c.json({
      success: true,
      data: {
        bookingId: booking.booking_id,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        checkInAt: booking.check_in_at,
        checkOutAt: result.check_out_at,
        actualHours: result.actual_hours,
      },
    });
  } catch (err) {
    console.error('POST /api/attendance/checkout error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 勤怠ステータス確認（公開: LIFF用） ==========

attendance.get('/api/attendance/status', async (c) => {
  try {
    const token = c.req.query('token');
    const friendId = c.req.query('friendId');
    if (!token || !friendId) {
      return c.json({ success: false, error: 'token and friendId are required' }, 400);
    }

    // LIFF認証時は自分のfriendIdのみ
    if (c.get('liffFriendId') && !assertOwnFriendId(c, friendId)) {
      return c.json({ success: false, error: 'Access denied' }, 403);
    }

    const job = await getJobByAttendanceToken(c.env.DB, token);
    if (!job) return c.json({ success: false, error: 'Invalid attendance token' }, 404);

    const booking = await getBookingForAttendance(c.env.DB, job.id, friendId);

    return c.json({
      success: true,
      data: {
        jobId: job.id,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
        booking: booking
          ? {
              bookingId: booking.booking_id,
              approvalStatus: booking.approval_status,
              checkInAt: booking.check_in_at,
              checkOutAt: booking.check_out_at,
              actualHours: booking.actual_hours,
            }
          : null,
      },
    });
  } catch (err) {
    console.error('GET /api/attendance/status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人の勤怠一覧（管理: API_KEY認証） ==========

attendance.get('/api/attendance/job/:jobId', async (c) => {
  try {
    const jobId = c.req.param('jobId');
    const records = await getAttendanceByJob(c.env.DB, jobId);

    // friend の表示名を付与
    const data = await Promise.all(
      records.map(async (r) => {
        let displayName = '';
        if (r.friend_id) {
          const friend = await getFriendById(c.env.DB, r.friend_id);
          displayName = friend?.display_name || '';
        }
        return {
          bookingId: r.booking_id,
          friendId: r.friend_id,
          displayName,
          approvalStatus: r.approval_status,
          checkInAt: r.check_in_at,
          checkOutAt: r.check_out_at,
          actualHours: r.actual_hours,
        };
      }),
    );

    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/attendance/job/:jobId error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { attendance };
