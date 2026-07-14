import {
  lookupCachedAnswer,
  saveCachedAnswer,
  isCacheableQuestion,
} from './llm-cache.js';
import {
  searchKbArticles,
  formatKbContext,
  incrementGroqUsage,
  isGroqBudgetExceeded,
} from './kb-search.js';
import {
  generateGroqReply,
  getGroqReplyConfig,
  buildGroqHistory,
} from './groq-reply.js';
import { getKnowledgePack } from './knowledge-packs.js';

export type GroqPipelineResult =
  | { kind: 'disabled' }
  | { kind: 'canned'; text: string; source: 'canned' | 'cache' }
  | { kind: 'reply'; text: string; cacheable: boolean }
  | { kind: 'escalate'; text?: string }
  | { kind: 'fail_closed'; escalationText: string };

export interface GroqPipelineParams {
  db: D1Database;
  apiKey: string;
  lineAccountId: string | null;
  friendId: string;
  incomingText: string;
  project: string;
}

/**
 * Tier1 cache → Tier1.5 canned → Tier2 RAG+Groq pipeline.
 * Fail-closed returns escalation text; does NOT fall through to Claude.
 */
export async function runGroqSupportPipeline(
  params: GroqPipelineParams,
): Promise<GroqPipelineResult> {
  const { db, apiKey, lineAccountId, friendId, incomingText, project } = params;
  const pack = getKnowledgePack(project);

  const config = await getGroqReplyConfig(db, lineAccountId);
  if (!config.enabled) return { kind: 'disabled' };

  if (await isGroqBudgetExceeded(db, lineAccountId)) {
    await incrementGroqUsage(db, lineAccountId, 'escalations');
    return { kind: 'fail_closed', escalationText: pack.getFailClosedEscalationText() };
  }

  const cached = await lookupCachedAnswer(db, incomingText, lineAccountId, project);
  if (cached) {
    await incrementGroqUsage(db, lineAccountId, 'cache_hits');
    return { kind: 'canned', text: cached, source: 'cache' };
  }

  const canned = pack.matchCannedResponse(incomingText);
  if (canned) {
    if (isCacheableQuestion(incomingText)) {
      await saveCachedAnswer(db, incomingText, canned, lineAccountId, project);
    }
    return { kind: 'canned', text: canned, source: 'canned' };
  }

  const kbHits = await searchKbArticles(db, incomingText, lineAccountId, project);
  const kbContext = formatKbContext(kbHits);
  const systemPrompt = pack.buildSystemPrompt(kbContext);
  const history = await buildGroqHistory(db, friendId);

  await incrementGroqUsage(db, lineAccountId, 'groq_calls');

  const groqResult = await generateGroqReply({
    apiKey,
    systemPrompt,
    messages: history,
    incomingText,
  });

  if (groqResult.kind === 'fail_closed') {
    await incrementGroqUsage(db, lineAccountId, 'escalations');
    return { kind: 'fail_closed', escalationText: pack.getFailClosedEscalationText() };
  }

  if (groqResult.kind === 'escalate') {
    await incrementGroqUsage(db, lineAccountId, 'escalations');
    return { kind: 'escalate', text: groqResult.text };
  }

  const text = groqResult.text!;
  const cacheable = isCacheableQuestion(incomingText);
  if (cacheable) {
    await saveCachedAnswer(db, incomingText, text, lineAccountId, project);
  }

  return { kind: 'reply', text, cacheable };
}
