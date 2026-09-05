import { getAccountSetting, jstNow, setAccountSetting } from '@line-crm/db';

const LINE_USER_ID_PATTERN = /^U[0-9a-f]{32}$/;
const LOOKUP_CHUNK_SIZE = 90;
const WRITE_CHUNK_SIZE = 100;
const PROFILE_BATCH_SIZE = 25;
export const FOLLOWER_IMPORT_STATE_KEY = 'follower_import_v1';

export interface FollowerImportClient {
  getFollowerIds(limit: number, start?: string): Promise<{
    userIds: string[];
    next?: string;
  }>;
  getProfile(userId: string): Promise<{
    displayName?: string;
    pictureUrl?: string;
    statusMessage?: string;
  }>;
}

export type FollowerImportCapability = 'unknown' | 'available' | 'unavailable';
export type FollowerImportPhase =
  | 'not_started'
  | 'importing_ids'
  | 'hydrating_profiles'
  | 'completed';

export interface FollowerImportState {
  version: 1;
  capability: FollowerImportCapability;
  phase: FollowerImportPhase;
  eligibilityCheckedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
  cursor: string | null;
  profileCursor: string | null;
  received: number;
  imported: number;
  reactivated: number;
  claimedUnassigned: number;
  alreadyPresent: number;
  conflicts: number;
  invalid: number;
  profilesProcessed: number;
  profilesUpdated: number;
  profileErrors: number;
  lastError: string | null;
  lockToken?: string | null;
  lockUntil?: string | null;
}

interface ExistingFriend {
  line_user_id: string;
  line_account_id: string | null;
  is_following: number;
}

function chunks<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size));
  return result;
}

export function emptyFollowerImportState(): FollowerImportState {
  return {
    version: 1,
    capability: 'unknown',
    phase: 'not_started',
    eligibilityCheckedAt: null,
    startedAt: null,
    completedAt: null,
    updatedAt: jstNow(),
    cursor: null,
    profileCursor: null,
    received: 0,
    imported: 0,
    reactivated: 0,
    claimedUnassigned: 0,
    alreadyPresent: 0,
    conflicts: 0,
    invalid: 0,
    profilesProcessed: 0,
    profilesUpdated: 0,
    profileErrors: 0,
    lastError: null,
  };
}

export async function getFollowerImportState(
  db: D1Database,
  lineAccountId: string,
): Promise<FollowerImportState> {
  const raw = await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY);
  if (!raw) return emptyFollowerImportState();
  try {
    return { ...emptyFollowerImportState(), ...JSON.parse(raw) } as FollowerImportState;
  } catch {
    return emptyFollowerImportState();
  }
}

async function saveState(
  db: D1Database,
  lineAccountId: string,
  state: FollowerImportState,
): Promise<void> {
  state.updatedAt = jstNow();
  await setAccountSetting(
    db,
    lineAccountId,
    FOLLOWER_IMPORT_STATE_KEY,
    JSON.stringify(state),
  );
}

/**
 * LINE exposes no account-type field in /v2/bot/info. A one-item, read-only
 * followers request is therefore the authoritative capability probe.
 */
export async function detectFollowerImportCapability(
  db: D1Database,
  client: Pick<FollowerImportClient, 'getFollowerIds'>,
  lineAccountId: string,
): Promise<FollowerImportState> {
  const state = await getFollowerImportState(db, lineAccountId);
  try {
    await client.getFollowerIds(1);
    state.capability = 'available';
    state.lastError = null;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (/LINE API error:\s*403/i.test(message)) {
      state.capability = 'unavailable';
      state.lastError = null;
    } else {
      state.capability = 'unknown';
      state.lastError = '利用可否を確認できませんでした';
    }
  }
  state.eligibilityCheckedAt = jstNow();
  await saveState(db, lineAccountId, state);
  return state;
}

/** Start once or resume an interrupted migration. Completed jobs stay closed. */
export async function startFollowerImport(
  db: D1Database,
  lineAccountId: string,
): Promise<FollowerImportState> {
  const state = await getFollowerImportState(db, lineAccountId);
  if (state.capability !== 'available') {
    throw new Error('FOLLOWER_IMPORT_NOT_AVAILABLE');
  }
  if (state.phase === 'completed') return state;
  if (state.phase === 'not_started') {
    const capability = state.capability;
    const eligibilityCheckedAt = state.eligibilityCheckedAt;
    Object.assign(state, emptyFollowerImportState(), {
      capability,
      eligibilityCheckedAt,
      phase: 'importing_ids' as const,
      startedAt: jstNow(),
    });
  }
  state.lastError = null;
  await saveState(db, lineAccountId, state);
  return state;
}

async function importIdPage(
  db: D1Database,
  client: Pick<FollowerImportClient, 'getFollowerIds'>,
  lineAccountId: string,
  state: FollowerImportState,
): Promise<void> {
  const page = await client.getFollowerIds(1000, state.cursor ?? undefined);
  const receivedIds = Array.isArray(page.userIds) ? page.userIds : [];
  const validIds = [...new Set(receivedIds.filter((id) => LINE_USER_ID_PATTERN.test(id)))];
  const invalid = receivedIds.filter((id) => !LINE_USER_ID_PATTERN.test(id)).length;

  const existingById = new Map<string, ExistingFriend>();
  for (const group of chunks(validIds, LOOKUP_CHUNK_SIZE)) {
    const placeholders = group.map(() => '?').join(',');
    const rows = await db
      .prepare(
        `SELECT line_user_id, line_account_id, is_following
           FROM friends
          WHERE line_user_id IN (${placeholders})`,
      )
      .bind(...group)
      .all<ExistingFriend>();
    for (const row of rows.results ?? []) existingById.set(row.line_user_id, row);
  }

  const writableIds: string[] = [];
  for (const lineUserId of validIds) {
    const existing = existingById.get(lineUserId);
    if (!existing) {
      state.imported += 1;
      writableIds.push(lineUserId);
    } else if (existing.line_account_id === null) {
      state.claimedUnassigned += 1;
      writableIds.push(lineUserId);
    } else if (existing.line_account_id !== lineAccountId) {
      state.conflicts += 1;
    } else if (existing.is_following === 0) {
      state.reactivated += 1;
      writableIds.push(lineUserId);
    } else {
      state.alreadyPresent += 1;
    }
  }

  const now = jstNow();
  for (const group of chunks(writableIds, WRITE_CHUNK_SIZE)) {
    await db.batch(group.map((lineUserId) =>
      db.prepare(
        `INSERT INTO friends
           (id, line_user_id, display_name, picture_url, status_message,
            is_following, line_account_id, created_at, updated_at)
         VALUES (?, ?, NULL, NULL, NULL, 1, ?, ?, ?)
         ON CONFLICT(line_user_id) DO UPDATE SET
           line_account_id = COALESCE(friends.line_account_id, excluded.line_account_id),
           is_following = 1,
           updated_at = excluded.updated_at
         WHERE (friends.line_account_id IS NULL OR friends.line_account_id = excluded.line_account_id)
           AND (friends.line_account_id IS NULL OR friends.is_following != 1)`,
      ).bind(crypto.randomUUID(), lineUserId, lineAccountId, now, now),
    ));
  }

  state.received += receivedIds.length;
  state.invalid += invalid;
  state.cursor = typeof page.next === 'string' && page.next ? page.next : null;
  if (!state.cursor) state.phase = 'hydrating_profiles';
}

async function hydrateProfilePage(
  db: D1Database,
  client: Pick<FollowerImportClient, 'getProfile'>,
  lineAccountId: string,
  state: FollowerImportState,
): Promise<void> {
  const rows = await db.prepare(
    `SELECT id, line_user_id
       FROM friends
      WHERE line_account_id = ?
        AND is_following = 1
        AND display_name IS NULL
        AND id > ?
      ORDER BY id
      LIMIT ?`,
  ).bind(lineAccountId, state.profileCursor ?? '', PROFILE_BATCH_SIZE)
    .all<{ id: string; line_user_id: string }>();
  const batch = rows.results ?? [];

  for (const group of chunks(batch, 5)) {
    await Promise.all(group.map(async (row) => {
      try {
        const profile = await client.getProfile(row.line_user_id);
        await db.prepare(
          `UPDATE friends
              SET display_name = ?, picture_url = ?, status_message = ?, updated_at = ?
            WHERE id = ?`,
        ).bind(
          profile.displayName ?? null,
          profile.pictureUrl ?? null,
          profile.statusMessage ?? null,
          jstNow(),
          row.id,
        ).run();
        state.profilesUpdated += 1;
      } catch {
        state.profileErrors += 1;
      }
      state.profilesProcessed += 1;
    }));
  }

  if (batch.length > 0) state.profileCursor = batch[batch.length - 1].id;
  if (batch.length < PROFILE_BATCH_SIZE) {
    state.phase = 'completed';
    state.completedAt = jstNow();
  }
}

export interface FollowerImportStepResult {
  state: FollowerImportState;
  busy: boolean;
}

/**
 * Process one bounded unit. State/cursors live in D1, so closing the browser
 * only pauses the job; the next request resumes it. No cron is involved.
 */
export async function processFollowerImportStep(
  db: D1Database,
  client: FollowerImportClient,
  lineAccountId: string,
): Promise<FollowerImportStepResult> {
  let state = await getFollowerImportState(db, lineAccountId);
  if (state.phase === 'not_started' || state.phase === 'completed') {
    return { state, busy: false };
  }

  const nowMs = Date.now();
  if (state.lockUntil && new Date(state.lockUntil).getTime() > nowMs) {
    return { state, busy: true };
  }

  const lockToken = crypto.randomUUID();
  const lockUntil = new Date(nowMs + 60_000).toISOString();
  const oldRaw = await getAccountSetting(db, lineAccountId, FOLLOWER_IMPORT_STATE_KEY);
  if (!oldRaw) return { state, busy: true };
  const locked = { ...state, lockToken, lockUntil, updatedAt: jstNow() };
  const claim = await db.prepare(
    `UPDATE account_settings
        SET value = ?, updated_at = ?
      WHERE line_account_id = ? AND key = ? AND value = ?`,
  ).bind(
    JSON.stringify(locked), locked.updatedAt, lineAccountId,
    FOLLOWER_IMPORT_STATE_KEY, oldRaw,
  ).run();
  if ((claim.meta.changes ?? 0) === 0) return { state, busy: true };
  state = locked;

  try {
    if (state.phase === 'importing_ids') {
      await importIdPage(db, client, lineAccountId, state);
    } else if (state.phase === 'hydrating_profiles') {
      await hydrateProfilePage(db, client, lineAccountId, state);
    }
    state.lastError = null;
  } catch (err) {
    state.lastError = err instanceof Error ? err.message : '移行処理に失敗しました';
  } finally {
    state.lockToken = null;
    state.lockUntil = null;
    await saveState(db, lineAccountId, state);
  }
  return { state, busy: false };
}
