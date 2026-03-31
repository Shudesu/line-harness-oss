import { jstNow } from './utils';

export interface SurveyQuestion {
  id: string;
  text: string;
  type: 'text' | 'single_choice' | 'multi_choice' | 'rating';
  options?: string[]; // for single_choice / multi_choice
  required?: boolean;
}

export interface Survey {
  id: string;
  name: string;
  description: string | null;
  questions_json: string;
  is_active: number;
  line_account_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SurveyResponse {
  id: string;
  survey_id: string;
  friend_id: string | null;
  answers_json: string;
  created_at: string;
}

export interface SurveyWithStats extends Survey {
  response_count: number;
}

export async function getSurveys(db: D1Database, lineAccountId?: string): Promise<SurveyWithStats[]> {
  const sql = lineAccountId
    ? `SELECT s.*,
         (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id) as response_count
       FROM surveys s WHERE s.line_account_id = ? OR s.line_account_id IS NULL ORDER BY s.created_at DESC`
    : `SELECT s.*,
         (SELECT COUNT(*) FROM survey_responses sr WHERE sr.survey_id = s.id) as response_count
       FROM surveys s ORDER BY s.created_at DESC`;
  const result = await db.prepare(sql).bind(...(lineAccountId ? [lineAccountId] : [])).all<SurveyWithStats>();
  return result.results;
}

export async function getSurveyById(db: D1Database, id: string): Promise<Survey | null> {
  return db.prepare('SELECT * FROM surveys WHERE id = ?').bind(id).first<Survey>();
}

export async function createSurvey(
  db: D1Database,
  data: { name: string; description?: string; questionsJson: string; lineAccountId?: string },
): Promise<Survey> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO surveys (id, name, description, questions_json, line_account_id, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(id, data.name, data.description || null, data.questionsJson, data.lineAccountId || null, now, now)
    .run();
  return (await getSurveyById(db, id))!;
}

export async function updateSurvey(
  db: D1Database,
  id: string,
  data: { name?: string; description?: string; questionsJson?: string; isActive?: boolean },
): Promise<Survey | null> {
  const existing = await getSurveyById(db, id);
  if (!existing) return null;
  const now = jstNow();
  await db
    .prepare('UPDATE surveys SET name = ?, description = ?, questions_json = ?, is_active = ?, updated_at = ? WHERE id = ?')
    .bind(
      data.name ?? existing.name,
      data.description ?? existing.description,
      data.questionsJson ?? existing.questions_json,
      data.isActive !== undefined ? (data.isActive ? 1 : 0) : existing.is_active,
      now,
      id,
    )
    .run();
  return getSurveyById(db, id);
}

export async function deleteSurvey(db: D1Database, id: string): Promise<void> {
  await db.prepare('DELETE FROM survey_responses WHERE survey_id = ?').bind(id).run();
  await db.prepare('DELETE FROM surveys WHERE id = ?').bind(id).run();
}

export async function submitSurveyResponse(
  db: D1Database,
  surveyId: string,
  friendId: string | null,
  answersJson: string,
): Promise<SurveyResponse> {
  const id = crypto.randomUUID();
  const now = jstNow();
  await db
    .prepare('INSERT INTO survey_responses (id, survey_id, friend_id, answers_json, created_at) VALUES (?, ?, ?, ?, ?)')
    .bind(id, surveyId, friendId, answersJson, now)
    .run();
  return { id, survey_id: surveyId, friend_id: friendId, answers_json: answersJson, created_at: now };
}

export async function getSurveyResponses(db: D1Database, surveyId: string): Promise<(SurveyResponse & { friend_name?: string })[]> {
  const result = await db
    .prepare(
      `SELECT sr.*, f.display_name as friend_name
       FROM survey_responses sr LEFT JOIN friends f ON f.id = sr.friend_id
       WHERE sr.survey_id = ? ORDER BY sr.created_at DESC`,
    )
    .bind(surveyId)
    .all<SurveyResponse & { friend_name?: string }>();
  return result.results;
}

/** Get aggregated stats per question for a survey */
export async function getSurveyStats(
  db: D1Database,
  surveyId: string,
): Promise<{ questionId: string; answers: Record<string, number>; total: number }[]> {
  const survey = await getSurveyById(db, surveyId);
  if (!survey) return [];

  const questions: SurveyQuestion[] = JSON.parse(survey.questions_json);
  const responses = await db
    .prepare('SELECT answers_json FROM survey_responses WHERE survey_id = ?')
    .bind(surveyId)
    .all<{ answers_json: string }>();

  return questions.map((q, qi) => {
    const answers: Record<string, number> = {};
    let total = 0;

    for (const row of responses.results) {
      try {
        const ans = JSON.parse(row.answers_json) as string[];
        const val = ans[qi];
        if (val !== undefined && val !== '') {
          if (q.type === 'multi_choice') {
            // multi_choice answer is comma-separated
            for (const v of val.split(',')) {
              const trimmed = v.trim();
              if (trimmed) {
                answers[trimmed] = (answers[trimmed] || 0) + 1;
              }
            }
          } else {
            answers[val] = (answers[val] || 0) + 1;
          }
          total++;
        }
      } catch {
        // skip malformed
      }
    }

    return { questionId: q.id, answers, total };
  });
}
