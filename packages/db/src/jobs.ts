import { jstNow } from './utils.js';

// 求人（Jobs）クエリヘルパー

export interface JobRow {
  id: string;
  connection_id: string;
  nursery_name: string;
  address: string | null;
  station: string | null;
  hourly_rate: number | null;
  description: string | null;
  requirements: string | null;
  capacity: number;
  work_date: string;
  start_time: string;
  end_time: string;
  status: string;
  metadata: string | null;
  created_at: string;
  updated_at: string;
}

export interface CreateJobInput {
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
  metadata?: string;
}

// --- 求人一覧 ---

export async function getJobs(
  db: D1Database,
  opts: { status?: string; fromDate?: string; connectionId?: string } = {},
): Promise<JobRow[]> {
  let sql = 'SELECT * FROM jobs WHERE 1=1';
  const binds: unknown[] = [];

  if (opts.status) {
    sql += ' AND status = ?';
    binds.push(opts.status);
  }
  if (opts.fromDate) {
    sql += ' AND work_date >= ?';
    binds.push(opts.fromDate);
  }
  if (opts.connectionId) {
    sql += ' AND connection_id = ?';
    binds.push(opts.connectionId);
  }

  sql += ' ORDER BY work_date ASC, start_time ASC';

  const stmt = db.prepare(sql);
  const result = await (binds.length > 0 ? stmt.bind(...binds) : stmt).all<JobRow>();
  return result.results;
}

export async function getJobById(db: D1Database, id: string): Promise<JobRow | null> {
  return db.prepare('SELECT * FROM jobs WHERE id = ?').bind(id).first<JobRow>();
}

// --- 求人作成 ---

export async function createJob(db: D1Database, input: CreateJobInput): Promise<JobRow> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare(
      `INSERT INTO jobs (id, connection_id, nursery_name, address, station, hourly_rate, description, requirements, capacity, work_date, start_time, end_time, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .bind(
      id,
      input.connectionId,
      input.nurseryName,
      input.address ?? null,
      input.station ?? null,
      input.hourlyRate ?? null,
      input.description ?? null,
      input.requirements ?? null,
      input.capacity ?? 1,
      input.workDate,
      input.startTime,
      input.endTime,
      input.metadata ?? null,
      now,
      now,
    )
    .run();
  return (await getJobById(db, id))!;
}

// --- 求人一括作成 ---

export async function createJobsBatch(db: D1Database, inputs: CreateJobInput[]): Promise<JobRow[]> {
  const jobs: JobRow[] = [];
  for (const input of inputs) {
    jobs.push(await createJob(db, input));
  }
  return jobs;
}

// --- 求人ステータス更新 ---

export async function updateJobStatus(db: D1Database, id: string, status: string): Promise<void> {
  await db
    .prepare('UPDATE jobs SET status = ?, updated_at = ? WHERE id = ?')
    .bind(status, jstNow(), id)
    .run();
}

// --- 求人の予約数を取得（capacity チェック用）---

export async function getJobBookingCount(db: D1Database, jobId: string): Promise<number> {
  const result = await db
    .prepare("SELECT COUNT(*) as cnt FROM calendar_bookings WHERE job_id = ? AND status != 'cancelled'")
    .bind(jobId)
    .first<{ cnt: number }>();
  return result?.cnt ?? 0;
}

// --- 求人更新 ---

export async function updateJob(
  db: D1Database,
  id: string,
  input: Partial<Omit<CreateJobInput, 'connectionId'>>,
): Promise<JobRow | null> {
  const sets: string[] = [];
  const binds: unknown[] = [];

  if (input.nurseryName !== undefined) { sets.push('nursery_name = ?'); binds.push(input.nurseryName); }
  if (input.address !== undefined) { sets.push('address = ?'); binds.push(input.address); }
  if (input.station !== undefined) { sets.push('station = ?'); binds.push(input.station); }
  if (input.hourlyRate !== undefined) { sets.push('hourly_rate = ?'); binds.push(input.hourlyRate); }
  if (input.description !== undefined) { sets.push('description = ?'); binds.push(input.description); }
  if (input.requirements !== undefined) { sets.push('requirements = ?'); binds.push(input.requirements); }
  if (input.capacity !== undefined) { sets.push('capacity = ?'); binds.push(input.capacity); }
  if (input.workDate !== undefined) { sets.push('work_date = ?'); binds.push(input.workDate); }
  if (input.startTime !== undefined) { sets.push('start_time = ?'); binds.push(input.startTime); }
  if (input.endTime !== undefined) { sets.push('end_time = ?'); binds.push(input.endTime); }
  if (input.metadata !== undefined) { sets.push('metadata = ?'); binds.push(input.metadata); }

  if (sets.length === 0) return getJobById(db, id);

  sets.push('updated_at = ?');
  binds.push(jstNow());
  binds.push(id);

  await db.prepare(`UPDATE jobs SET ${sets.join(', ')} WHERE id = ?`).bind(...binds).run();
  return getJobById(db, id);
}
