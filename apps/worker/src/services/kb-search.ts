import { jstNow } from '@line-crm/db';
import { getBotConfig, getDefaultProject } from './groq-config.js';

export interface KbArticleHit {
  id: string;
  title: string;
  content: string;
  score: number;
}

function escapeFtsTerm(term: string): string {
  return term.replace(/["']/g, '').trim();
}

/** Bigram tokens for Japanese fallback when FTS5 tokenization is weak. */
function toBigrams(text: string): string[] {
  const compact = text.replace(/\s+/g, '');
  if (compact.length < 2) return compact ? [compact] : [];
  const grams: string[] = [];
  for (let i = 0; i < compact.length - 1; i++) {
    grams.push(compact.slice(i, i + 2));
  }
  return [...new Set(grams)].slice(0, 12);
}

export async function searchKbArticles(
  db: D1Database,
  query: string,
  lineAccountId: string | null,
  project: string,
): Promise<KbArticleHit[]> {
  const { topK, minScore } = getBotConfig().retrieval;
  const trimmed = query.trim();
  if (!trimmed) return [];

  const ftsHits = await searchFts(db, trimmed, lineAccountId, project, topK);
  if (ftsHits.length > 0) {
    return ftsHits.filter((h) => h.score >= minScore);
  }

  return searchLike(db, trimmed, lineAccountId, project, topK);
}

async function searchFts(
  db: D1Database,
  query: string,
  lineAccountId: string | null,
  project: string,
  limit: number,
): Promise<KbArticleHit[]> {
  const terms = query.split(/\s+/).filter(Boolean).map(escapeFtsTerm);
  const ftsQuery = terms.length > 0 ? terms.map((t) => `"${t}"`).join(' OR ') : `"${escapeFtsTerm(query)}"`;
  const defaultProject = getDefaultProject();

  try {
    const rows = await db
      .prepare(
        `SELECT ka.id, ka.title, ka.content, bm25(kb_articles_fts) AS score
         FROM kb_articles_fts
         JOIN kb_articles ka ON ka.rowid = kb_articles_fts.rowid
         WHERE kb_articles_fts MATCH ?
           AND (ka.line_account_id IS NULL OR ka.line_account_id = ?)
           AND COALESCE(ka.project, ?) = ?
         ORDER BY score
         LIMIT ?`,
      )
      .bind(ftsQuery, lineAccountId, defaultProject, project, limit)
      .all<{ id: string; title: string; content: string; score: number }>();

    return (rows.results ?? []).map((r) => ({
      id: r.id,
      title: r.title,
      content: r.content,
      score: Math.abs(r.score ?? 0),
    }));
  } catch (err) {
    console.warn('[kb-search] FTS query failed, falling back to LIKE', err);
    return [];
  }
}

async function searchLike(
  db: D1Database,
  query: string,
  lineAccountId: string | null,
  project: string,
  limit: number,
): Promise<KbArticleHit[]> {
  const bigrams = toBigrams(query);
  const keywords = bigrams.length > 0 ? bigrams : query.split(/\s+/).filter(Boolean).slice(0, 5);
  if (keywords.length === 0) return [];

  const defaultProject = getDefaultProject();
  const conditions = keywords.map(() => '(title LIKE ? OR content LIKE ?)').join(' OR ');
  const binds: unknown[] = [];
  for (const kw of keywords) {
    binds.push(`%${kw}%`, `%${kw}%`);
  }
  binds.push(lineAccountId, defaultProject, project, limit);

  const rows = await db
    .prepare(
      `SELECT id, title, content FROM kb_articles
       WHERE (${conditions})
         AND (line_account_id IS NULL OR line_account_id = ?)
         AND COALESCE(project, ?) = ?
       LIMIT ?`,
    )
    .bind(...binds)
    .all<{ id: string; title: string; content: string }>();

  return (rows.results ?? []).map((r, idx) => ({
    ...r,
    score: keywords.length - idx * 0.1,
  }));
}

export function formatKbContext(hits: KbArticleHit[]): string {
  if (hits.length === 0) return '';
  return hits
    .map((h, i) => `【参考${i + 1}: ${h.title}】\n${h.content}`)
    .join('\n\n');
}

/** JST date string YYYY-MM-DD for usage counters. */
export function jstDateString(): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === 'year')?.value ?? '1970';
  const m = parts.find((p) => p.type === 'month')?.value ?? '01';
  const d = parts.find((p) => p.type === 'day')?.value ?? '01';
  return `${y}-${m}-${d}`;
}

export async function incrementGroqUsage(
  db: D1Database,
  lineAccountId: string | null,
  field: 'groq_calls' | 'cache_hits' | 'escalations',
): Promise<void> {
  const usageDate = jstDateString();
  const now = jstNow();
  const id = `${lineAccountId ?? 'global'}:${usageDate}`;

  await db
    .prepare(
      `INSERT INTO groq_usage_daily (id, line_account_id, usage_date, groq_calls, cache_hits, escalations, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         groq_calls = groq_calls + excluded.groq_calls,
         cache_hits = cache_hits + excluded.cache_hits,
         escalations = escalations + excluded.escalations,
         updated_at = excluded.updated_at`,
    )
    .bind(
      id,
      lineAccountId,
      usageDate,
      field === 'groq_calls' ? 1 : 0,
      field === 'cache_hits' ? 1 : 0,
      field === 'escalations' ? 1 : 0,
      now,
    )
    .run();
}

export async function getGroqDailyCallCount(db: D1Database, lineAccountId: string | null): Promise<number> {
  const usageDate = jstDateString();
  const row = await db
    .prepare(
      `SELECT groq_calls FROM groq_usage_daily
       WHERE line_account_id IS ? AND usage_date = ?`,
    )
    .bind(lineAccountId, usageDate)
    .first<{ groq_calls: number }>();
  return row?.groq_calls ?? 0;
}

export async function isGroqBudgetExceeded(db: D1Database, lineAccountId: string | null): Promise<boolean> {
  const budget = getBotConfig().llm.dailyCallBudget;
  const count = await getGroqDailyCallCount(db, lineAccountId);
  return count >= budget;
}
