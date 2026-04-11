import { jstNow } from './utils.js';

export interface MessageTemplate {
  id: string;
  name: string;
  message_type: 'text' | 'flex';
  message_content: string;
  created_at: string;
  updated_at: string;
}

export async function listMessageTemplates(db: D1Database): Promise<MessageTemplate[]> {
  const result = await db
    .prepare('SELECT * FROM message_templates ORDER BY name ASC')
    .all<MessageTemplate>();
  return result.results;
}

export async function getMessageTemplateById(
  db: D1Database,
  id: string,
): Promise<MessageTemplate | null> {
  return db
    .prepare('SELECT * FROM message_templates WHERE id = ?')
    .bind(id)
    .first<MessageTemplate>();
}

export interface CreateMessageTemplateInput {
  name: string;
  messageType: 'text' | 'flex';
  messageContent: string;
}

export async function createMessageTemplate(
  db: D1Database,
  input: CreateMessageTemplateInput,
): Promise<MessageTemplate> {
  const id = crypto.randomUUID();
  const now = jstNow();
  const result = await db
    .prepare(
      'INSERT INTO message_templates (id, name, message_type, message_content, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?) RETURNING *',
    )
    .bind(id, input.name, input.messageType, input.messageContent, now, now)
    .first<MessageTemplate>();
  return result!;
}

export interface UpdateMessageTemplateInput {
  name?: string;
  messageType?: 'text' | 'flex';
  messageContent?: string;
}

export async function updateMessageTemplate(
  db: D1Database,
  id: string,
  input: UpdateMessageTemplateInput,
): Promise<MessageTemplate | null> {
  const existing = await getMessageTemplateById(db, id);
  if (!existing) return null;

  const now = jstNow();
  const name = input.name ?? existing.name;
  const messageType = input.messageType ?? existing.message_type;
  const messageContent = input.messageContent ?? existing.message_content;

  const result = await db
    .prepare(
      'UPDATE message_templates SET name = ?, message_type = ?, message_content = ?, updated_at = ? WHERE id = ? RETURNING *',
    )
    .bind(name, messageType, messageContent, now, id)
    .first<MessageTemplate>();
  return result;
}

export async function deleteMessageTemplate(db: D1Database, id: string): Promise<boolean> {
  const result = await db
    .prepare('DELETE FROM message_templates WHERE id = ?')
    .bind(id)
    .run();
  return result.meta.changes > 0;
}
