import { jstNow } from './utils.js';
// =============================================================================
// Forms — Survey / questionnaire system (L社 回答フォーム equivalent)
// =============================================================================

export interface Form {
  id: string;
  name: string;
  description: string | null;
  fields: string; // JSON string of FormField[]
  on_submit_tag_id: string | null;
  on_submit_scenario_id: string | null;
  on_submit_message_type: 'text' | 'flex' | null;
  on_submit_message_content: string | null; // supports template variables: {{name}}, {{auth_url:CHANNEL_ID}}, etc.
  on_submit_webhook_url: string | null;
  on_submit_webhook_headers: string | null;
  on_submit_webhook_fail_message: string | null;
  save_to_metadata: number;
  is_active: number;
  submit_count: number;
  created_at: string;
  updated_at: string;
}

export interface FormSubmission {
  id: string;
  form_id: string;
  friend_id: string | null;
  data: string; // JSON string
  created_at: string;
}

// ── CRUD ─────────────────────────────────────────────────────────────────────

export async function getForms(db: D1Database): Promise<Form[]> {
  const result = await db
    .prepare(`SELECT * FROM forms ORDER BY created_at DESC`)
    .all<Form>();
  return result.results;
}

export async function getFormById(db: D1Database, id: string): Promise<Form | null> {
  return db
    .prepare(`SELECT * FROM forms WHERE id = ?`)
    .bind(id)
    .first<Form>();
}

export interface CreateFormInput {
  name: string;
  description?: string | null;
  fields: string; // JSON string
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
}

export async function createForm(db: D1Database, input: CreateFormInput): Promise<Form> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO forms
         (id, name, description, fields, on_submit_tag_id, on_submit_scenario_id,
          on_submit_message_type, on_submit_message_content,
          on_submit_webhook_url, on_submit_webhook_headers, on_submit_webhook_fail_message,
          save_to_metadata, is_active, submit_count, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)`,
    )
    .bind(
      id,
      input.name,
      input.description ?? null,
      input.fields,
      input.onSubmitTagId ?? null,
      input.onSubmitScenarioId ?? null,
      input.onSubmitMessageType ?? null,
      input.onSubmitMessageContent ?? null,
      input.onSubmitWebhookUrl ?? null,
      input.onSubmitWebhookHeaders ?? null,
      input.onSubmitWebhookFailMessage ?? null,
      input.saveToMetadata !== false ? 1 : 0,
      now,
      now,
    )
    .run();

  return (await getFormById(db, id))!;
}

export interface UpdateFormInput {
  name?: string;
  description?: string | null;
  fields?: string;
  onSubmitTagId?: string | null;
  onSubmitScenarioId?: string | null;
  onSubmitMessageType?: 'text' | 'flex' | null;
  onSubmitMessageContent?: string | null;
  onSubmitWebhookUrl?: string | null;
  onSubmitWebhookHeaders?: string | null;
  onSubmitWebhookFailMessage?: string | null;
  saveToMetadata?: boolean;
  isActive?: boolean;
}

export async function updateForm(
  db: D1Database,
  id: string,
  input: UpdateFormInput,
): Promise<Form | null> {
  const existing = await getFormById(db, id);
  if (!existing) return null;

  const now = jstNow();

  await db
    .prepare(
      `UPDATE forms
       SET name = ?,
           description = ?,
           fields = ?,
           on_submit_tag_id = ?,
           on_submit_scenario_id = ?,
           on_submit_message_type = ?,
           on_submit_message_content = ?,
           on_submit_webhook_url = ?,
           on_submit_webhook_headers = ?,
           on_submit_webhook_fail_message = ?,
           save_to_metadata = ?,
           is_active = ?,
           updated_at = ?
       WHERE id = ?`,
    )
    .bind(
      input.name ?? existing.name,
      'description' in input ? (input.description ?? null) : existing.description,
      input.fields ?? existing.fields,
      'onSubmitTagId' in input ? (input.onSubmitTagId ?? null) : existing.on_submit_tag_id,
      'onSubmitScenarioId' in input
        ? (input.onSubmitScenarioId ?? null)
        : existing.on_submit_scenario_id,
      'onSubmitMessageType' in input
        ? (input.onSubmitMessageType ?? null)
        : existing.on_submit_message_type,
      'onSubmitMessageContent' in input
        ? (input.onSubmitMessageContent ?? null)
        : existing.on_submit_message_content,
      'onSubmitWebhookUrl' in input
        ? (input.onSubmitWebhookUrl ?? null)
        : existing.on_submit_webhook_url,
      'onSubmitWebhookHeaders' in input
        ? (input.onSubmitWebhookHeaders ?? null)
        : existing.on_submit_webhook_headers,
      'onSubmitWebhookFailMessage' in input
        ? (input.onSubmitWebhookFailMessage ?? null)
        : existing.on_submit_webhook_fail_message,
      'saveToMetadata' in input
        ? (input.saveToMetadata !== false ? 1 : 0)
        : existing.save_to_metadata,
      'isActive' in input ? (input.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();

  return getFormById(db, id);
}

export async function deleteForm(db: D1Database, id: string): Promise<void> {
  await db.prepare(`DELETE FROM forms WHERE id = ?`).bind(id).run();
}

// ── Submissions ───────────────────────────────────────────────────────────────

export async function getFormSubmissions(
  db: D1Database,
  formId: string,
): Promise<FormSubmission[]> {
  const result = await db
    .prepare(
      `SELECT fs.*, f.display_name as friend_name FROM form_submissions fs
       LEFT JOIN friends f ON f.id = fs.friend_id
       WHERE fs.form_id = ? ORDER BY fs.created_at DESC`,
    )
    .bind(formId)
    .all<FormSubmission & { friend_name: string | null }>();
  return result.results;
}

export interface CreateFormSubmissionInput {
  formId: string;
  friendId?: string | null;
  data: string; // JSON string
}

export async function createFormSubmission(
  db: D1Database,
  input: CreateFormSubmissionInput,
): Promise<FormSubmission> {
  const id = crypto.randomUUID();
  const now = jstNow();

  await db
    .prepare(
      `INSERT INTO form_submissions (id, form_id, friend_id, data, created_at)
       VALUES (?, ?, ?, ?, ?)`,
    )
    .bind(id, input.formId, input.friendId ?? null, input.data, now)
    .run();

  // Increment submit_count
  await db
    .prepare(`UPDATE forms SET submit_count = submit_count + 1, updated_at = ? WHERE id = ?`)
    .bind(now, input.formId)
    .run();

  return (await db
    .prepare(`SELECT * FROM form_submissions WHERE id = ?`)
    .bind(id)
    .first<FormSubmission>())!;
}
