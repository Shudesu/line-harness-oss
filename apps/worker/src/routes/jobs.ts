import { Hono } from 'hono';
import {
  getJobs,
  getJobById,
  createJob,
  createJobsBatch,
  updateJobStatus,
  updateJob,
  getJobBookingCount,
  getCalendarBookingById,
  approveBooking,
  denyBooking,
  getPendingBookings,
  getFriendById,
} from '@line-crm/db';
import { LineClient } from '@line-crm/line-sdk';
import type { Env } from '../index.js';

const jobs = new Hono<Env>();

// ========== 求人一覧（公開: LIFF用） ==========

jobs.get('/api/jobs', async (c) => {
  try {
    const status = c.req.query('status') ?? 'open';
    const fromDate = c.req.query('fromDate');
    const connectionId = c.req.query('connectionId');
    const items = await getJobs(c.env.DB, {
      status: status || undefined,
      fromDate: fromDate || undefined,
      connectionId: connectionId || undefined,
    });

    // 各求人の残り枠数を一括で計算（N+1回避）
    const bookingCountMap = new Map<string, number>();
    if (items.length > 0) {
      const placeholders = items.map(() => '?').join(',');
      const countResult = await c.env.DB
        .prepare(
          `SELECT job_id, COUNT(*) as cnt FROM calendar_bookings
           WHERE job_id IN (${placeholders}) AND status != 'cancelled'
           GROUP BY job_id`,
        )
        .bind(...items.map(j => j.id))
        .all<{ job_id: string; cnt: number }>();
      for (const row of countResult.results) {
        bookingCountMap.set(row.job_id, row.cnt);
      }
    }

    const data = items.map((job) => {
      const booked = bookingCountMap.get(job.id) ?? 0;
      return {
        id: job.id,
        nurseryName: job.nursery_name,
        address: job.address,
        station: job.station,
        hourlyRate: job.hourly_rate,
        description: job.description,
        requirements: job.requirements,
        capacity: job.capacity,
        remainingSlots: Math.max(0, job.capacity - booked),
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
        status: job.status,
        metadata: job.metadata ? JSON.parse(job.metadata) : null,
        createdAt: job.created_at,
      };
    });

    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/jobs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人詳細（公開: LIFF用） ==========

jobs.get('/api/jobs/:id', async (c) => {
  try {
    const job = await getJobById(c.env.DB, c.req.param('id'));
    if (!job) return c.json({ success: false, error: 'Job not found' }, 404);

    const booked = await getJobBookingCount(c.env.DB, job.id);

    return c.json({
      success: true,
      data: {
        id: job.id,
        nurseryName: job.nursery_name,
        address: job.address,
        station: job.station,
        hourlyRate: job.hourly_rate,
        description: job.description,
        requirements: job.requirements,
        capacity: job.capacity,
        remainingSlots: Math.max(0, job.capacity - booked),
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
        status: job.status,
        metadata: job.metadata ? JSON.parse(job.metadata) : null,
        createdAt: job.created_at,
      },
    });
  } catch (err) {
    console.error('GET /api/jobs/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人作成（管理: API_KEY認証） ==========

jobs.post('/api/jobs', async (c) => {
  try {
    const body = await c.req.json<{
      connectionId: string;
      nurseryName: string;
      address?: string;
      station?: string;
      hourlyRate?: number;
      description?: string;
      requirements?: string;
      capacity?: number;
      workDate: string;
      startTime: string;
      endTime: string;
      metadata?: Record<string, unknown>;
    }>();

    if (!body.connectionId || !body.nurseryName || !body.workDate || !body.startTime || !body.endTime) {
      return c.json({ success: false, error: 'connectionId, nurseryName, workDate, startTime, endTime are required' }, 400);
    }

    const job = await createJob(c.env.DB, {
      ...body,
      metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
    });

    return c.json({
      success: true,
      data: {
        id: job.id,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
        status: job.status,
        createdAt: job.created_at,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/jobs error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人一括作成（管理: API_KEY認証） ==========

jobs.post('/api/jobs/batch', async (c) => {
  try {
    const body = await c.req.json<{
      jobs: Array<{
        connectionId: string;
        nurseryName: string;
        address?: string;
        station?: string;
        hourlyRate?: number;
        description?: string;
        requirements?: string;
        capacity?: number;
        workDate: string;
        startTime: string;
        endTime: string;
        metadata?: Record<string, unknown>;
      }>;
    }>();

    if (!body.jobs || !Array.isArray(body.jobs) || body.jobs.length === 0) {
      return c.json({ success: false, error: 'jobs array is required' }, 400);
    }

    const inputs = body.jobs.map((j) => ({
      ...j,
      metadata: j.metadata ? JSON.stringify(j.metadata) : undefined,
    }));

    const created = await createJobsBatch(c.env.DB, inputs);

    return c.json({
      success: true,
      data: created.map((job) => ({
        id: job.id,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
      })),
      count: created.length,
    }, 201);
  } catch (err) {
    console.error('POST /api/jobs/batch error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人ステータス更新（管理: API_KEY認証） ==========

jobs.put('/api/jobs/:id/status', async (c) => {
  try {
    const { status } = await c.req.json<{ status: string }>();
    if (!['open', 'filled', 'cancelled', 'completed'].includes(status)) {
      return c.json({ success: false, error: 'Invalid status' }, 400);
    }
    await updateJobStatus(c.env.DB, c.req.param('id'), status);
    return c.json({ success: true, data: null });
  } catch (err) {
    console.error('PUT /api/jobs/:id/status error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人更新（管理: API_KEY認証） ==========

jobs.put('/api/jobs/:id', async (c) => {
  try {
    const body = await c.req.json();
    const updated = await updateJob(c.env.DB, c.req.param('id'), {
      nurseryName: body.nurseryName,
      address: body.address,
      station: body.station,
      hourlyRate: body.hourlyRate,
      description: body.description,
      requirements: body.requirements,
      capacity: body.capacity,
      workDate: body.workDate,
      startTime: body.startTime,
      endTime: body.endTime,
      metadata: body.metadata ? JSON.stringify(body.metadata) : undefined,
    });
    if (!updated) return c.json({ success: false, error: 'Job not found' }, 404);
    return c.json({ success: true, data: { id: updated.id } });
  } catch (err) {
    console.error('PUT /api/jobs/:id error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 求人予約（公開: LIFF用） ==========

jobs.post('/api/jobs/:id/book', async (c) => {
  try {
    const jobId = c.req.param('id');
    const job = await getJobById(c.env.DB, jobId);
    if (!job) return c.json({ success: false, error: 'Job not found' }, 404);
    if (job.status !== 'open') return c.json({ success: false, error: 'Job is not available' }, 400);

    // capacity チェック
    const booked = await getJobBookingCount(c.env.DB, jobId);
    if (booked >= job.capacity) {
      return c.json({ success: false, error: 'No remaining slots' }, 400);
    }

    const body = await c.req.json<{ friendId?: string; displayName?: string }>();

    // 信用スコアチェック（0以下は応募不可）
    if (body.friendId) {
      const { getCreditScore } = await import('@line-crm/db');
      const score = await getCreditScore(c.env.DB, body.friendId);
      if (score.credit_score <= 0) {
        return c.json({
          success: false,
          error: 'キャンセルが多いため、現在応募が制限されています。運営にお問い合わせください。',
        }, 403);
      }
    }

    // calendar_bookings に予約レコード作成（job_id 紐付き）
    const { createCalendarBooking } = await import('@line-crm/db');
    const startAt = `${job.work_date}T${job.start_time}:00+09:00`;
    const endAt = `${job.work_date}T${job.end_time}:00+09:00`;

    const booking = await createCalendarBooking(c.env.DB, {
      connectionId: job.connection_id,
      friendId: body.friendId,
      title: `${body.displayName ?? '保育士'}様 - ${job.nursery_name}`,
      startAt,
      endAt,
      metadata: JSON.stringify({ jobId, nurseryName: job.nursery_name }),
    });

    // job_id と approval_status を calendar_bookings に書き込む
    await c.env.DB
      .prepare('UPDATE calendar_bookings SET job_id = ?, approval_status = ? WHERE id = ?')
      .bind(jobId, 'pending', booking.id)
      .run();

    // 楽観的ロック: INSERT後に再カウントし、capacity超過なら予約を取り消す
    const recount = await getJobBookingCount(c.env.DB, jobId);
    if (recount > job.capacity) {
      await c.env.DB
        .prepare("UPDATE calendar_bookings SET status = 'cancelled' WHERE id = ?")
        .bind(booking.id)
        .run();
      return c.json({ success: false, error: 'No remaining slots' }, 400);
    }

    // capacity 到達で自動クローズ
    if (recount >= job.capacity) {
      await updateJobStatus(c.env.DB, jobId, 'filled');
    }

    // ========== 応募完了LINEメッセージ送信 ==========
    if (body.friendId) {
      try {
        const { getFriendById } = await import('@line-crm/db');
        const friend = await getFriendById(c.env.DB, body.friendId);
        if (friend?.line_user_id) {
          const { LineClient } = await import('@line-crm/line-sdk');
          const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);

          // 日付フォーマット
          const d = new Date(job.work_date + 'T00:00:00');
          const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
          const dateStr = `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;

          await lineClient.pushMessage(friend.line_user_id, [
            {
              type: 'text',
              text: `✅ ご応募ありがとうございます！\n\n📍 ${job.nursery_name}\n📅 ${dateStr}\n⏰ ${job.start_time}〜${job.end_time}\n\nただいま担当者が確認中です。\n採用が決定しましたら、こちらのLINEでご連絡いたします。`,
            },
          ]);
        }
      } catch (lineErr) {
        // LINE送信失敗は応募自体を失敗させない
        console.error('LINE push message error:', lineErr);
      }
    }

    // ========== 管理者への承認依頼通知 ==========
    if (c.env.ADMIN_LINE_USER_ID) {
      try {
        const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
        const d = new Date(job.work_date + 'T00:00:00');
        const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
        const dateStr = `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]})`;

        // プロフィール情報を取得
        let applicantName = body.displayName ?? '保育士';
        let qualType = '';
        if (body.friendId) {
          const { getProfileByFriendId } = await import('@line-crm/db');
          const profile = await getProfileByFriendId(c.env.DB, body.friendId);
          if (profile) {
            applicantName = profile.real_name || applicantName;
            qualType = profile.qualification_type ? `（${profile.qualification_type}）` : '';
          }
        }

        const workerUrl = c.env.WORKER_URL || 'https://line-crm-worker.spothoiku-test.workers.dev';
        const adminUrl = `${workerUrl.replace('line-crm-worker', 'spothoiku-liff').replace('workers.dev', 'pages.dev')}?page=admin`;

        await lineClient.pushMessage(c.env.ADMIN_LINE_USER_ID, [
          {
            type: 'text',
            text: `📋 新しい応募が届きました！\n\n👤 ${applicantName}${qualType}\n📍 ${job.nursery_name}\n📅 ${dateStr} ${job.start_time}〜${job.end_time}\n\n管理画面で承認/否認してください:\n${adminUrl}`,
          },
        ]);
      } catch (adminErr) {
        console.error('Admin LINE notification error:', adminErr);
      }
    }

    return c.json({
      success: true,
      data: {
        bookingId: booking.id,
        jobId,
        nurseryName: job.nursery_name,
        workDate: job.work_date,
        startTime: job.start_time,
        endTime: job.end_time,
      },
    }, 201);
  } catch (err) {
    console.error('POST /api/jobs/:id/book error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 承認待ち応募一覧（管理: API_KEY認証） ==========

jobs.get('/api/bookings/pending', async (c) => {
  try {
    const bookings = await getPendingBookings(c.env.DB);
    // Enrich with job info and friend display name
    const data = await Promise.all(
      bookings.map(async (b) => {
        const meta = b.metadata ? JSON.parse(b.metadata) : null;
        const jobId = b.job_id || meta?.jobId;
        let nurseryName = meta?.nurseryName || '';
        let workDate = '';
        let startTime = '';
        let endTime = '';
        let hourlyRate: number | null = null;

        if (jobId) {
          const job = await getJobById(c.env.DB, jobId);
          if (job) {
            nurseryName = job.nursery_name;
            workDate = job.work_date;
            startTime = job.start_time;
            endTime = job.end_time;
            hourlyRate = job.hourly_rate;
          }
        }

        let displayName = '';
        if (b.friend_id) {
          const friend = await getFriendById(c.env.DB, b.friend_id);
          displayName = friend?.display_name || '';
        }

        // プロフィール取得
        let profile = null;
        if (b.friend_id) {
          const { getProfileByFriendId } = await import('@line-crm/db');
          profile = await getProfileByFriendId(c.env.DB, b.friend_id);
        }

        return {
          id: b.id,
          friendId: b.friend_id,
          displayName,
          nurseryName,
          workDate,
          startTime,
          endTime,
          hourlyRate,
          approvalStatus: b.approval_status,
          createdAt: b.created_at,
          profile: profile ? {
            realName: profile.real_name,
            realNameKana: profile.real_name_kana,
            phone: profile.phone,
            qualificationType: profile.qualification_type,
            experienceYears: (profile as Record<string, unknown>).experience_years,
          } : null,
        };
      }),
    );
    return c.json({ success: true, data });
  } catch (err) {
    console.error('GET /api/bookings/pending error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 応募承認（管理: API_KEY認証） ==========

jobs.post('/api/bookings/:id/approve', async (c) => {
  try {
    const bookingId = c.req.param('id');
    const body = await c.req.json<{ note?: string }>().catch(() => ({}));

    const booking = await getCalendarBookingById(c.env.DB, bookingId);
    if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);
    if (booking.approval_status === 'approved') {
      return c.json({ success: false, error: 'Already approved' }, 400);
    }

    await approveBooking(c.env.DB, bookingId, (body as { note?: string }).note);

    // LINE通知: 承認メッセージを応募者に送信
    if (booking.friend_id) {
      try {
        const friend = await getFriendById(c.env.DB, booking.friend_id);
        if (friend?.line_user_id) {
          const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
          const meta = booking.metadata ? JSON.parse(booking.metadata) : null;
          const jobId = booking.job_id || meta?.jobId;
          let nurseryName = meta?.nurseryName || '';
          let dateStr = '';

          if (jobId) {
            const job = await getJobById(c.env.DB, jobId);
            if (job) {
              nurseryName = job.nursery_name;
              const d = new Date(job.work_date + 'T00:00:00');
              const weekdays = ['日', '月', '火', '水', '木', '金', '土'];
              dateStr = `${d.getMonth() + 1}月${d.getDate()}日(${weekdays[d.getDay()]}) ${job.start_time}〜${job.end_time}`;
            }
          }

          await lineClient.pushMessage(friend.line_user_id, [
            {
              type: 'text',
              text: `🎉 採用が決定しました！\n\n📍 ${nurseryName}\n📅 ${dateStr}\n\nご応募ありがとうございます。当日はよろしくお願いいたします。\n\n【持ち物】\n上記は目安です。当園で2回目以降の勤務では不要です。\n・筆記具\n・動きやすい服装\n・上履き\n・エプロン\n\n※体調がすぐれない場合はお早めにご連絡ください。`,
            },
          ]);
        }
      } catch (lineErr) {
        console.error('LINE approval notification error:', lineErr);
      }
    }

    return c.json({ success: true, data: { bookingId, approvalStatus: 'approved' } });
  } catch (err) {
    console.error('POST /api/bookings/:id/approve error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

// ========== 応募否認（管理: API_KEY認証） ==========

jobs.post('/api/bookings/:id/deny', async (c) => {
  try {
    const bookingId = c.req.param('id');
    const body = await c.req.json<{ note?: string }>().catch(() => ({}));

    const booking = await getCalendarBookingById(c.env.DB, bookingId);
    if (!booking) return c.json({ success: false, error: 'Booking not found' }, 404);
    if (booking.approval_status === 'denied') {
      return c.json({ success: false, error: 'Already denied' }, 400);
    }

    await denyBooking(c.env.DB, bookingId, (body as { note?: string }).note);

    // 否認時: capacity解放（filledだった場合にopenに戻す）
    const meta = booking.metadata ? JSON.parse(booking.metadata) : null;
    const jobId = booking.job_id || meta?.jobId;
    if (jobId) {
      const job = await getJobById(c.env.DB, jobId);
      if (job && job.status === 'filled') {
        await updateJobStatus(c.env.DB, jobId, 'open');
      }
    }

    // LINE通知: 否認メッセージを応募者に送信
    if (booking.friend_id) {
      try {
        const friend = await getFriendById(c.env.DB, booking.friend_id);
        if (friend?.line_user_id) {
          const lineClient = new LineClient(c.env.LINE_CHANNEL_ACCESS_TOKEN);
          const nurseryName = meta?.nurseryName || '';

          await lineClient.pushMessage(friend.line_user_id, [
            {
              type: 'text',
              text: `${nurseryName}へのご応募について\n\n大変申し訳ございませんが、今回はご希望に添えない結果となりました。\n\nまた別の日程やお仕事でお会いできることを楽しみにしております。\n引き続き、スポットほいくをよろしくお願いいたします。`,
            },
          ]);
        }
      } catch (lineErr) {
        console.error('LINE deny notification error:', lineErr);
      }
    }

    return c.json({ success: true, data: { bookingId, approvalStatus: 'denied' } });
  } catch (err) {
    console.error('POST /api/bookings/:id/deny error:', err);
    return c.json({ success: false, error: 'Internal server error' }, 500);
  }
});

export { jobs };
