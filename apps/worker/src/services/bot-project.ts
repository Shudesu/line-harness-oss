import { getEntryRouteByRefCode } from '@line-crm/db';
import { getBotConfig, isKnownProject } from './groq-config.js';

/**
 * Resolves which product's knowledge pack a friend's messages should use.
 *
 * Fail-closed at every step: any missing/unknown data falls back to the
 * configured default project, never throws, never guesses via LLM.
 *
 *   1. friend has no ref_code            -> defaultProject
 *   2. ref_code has no entry_routes row  -> defaultProject
 *   3. entry_routes row has project=NULL -> defaultProject
 *   4. project isn't in bot.config.json  -> defaultProject (+ warn)
 *   5. otherwise                         -> that project
 */
export async function resolveBotProject(
  db: D1Database,
  friend: { ref_code?: string | null },
): Promise<string> {
  const { defaultProject } = getBotConfig();

  if (!friend.ref_code) return defaultProject;

  const route = await getEntryRouteByRefCode(db, friend.ref_code);
  if (!route || !route.project) return defaultProject;

  if (!isKnownProject(route.project)) {
    console.warn(`resolveBotProject: unknown project "${route.project}" for ref_code "${friend.ref_code}", falling back to default`);
    return defaultProject;
  }

  return route.project;
}
