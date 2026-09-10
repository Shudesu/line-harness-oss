import { createHash } from 'node:crypto';
import type { CfApiCreds } from './types.js';
import { executeD1Query } from './cf-api/d1.js';

/** The released migration bytes are immutable; only these exact files have an adapter. */
export const LEGACY_MILEAGE_MIGRATIONS = {
  '062_mileage_admin_and_activity_rules.sql': 'e735bf39298a8dedf593a267226670b282513210d76e2f8ddc6c9119b01b4a31',
  '063_webinar_instagram_mileage.sql': 'd0687dc2fc607e8fdfe0c199583eac134afb2603f181c8a2a2d7e97c1dced5f7',
} as const;

export const LEGACY_MILEAGE_HOLD = '9999-12-31T23:59:59';
export const LEGACY_MILEAGE_CLAIMS_TABLE = '_line_harness_legacy_mileage_claims';
const CANDIDATES = '_line_harness_legacy_mileage_candidates';
const GUARD = '_line_harness_legacy_mileage_guard';
const NOW = "strftime('%Y-%m-%dT%H:%M:%f', 'now', '+9 hours')";
const q = (value: string): string => `'${value.replace(/'/g, "''")}'`;

type LegacyName = keyof typeof LEGACY_MILEAGE_MIGRATIONS;
type Executor = typeof executeD1Query;

export function isLegacyMileageMigration(name: string): boolean {
  // A renamed fork in either reserved slot must also reach the allowlist
  // check, rather than falling back to the original unsafe DML runner.
  return /^(?:062|063)_/.test(name);
}

export function assertLegacyMileageSource(name: string, source: Buffer): void {
  if (!Object.hasOwn(LEGACY_MILEAGE_MIGRATIONS, name)) throw new Error(`Unsupported legacy mileage migration: ${name}`);
  const hash = createHash('sha256').update(source).digest('hex');
  if (hash !== LEGACY_MILEAGE_MIGRATIONS[name as LegacyName]) {
    throw new Error(`Migration ${name} has unknown historical mileage SQL. Restore the released migration bytes or reconcile this fork manually; unsafe mileage backfill was not executed.`);
  }
}

interface CandidateSpec {
  id: string;
  eventType: string;
  source: string;
  sourceId: string;
  ruleId: string;
  amount: number;
  conditions?: string;
  ruleSource?: string | null;
  friend: string;
  user: string;
  occurred: string;
  from: string;
  where?: string;
  metadata?: string;
  subject?: string;
  identitySubject?: string;
}

function insertCandidates(s: CandidateSpec): string {
  const metadata = s.metadata ?? "'{}'";
  const subject = s.subject ?? 'NULL';
  return `INSERT OR IGNORE INTO ${CANDIDATES}
    (legacy_id, canonical_key, event_type, source, source_event_id, mileage_rule_id,
     expected_amount, expected_conditions, expected_source, friend_id, user_id,
     occurred_at, metadata, subject_key, identity_subject)
    SELECT ${s.id}, ${q(s.source + ':' + s.eventType + ':')} || (${s.sourceId}),
           ${q(s.eventType)}, ${q(s.source)}, ${s.sourceId}, ${q(s.ruleId)},
           ${s.amount}, ${s.conditions ? q(s.conditions) : 'NULL'},
           ${s.ruleSource === null ? 'NULL' : q(s.ruleSource ?? s.source)},
           ${s.friend}, ${s.user}, ${s.occurred},
           json_set(${metadata}, '$.backfilled', json('true'), '$.subjectKey', ${subject}),
           ${subject}, ${s.identitySubject ?? 'NULL'}
      FROM ${s.from}
     ${s.where ? `WHERE ${s.where}` : ''}
     ORDER BY ${s.occurred}, ${s.id};`;
}

function activityCandidates(): string[] {
  return [
    insertCandidates({ id: "'history-message-' || ml.id", eventType: 'message_received', source: 'line', sourceId: 'ml.id',
      ruleId: 'builtin-message-received', amount: 1, conditions: '{"dailyCapActions":5}', friend: 'ml.friend_id', user: 'f.user_id',
      occurred: 'ml.created_at', from: 'messages_log ml JOIN friends f ON f.id = ml.friend_id', where: "ml.direction = 'incoming'",
      metadata: "json_object('messageType', ml.message_type)" }),
    insertCandidates({ id: "'history-link-' || lc.id", eventType: 'link_clicked', source: 'tracked_link', sourceId: 'lc.id',
      ruleId: 'builtin-link-clicked', amount: 2, conditions: '{"dailyCapActions":5,"uniquePerSubjectPerDay":true}',
      friend: 'lc.friend_id', user: 'f.user_id', occurred: 'lc.clicked_at', from: 'link_clicks lc LEFT JOIN friends f ON f.id = lc.friend_id',
      metadata: "json_object('trackedLinkId', lc.tracked_link_id)", subject: 'lc.tracked_link_id' }),
    insertCandidates({ id: "'history-form-' || fs.id", eventType: 'form_submitted', source: 'form', sourceId: 'fs.id',
      ruleId: 'builtin-form-submitted', amount: 10, conditions: '{"uniquePerSubject":true}', friend: 'fs.friend_id', user: 'f.user_id',
      occurred: 'fs.created_at', from: 'form_submissions fs LEFT JOIN friends f ON f.id = fs.friend_id',
      metadata: "json_object('formId', fs.form_id)", subject: 'fs.form_id' }),
    insertCandidates({ id: "'history-booking-' || b.id", eventType: 'booking_created', source: 'booking', sourceId: 'b.id',
      ruleId: 'builtin-booking-created', amount: 20, ruleSource: null, friend: 'b.friend_id', user: 'f.user_id', occurred: 'b.created_at',
      from: 'bookings b JOIN friends f ON f.id = b.friend_id', where: "b.status IN ('requested', 'confirmed', 'completed')",
      metadata: "json_object('bookingType', 'salon')" }),
    insertCandidates({ id: "'history-event-booking-' || b.id", eventType: 'booking_created', source: 'event_booking', sourceId: 'b.id',
      ruleId: 'builtin-booking-created', amount: 20, ruleSource: null, friend: 'b.friend_id', user: 'f.user_id', occurred: 'b.created_at',
      from: 'event_bookings b JOIN friends f ON f.id = b.friend_id', where: "b.status IN ('requested', 'confirmed', 'attended')",
      metadata: "json_object('bookingType', 'event', 'eventId', b.event_id)" }),
  ];
}

function webinarCandidates(): string[] {
  const milestones = [
    { suffix: '5m', type: 'webinar_watch_5m', rule: 'builtin-webinar-watch-5m', amount: 5, threshold: '300' },
    { suffix: '15m', type: 'webinar_watch_15m', rule: 'builtin-webinar-watch-15m', amount: 10, threshold: '900' },
    { suffix: 'complete', type: 'webinar_completed', rule: 'builtin-webinar-completed', amount: 30, threshold: 'CAST(w.duration_seconds * 0.9 AS INTEGER)' },
  ];
  return [
    ...milestones.map(m => insertCandidates({
      id: `${q('history-webinar-' + m.suffix + '-')} || v.id`, eventType: m.type, source: 'webinar',
      sourceId: `v.webinar_id || ':' || v.friend_id || ${q(':' + m.suffix)}`, ruleId: m.rule, amount: m.amount,
      conditions: '{"uniquePerSubject":true}', friend: 'v.friend_id', user: 'f.user_id',
      occurred: `datetime(v.joined_at, '+' || ${m.threshold} || ' seconds')`,
      from: 'webinar_viewers v JOIN friends f ON f.id = v.friend_id JOIN webinars w ON w.id = v.webinar_id',
      where: `v.last_position_seconds >= ${m.threshold}${m.suffix === 'complete' ? ' AND w.duration_seconds > 0' : ''}`,
      metadata: "json_object('webinarId', v.webinar_id, 'sessionStartAt', v.session_start_at, 'positionSeconds', v.last_position_seconds, 'durationSeconds', w.duration_seconds)",
      subject: 'v.webinar_id',
    })),
    insertCandidates({ id: "'history-webinar-cta-' || v.id", eventType: 'webinar_cta_clicked', source: 'webinar',
      sourceId: "v.webinar_id || ':' || v.friend_id || ':' || v.session_start_at || ':primary'",
      ruleId: 'builtin-webinar-cta-clicked', amount: 10, conditions: '{"uniquePerSubject":true}', friend: 'v.friend_id', user: 'f.user_id',
      occurred: 'v.cta_clicked_at', from: 'webinar_viewers v JOIN friends f ON f.id = v.friend_id', where: 'v.cta_clicked_at IS NOT NULL',
      metadata: "json_object('webinarId', v.webinar_id, 'sessionStartAt', v.session_start_at, 'ctaId', 'primary')",
      subject: "v.webinar_id || ':primary'" }),
    insertCandidates({ id: "'history-instagram-return-' || f.id", eventType: 'instagram_line_returned', source: 'instagram',
      sourceId: "f.id || ':' || f.ig_igsid", ruleId: 'builtin-instagram-line-returned', amount: 15, conditions: '{"uniquePerSubject":true}',
      friend: 'f.id', user: 'f.user_id', occurred: 'f.created_at', from: 'friends f', where: "f.ig_igsid IS NOT NULL AND f.ig_igsid <> ''",
      metadata: "json_object('igsid', f.ig_igsid)", subject: 'f.ig_igsid', identitySubject: 'f.ig_igsid' }),
  ];
}

/** Same person through either the immutable friend ID or its current user link. */
const SAME_BENEFICIARY = `(ml.beneficiary_friend_id = c.friend_id OR
  (c.user_id IS NOT NULL AND (ml.beneficiary_user_id = c.user_id OR bf.user_id = c.user_id)))`;
const LEGACY_SUBJECT = `COALESCE(json_extract(ml.metadata, '$.subjectKey'), json_extract(ge.metadata, '$.subjectKey'),
  CASE c.event_type
    WHEN 'form_submitted' THEN COALESCE(json_extract(ml.metadata, '$.formId'), json_extract(ge.metadata, '$.formId'))
    WHEN 'link_clicked' THEN COALESCE(json_extract(ml.metadata, '$.trackedLinkId'), json_extract(ge.metadata, '$.trackedLinkId'))
    WHEN 'webinar_cta_clicked' THEN COALESCE(json_extract(ml.metadata, '$.webinarId'), json_extract(ge.metadata, '$.webinarId')) || ':' || COALESCE(json_extract(ml.metadata, '$.ctaId'), json_extract(ge.metadata, '$.ctaId'), 'primary')
    WHEN 'instagram_line_returned' THEN COALESCE(json_extract(ml.metadata, '$.igsid'), json_extract(ge.metadata, '$.igsid'), ge.identity_subject)
    ELSE COALESCE(json_extract(ml.metadata, '$.webinarId'), json_extract(ge.metadata, '$.webinarId'))
  END)`;

export interface ApplyLegacyMileageOptions {
  name: string;
  source: Buffer;
  checksum: string;
  creds: CfApiCreds;
  databaseId: string;
  execute?: Executor;
}

/**
 * Run after additive 062 DDL preparation, instead of its historical DML.
 * This adapter never writes mileage_ledger. It transfers genuinely unowned
 * actions to the existing projection, held until a compatible Worker runs.
 * Multi-statement execution MUST be atomic (D1 query API contract).
 */
export async function applyLegacyMileageMigration(opts: ApplyLegacyMileageOptions): Promise<{
  executedStatements: number; skippedStatements: number;
}> {
  assertLegacyMileageSource(opts.name, opts.source);
  const expectedChecksum = `sha256:${LEGACY_MILEAGE_MIGRATIONS[opts.name as LegacyName]}`;
  if (opts.checksum !== expectedChecksum) throw new Error(`Invalid checksum for ${opts.name}`);
  const execute = opts.execute ?? executeD1Query;
  const base = { creds: opts.creds, databaseId: opts.databaseId };
  const schema = await execute({ ...base, sql: `SELECT
    EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'mileage_event_queue') AS async_queue,
    EXISTS(SELECT 1 FROM pragma_table_info('tags') WHERE name = 'mileage_multiplier_bps') AS multipliers,
    EXISTS(SELECT 1 FROM mileage_rules) AS existing_rules` });
  const row = schema.result?.[0]?.results?.[0];
  if (!row || !('async_queue' in row) || !('multipliers' in row) || !('existing_rules' in row)) {
    throw new Error(`Cannot verify the mileage runtime baseline for ${opts.name}; no history was claimed.`);
  }
  // A queue-less DB with mileage rules might still have the synchronous
  // mileage Worker. Installing queue tombstones cannot protect that writer.
  if (!Number(row.async_queue) && Number(row.existing_rules)) {
    throw new Error(`Migration ${opts.name} requires the supported asynchronous mileage baseline. Existing mileage rules without its queue need manual reconciliation; no history was claimed.`);
  }
  const original = opts.source.toString('utf8');
  const seedStart = original.indexOf('INSERT OR IGNORE INTO mileage_rules');
  const seed = original.slice(seedStart, original.indexOf(';', seedStart) + 1);
  const candidates = opts.name.startsWith('062_') ? activityCandidates() : webinarCandidates();
  const protectedRules = opts.name.startsWith('062_')
    ? ['builtin-message-received', 'builtin-link-clicked', 'builtin-form-submitted', 'builtin-booking-created']
    : ['builtin-webinar-watch-5m', 'builtin-webinar-watch-15m', 'builtin-webinar-completed', 'builtin-webinar-cta-clicked', 'builtin-instagram-line-returned'];
  const familyPrefixes = opts.name.startsWith('062_')
    ? ['history-message-', 'history-link-', 'history-form-', 'history-booking-', 'history-event-booking-']
    : ['history-webinar-5m-', 'history-webinar-15m-', 'history-webinar-complete-', 'history-webinar-cta-', 'history-instagram-return-'];
  const statements = [
    `CREATE TABLE IF NOT EXISTS mileage_event_queue (
      engagement_event_id TEXT PRIMARY KEY REFERENCES engagement_events(id) ON DELETE CASCADE,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','processing','processed','failed')),
      attempts INTEGER NOT NULL DEFAULT 0, available_at TEXT NOT NULL, processing_started_at TEXT,
      processed_at TEXT, last_error TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);`,
    `CREATE INDEX IF NOT EXISTS idx_mileage_event_queue_due ON mileage_event_queue(status, available_at, created_at);`,
    `CREATE TABLE IF NOT EXISTS ${LEGACY_MILEAGE_CLAIMS_TABLE} (
      engagement_event_id TEXT PRIMARY KEY REFERENCES engagement_events(id),
      migration_name TEXT NOT NULL, mileage_rule_id TEXT NOT NULL, rule_snapshot TEXT NOT NULL);`,
    `CREATE TABLE ${CANDIDATES} (
      canonical_key TEXT PRIMARY KEY, legacy_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL, source TEXT NOT NULL, source_event_id TEXT NOT NULL,
      mileage_rule_id TEXT NOT NULL, expected_amount INTEGER NOT NULL, expected_conditions TEXT,
      expected_source TEXT, friend_id TEXT, user_id TEXT, occurred_at TEXT NOT NULL,
      metadata TEXT NOT NULL, subject_key TEXT, identity_subject TEXT,
      event_id TEXT, settled INTEGER NOT NULL DEFAULT 0);`,
    `CREATE TABLE ${GUARD}(
      valid INTEGER CONSTRAINT legacy_mileage_requires_manual_reconciliation CHECK(valid = 1),
      cta_identity INTEGER CONSTRAINT legacy_mileage_ambiguous_cta CHECK(cta_identity = 1),
      native_overlap INTEGER CONSTRAINT legacy_mileage_native_queue_overlap CHECK(native_overlap = 1));`,
    seed,
    ...candidates,
    // A pre-existing live queue can already overlap old history before this
    // adapter runs. The old Worker lacks the new counterpart check, so leaving
    // that queue runnable during deployment is unsafe. Do not claim it under
    // one builtin rule (that would drop legitimate custom rewards); stop for a
    // reviewed reconciliation. Include the event-before-queue gap and events
    // whose raw source row has already been removed.
    `WITH native_pending AS MATERIALIZED (
      SELECT e.event_type, e.source, e.source_event_id, r.id AS mileage_rule_id,
        e.actor_friend_id AS friend_id, f.user_id AS user_id, e.occurred_at,
        COALESCE(json_extract(e.metadata, '$.subjectKey'), CASE e.event_type
          WHEN 'form_submitted' THEN json_extract(e.metadata, '$.formId')
          WHEN 'link_clicked' THEN json_extract(e.metadata, '$.trackedLinkId')
          WHEN 'instagram_line_returned' THEN COALESCE(json_extract(e.metadata, '$.igsid'), e.identity_subject)
          WHEN 'webinar_cta_clicked' THEN json_extract(e.metadata, '$.webinarId') || ':' || COALESCE(json_extract(e.metadata, '$.ctaId'), 'primary')
          ELSE json_extract(e.metadata, '$.webinarId') END) AS subject_key
      FROM engagement_events e JOIN friends f ON f.id = e.actor_friend_id
      JOIN mileage_rules r ON r.program_id = e.program_id AND r.event_type = e.event_type
        AND (r.source IS NULL OR r.source = e.source)
      LEFT JOIN mileage_event_queue mq ON mq.engagement_event_id = e.id
      WHERE e.program_id = 'default' AND r.id IN (${protectedRules.map(q).join(', ')})
        AND e.idempotency_key = e.source || ':' || e.event_type || ':' || e.source_event_id
        AND (mq.engagement_event_id IS NULL OR mq.status = 'processing'
          OR (mq.status IN ('pending', 'failed') AND mq.attempts < 5))
        AND NOT EXISTS (SELECT 1 FROM ${LEGACY_MILEAGE_CLAIMS_TABLE} cl WHERE cl.engagement_event_id = e.id)
    ) INSERT INTO ${GUARD}(native_overlap) SELECT 0 WHERE EXISTS (
      SELECT 1 FROM native_pending c WHERE EXISTS (
        SELECT 1 FROM mileage_ledger ml
        LEFT JOIN engagement_events ge ON ge.id = ml.engagement_event_id
        LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
        WHERE ml.program_id = 'default' AND ml.mileage_rule_id = c.mileage_rule_id
          AND ml.entry_type = 'grant' AND ml.source = c.source
          AND (ml.idempotency_key LIKE 'history-mile:%' OR ml.id LIKE 'history-mile-%')
          AND ${SAME_BENEFICIARY}
          AND (ml.source_event_id = c.source_event_id OR
            (c.subject_key IS NOT NULL AND ${LEGACY_SUBJECT} = c.subject_key
              AND (c.event_type <> 'link_clicked' OR substr(ml.occurred_at, 1, 10) = substr(c.occurred_at, 1, 10))))));`,
    // Native events, including an event whose enqueue has not happened yet,
    // belong to runtime. CTA's raw storage omits ctaId; any live CTA for that
    // viewer/session owns it, rather than manufacturing a primary CTA.
    `DELETE FROM ${CANDIDATES} AS c WHERE EXISTS (
      SELECT 1 FROM engagement_events e WHERE e.program_id = 'default'
        AND (e.idempotency_key = c.canonical_key OR
          (c.event_type = 'webinar_cta_clicked' AND e.event_type = c.event_type AND e.source = c.source
           AND e.actor_friend_id = c.friend_id
           AND json_extract(e.metadata, '$.webinarId') = json_extract(c.metadata, '$.webinarId')
           AND json_extract(e.metadata, '$.sessionStartAt') = json_extract(c.metadata, '$.sessionStartAt')
           AND e.id NOT LIKE 'history-%'
           AND NOT EXISTS (SELECT 1 FROM engagement_events historical
             WHERE historical.id = c.legacy_id AND historical.idempotency_key LIKE 'history:%'))));`,
    // The raw viewer stores only the first CTA timestamp, not which CTA was
    // clicked. A request can be between that write and its live enqueue, so
    // manufacturing a primary action here can pay both primary and secondary.
    // Only the exact old migration event proves a recoverable primary action:
    // its deterministic ID binds the viewer/session, and its retained metadata
    // and timestamp must agree with that viewer. Otherwise abort the whole unit.
    `INSERT INTO ${GUARD}(cta_identity) SELECT 0 WHERE EXISTS (
      SELECT 1 FROM ${CANDIDATES} c WHERE c.event_type = 'webinar_cta_clicked'
        AND NOT EXISTS (
          SELECT 1 FROM engagement_events e WHERE e.id = c.legacy_id
            AND e.program_id = 'default' AND e.event_type = c.event_type AND e.source = c.source
            AND e.idempotency_key = 'history:webinar:cta:' || substr(c.legacy_id, length('history-webinar-cta-') + 1)
            AND e.actor_friend_id = c.friend_id
            AND e.source_event_id = json_extract(c.metadata, '$.webinarId') || ':' || c.friend_id || ':primary'
            AND json_extract(e.metadata, '$.webinarId') = json_extract(c.metadata, '$.webinarId')
            AND json_extract(e.metadata, '$.ctaId') = 'primary'
            AND (json_type(e.metadata, '$.sessionStartAt') IS NULL
              OR json_extract(e.metadata, '$.sessionStartAt') = json_extract(c.metadata, '$.sessionStartAt'))
            AND e.occurred_at = c.occurred_at));`,
    // An old history ID with a different canonical owner or unusual queue is
    // ambiguous, not permission to overwrite an event/queue already in use.
    `INSERT INTO ${GUARD}(valid) SELECT 0 WHERE EXISTS (
      SELECT 1 FROM ${CANDIDATES} c JOIN engagement_events e ON e.id = c.legacy_id
      LEFT JOIN mileage_event_queue mq ON mq.engagement_event_id = e.id
      WHERE e.program_id <> 'default' OR e.idempotency_key NOT LIKE 'history:%'
         OR mq.engagement_event_id IS NOT NULL OR e.source <> c.source OR e.event_type <> c.event_type
         OR e.actor_friend_id IS NOT c.friend_id
         OR (e.source_event_id IS NOT c.source_event_id AND NOT (
           c.event_type = 'webinar_cta_clicked' AND e.source_event_id =
             json_extract(c.metadata, '$.webinarId') || ':' || c.friend_id || ':primary'))
         OR (c.subject_key IS NOT NULL AND c.subject_key IS NOT
           COALESCE(json_extract(e.metadata, '$.subjectKey'), CASE c.event_type
             WHEN 'form_submitted' THEN json_extract(e.metadata, '$.formId')
             WHEN 'link_clicked' THEN json_extract(e.metadata, '$.trackedLinkId')
             WHEN 'instagram_line_returned' THEN COALESCE(json_extract(e.metadata, '$.igsid'), e.identity_subject)
             WHEN 'webinar_cta_clicked' THEN json_extract(e.metadata, '$.webinarId') || ':' || COALESCE(json_extract(e.metadata, '$.ctaId'), 'primary')
             ELSE json_extract(e.metadata, '$.webinarId') END)));`,
    `INSERT INTO ${GUARD}(valid) SELECT 0 WHERE EXISTS (
      SELECT 1 FROM engagement_events e
      WHERE (${familyPrefixes.map(p => `e.id LIKE ${q(p + '%')}`).join(' OR ')})
        AND NOT EXISTS (SELECT 1 FROM ${CANDIDATES} c WHERE c.legacy_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM mileage_ledger ml WHERE ml.engagement_event_id = e.id)
        AND NOT EXISTS (SELECT 1 FROM ${LEGACY_MILEAGE_CLAIMS_TABLE} cl WHERE cl.engagement_event_id = e.id)
        AND e.idempotency_key LIKE 'history:%'
        AND NOT EXISTS (SELECT 1 FROM engagement_events live WHERE live.program_id = e.program_id
          AND live.source = e.source AND live.event_type = e.event_type
          AND (live.source_event_id = e.source_event_id OR
            (e.event_type = 'webinar_cta_clicked' AND live.actor_friend_id = e.actor_friend_id
             AND json_extract(live.metadata, '$.webinarId') = json_extract(e.metadata, '$.webinarId')))
          AND live.id NOT LIKE 'history-%'));`,
    // Claiming an in-flight raw action would bypass live custom rewards. Stop
    // rather than guessing which absent ledger entries were intentional.
    `INSERT INTO ${GUARD}(valid) SELECT 0 WHERE EXISTS (
      SELECT 1 FROM ${CANDIDATES} c JOIN mileage_rules r ON r.id = c.mileage_rule_id
      WHERE c.friend_id IS NOT NULL AND (
        r.program_id <> 'default' OR r.event_type <> c.event_type OR r.source IS NOT c.expected_source
        OR r.amount <> c.expected_amount OR r.initial_status <> 'available' OR r.is_active <> 1
        OR r.valid_from IS NOT NULL OR r.valid_until IS NOT NULL
        OR (r.conditions IS NOT NULL AND json_type(r.conditions) <> 'object')
        OR EXISTS (SELECT key, type, atom FROM json_each(r.conditions)
          EXCEPT SELECT key, type, atom FROM json_each(c.expected_conditions))
        OR EXISTS (SELECT key, type, atom FROM json_each(c.expected_conditions)
          EXCEPT SELECT key, type, atom FROM json_each(r.conditions))
        OR EXISTS (SELECT 1 FROM mileage_rules extra WHERE extra.program_id = 'default'
          AND extra.event_type = c.event_type AND (extra.source IS NULL OR extra.source = c.source)
          AND extra.is_active = 1 AND extra.id <> r.id)));`,
    ...(Number(row.multipliers) ? [`INSERT INTO ${GUARD}(valid) SELECT 0 WHERE EXISTS (
      SELECT 1 FROM ${CANDIDATES} c JOIN friends tf ON tf.id = c.friend_id OR (c.user_id IS NOT NULL AND tf.user_id = c.user_id)
      JOIN friend_tags ft ON ft.friend_id = tf.id JOIN tags t ON t.id = ft.tag_id
      WHERE t.mileage_multiplier_bps IS NOT NULL AND t.mileage_multiplier_bps <> 10000
        AND ft.assigned_at <= c.occurred_at);`] : []),
    `UPDATE ${CANDIDATES} AS c SET settled = 1
      WHERE c.friend_id IS NULL OR EXISTS (
        SELECT 1 FROM mileage_ledger ml
        LEFT JOIN engagement_events ge ON ge.id = ml.engagement_event_id
        LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
        WHERE ml.program_id = 'default' AND ml.mileage_rule_id = c.mileage_rule_id
          AND ml.entry_type = 'grant' AND ml.source = c.source AND ${SAME_BENEFICIARY}
          AND (ml.source_event_id = c.source_event_id OR
            (c.subject_key IS NOT NULL AND ${LEGACY_SUBJECT} = c.subject_key
             AND (c.event_type <> 'link_clicked' OR substr(ml.occurred_at, 1, 10) = substr(c.occurred_at, 1, 10)))));`,
    // Already-completed daily caps are evidence that the historic action
    // should remain suppressed. Pending/new history otherwise uses one
    // projection path; the adapter never reproduces grant amounts or ranking.
    `WITH grants AS MATERIALIZED (
        SELECT ml.id, ml.mileage_rule_id AS rule_id, substr(ml.occurred_at, 1, 10) AS day,
          ml.beneficiary_friend_id AS friend_id, ml.beneficiary_user_id AS user_id, bf.user_id AS current_user_id
        FROM mileage_ledger ml LEFT JOIN friends bf ON bf.id = ml.beneficiary_friend_id
        WHERE ml.program_id = 'default' AND ml.entry_type = 'grant' AND ml.status <> 'void'
          AND ml.mileage_rule_id IN ('builtin-message-received', 'builtin-link-clicked')
      ), identities AS (
        SELECT id, rule_id, day, 'friend:' || friend_id AS identity_key FROM grants WHERE friend_id IS NOT NULL
        UNION SELECT id, rule_id, day, 'user:' || user_id FROM grants WHERE user_id IS NOT NULL
        UNION SELECT id, rule_id, day, 'user:' || current_user_id FROM grants WHERE current_user_id IS NOT NULL
      ), caps AS MATERIALIZED (
        SELECT rule_id, day, identity_key, COUNT(*) AS actions FROM identities GROUP BY rule_id, day, identity_key
      ) UPDATE ${CANDIDATES} AS c SET settled = 1
      WHERE c.event_type IN ('message_received', 'link_clicked') AND EXISTS (
        SELECT 1 FROM caps WHERE caps.rule_id = c.mileage_rule_id AND caps.day = substr(c.occurred_at, 1, 10)
          AND caps.identity_key = COALESCE('user:' || c.user_id, 'friend:' || c.friend_id) AND caps.actions >= 5);`,
    `UPDATE engagement_events AS e SET
      idempotency_key = (SELECT c.canonical_key FROM ${CANDIDATES} c WHERE c.legacy_id = e.id),
      source_event_id = (SELECT c.source_event_id FROM ${CANDIDATES} c WHERE c.legacy_id = e.id),
      metadata = json_patch(COALESCE(e.metadata, '{}'), (SELECT c.metadata FROM ${CANDIDATES} c WHERE c.legacy_id = e.id))
      WHERE EXISTS (SELECT 1 FROM ${CANDIDATES} c WHERE c.legacy_id = e.id);`,
    `INSERT OR IGNORE INTO engagement_events
      (id, program_id, idempotency_key, event_type, source, source_event_id,
       actor_user_id, actor_friend_id, identity_provider, identity_subject, metadata, occurred_at, created_at)
      SELECT legacy_id, 'default', canonical_key, event_type, source, source_event_id,
        user_id, friend_id, CASE WHEN identity_subject IS NOT NULL THEN 'instagram' END,
        identity_subject, metadata, occurred_at, occurred_at FROM ${CANDIDATES};`,
    `UPDATE ${CANDIDATES} AS c SET event_id = (
      SELECT e.id FROM engagement_events e WHERE e.program_id = 'default' AND e.idempotency_key = c.canonical_key);`,
    `INSERT INTO ${LEGACY_MILEAGE_CLAIMS_TABLE}
      (engagement_event_id, migration_name, mileage_rule_id, rule_snapshot)
      SELECT c.event_id, ${q(opts.name)}, c.mileage_rule_id,
        json_object('amount', r.amount, 'initial_status', r.initial_status, 'conditions', r.conditions,
          'source', r.source, 'event_type', r.event_type, 'is_active', r.is_active,
          'valid_from', r.valid_from, 'valid_until', r.valid_until)
      FROM ${CANDIDATES} c JOIN mileage_rules r ON r.id = c.mileage_rule_id;`,
    `INSERT INTO mileage_event_queue
      (engagement_event_id, status, attempts, available_at, processed_at, created_at, updated_at)
      SELECT event_id, CASE WHEN settled = 1 THEN 'processed' ELSE 'pending' END, 0,
        CASE WHEN settled = 1 THEN ${NOW} ELSE ${q(LEGACY_MILEAGE_HOLD)} END,
        CASE WHEN settled = 1 THEN ${NOW} END, occurred_at, ${NOW}
      FROM ${CANDIDATES};`,
    `INSERT OR IGNORE INTO _line_harness_migrations(name, checksum, applied_at)
      VALUES (${q(opts.name)}, ${q(opts.checksum)}, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));`,
    `INSERT INTO ${GUARD}(valid) SELECT 0 WHERE EXISTS (SELECT 1 FROM _line_harness_migrations
      WHERE name = ${q(opts.name)} AND checksum <> ${q(opts.checksum)});`,
    `DROP TABLE ${CANDIDATES};`,
    `DROP TABLE ${GUARD};`,
  ];
  try {
    await execute({ ...base, sql: statements.join('\n') });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    if (detail.includes('legacy_mileage_native_queue_overlap')) {
      throw new Error(`Migration ${opts.name} found pending live mileage events that overlap existing historical grants. Install the compatible mileage runtime or reconcile those live events before retrying; their queue ownership and custom rules were preserved and the atomic history claim was aborted.`, { cause: error });
    }
    if (detail.includes('legacy_mileage_ambiguous_cta')) {
      throw new Error(`Migration ${opts.name} cannot establish historical CTA identity: the raw viewer timestamp does not record ctaId. Retry after in-flight CTA requests have enqueued their engagement events. If this persists, reconcile the historical CTA events before retrying; the atomic history claim was aborted.`, { cause: error });
    }
    throw new Error(`Migration ${opts.name} could not reconcile historical mileage atomically. Custom rules, multipliers, orphan history, or existing queue ownership require review; no partial history claim should commit. ${detail}`, { cause: error });
  }
  return { executedStatements: statements.length, skippedStatements: 0 };
}
